import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { waitForAnimations } from './helpers/layout'
import { openRecordPage } from './helpers/record'
import {
  dismissInstallBanner,
  handExportStates,
  handListStates,
  handStates,
  p6States,
  recordStates,
  reportStates,
  scrollToHeading,
  sessionStates,
  settingsStates,
  stakingStates,
} from './helpers/screenStates'

// 10.3 P6「深色與淺色主題下所有畫面對比度達 AA」的自動化驗收（使用者決定以自動化取代實機）：
// 以 axe-core 的 color-contrast 規則（WCAG 2 AA：一般文字 4.5:1、大字 3:1）檢查所有畫面與狀態，深淺色各一輪。
// 畫面狀態與截圖共用 helpers/screenStates.ts；不排除規則、不略過元素。

// heavy：寫入大量資料的狀態，加上 @heavy tag，在序列執行的 heavy project 跑（見 playwright.config.ts）
type Check = { name: string; heavy?: boolean; run: (page: Page) => Promise<void> }

type ManualResult = { target: string; fg: string; bg: string; ratio: number; required: number }

/**
 * 在頁面內執行：對每個選擇器取文字色（SVG 文字取 fill），背景沿祖先往上找第一層不透明背景
 * （半透明背景依序疊在下一層上），計算 WCAG 對比值；大字（≥ 24px，或 ≥ 18.66px 粗體）門檻 3:1，其餘 4.5:1。
 */
function manualContrast(targets: string[]): ManualResult[] {
  type Rgba = [number, number, number, number]
  const parse = (c: string): Rgba | null => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
  }
  const blend = (top: Rgba, bottom: Rgba): Rgba => {
    const a = top[3]
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1]
  }
  const lum = (c: Rgba) => {
    const [r, g, b] = c.slice(0, 3).map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const backgroundOf = (el: Element): Rgba => {
    const layers: Rgba[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg && bg[3] > 0) {
        layers.push(bg)
        if (bg[3] >= 1) break
      }
    }
    // 最底層：html 的背景（理論上 body 已有不透明背景）
    let result: Rgba = parse(getComputedStyle(document.documentElement).backgroundColor) ?? [255, 255, 255, 1]
    if (result[3] < 1) result = [255, 255, 255, 1]
    for (const layer of layers.reverse()) result = blend(layer, result)
    return result
  }
  const out: ManualResult[] = []
  for (const target of targets) {
    for (const el of Array.from(document.querySelectorAll(target))) {
      const style = getComputedStyle(el)
      const isSvgText = el instanceof SVGElement
      const fgRaw = parse(isSvgText ? style.fill : style.color)
      if (!fgRaw) continue
      const bg = backgroundOf(el)
      const fg = fgRaw[3] < 1 ? blend(fgRaw, bg) : fgRaw
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a) as [number, number]
      const size = parseFloat(style.fontSize)
      const bold = Number(style.fontWeight) >= 700
      const large = size >= 24 || (bold && size >= 18.66)
      out.push({
        target,
        fg: `rgb(${fg.slice(0, 3).map(Math.round).join(',')})`,
        bg: `rgb(${bg.slice(0, 3).map(Math.round).join(',')})`,
        ratio: (hi + 0.05) / (lo + 0.05),
        required: large ? 3 : 4.5,
      })
    }
  }
  return out
}

/** 等 CSS 動畫結束後跑 axe color-contrast；有違規時列出元素、前景 / 背景色與比值 */
async function expectContrastAA(page: Page, label: string): Promise<void> {
  await waitForAnimations(page)
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
  const violations = results.violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(' ')} — ${n.failureSummary?.replace(/\s+/g, ' ')}`),
  )
  // axe 無法判定的節點（固定底部列蓋在捲動內容上、面板蓋在頁面上、圖表 SVG 文字）不能直接當作通過：
  // 改以「文字色（SVG 用 fill）對最近一層不透明祖先背景」自行計算比值，同樣要求 AA
  const incompleteTargets = results.incomplete.flatMap((v) => v.nodes.map((n) => n.target.join(' ')))
  const fallback = await page.evaluate(manualContrast, incompleteTargets)
  const fallbackFailures = fallback.filter((r) => r.ratio < r.required)
  if (fallback.length) {
    test.info().annotations.push({
      type: `axe-incomplete ${label}`,
      description: fallback.map((r) => `${r.target} — ${r.fg} / ${r.bg} = ${r.ratio.toFixed(2)}`).join('\n'),
    })
  }
  expect(violations, `${label} 的對比度違規`).toEqual([])
  expect(fallbackFailures, `${label} 的對比度違規（axe 無法判定、改以祖先背景計算）`).toEqual([])
  // 確認真的有檢查到文字（避免空白畫面誤判為通過）
  expect(results.passes.find((p) => p.id === 'color-contrast')?.nodes.length ?? 0, label).toBeGreaterThan(0)
}

const checks: Check[] = [
  {
    name: 'record-empty（含加入主畫面提示條）',
    run: async (page) => {
      await openRecordPage(page)
      await expectContrastAA(page, 'record-empty')
    },
  },
  ...recordStates.map<Check>((s) => ({
    name: s.name,
    run: async (page) => {
      await openRecordPage(page)
      await dismissInstallBanner(page)
      await s.setup(page)
      await expectContrastAA(page, s.name)
    },
  })),
  ...[...stakingStates, ...settingsStates, ...p6States, ...handStates, ...handListStates, ...handExportStates].map<Check>((s) => ({
    name: s.name,
    heavy: 'heavy' in s && s.heavy === true,
    run: async (page) => {
      await s.setup(page)
      await expectContrastAA(page, s.name)
    },
  })),
  ...reportStates.map<Check>((s) => ({
    name: s.name,
    run: async (page) => {
      await s.setup(page)
      await expectContrastAA(page, s.name)
      if (s.lower) {
        await scrollToHeading(page, '累積盈利曲線')
        await expectContrastAA(page, `${s.name}-lower`)
      }
    },
  })),
  ...sessionStates.map<Check>((s) => ({
    name: s.name,
    run: async (page) => {
      await s.setup(page)
      await expectContrastAA(page, s.name)
      if (s.bottom) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await expectContrastAA(page, `${s.name}-bottom`)
      }
    },
  })),
]

for (const scheme of ['dark', 'light'] as const) {
  test.describe(`P6-2 對比度 AA（${scheme === 'dark' ? '深色' : '淺色'}）`, () => {
    // 報表狀態要寫入 200 筆資料並跑兩次 axe，平行執行時可能超過預設 30 秒
    test.describe.configure({ timeout: 90_000 })
    for (const check of checks) {
      test(`P6-2 ${scheme} ${check.name}`, { tag: check.heavy ? ['@heavy'] : [] }, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await check.run(page)
      })
    }
  })
}
