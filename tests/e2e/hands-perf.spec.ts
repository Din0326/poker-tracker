import { expect, test, type Page } from '@playwright/test'
import { finalizeHandContent, type Action, type Hand } from '../../src/domain/hands'
import { handSummary, seedGeneratedHands } from './helpers/handsList'
import { putRecords } from './helpers/idb'
import { openRecordPage } from './helpers/record'

// SPEC-v2-hands 11.1、12.3 H2：手牌列表（10,000 手）首次顯示 ≤ 1 秒、切換篩選後畫面更新 ≤ 300ms、捲動不卡頓；
// 手牌詳情（detail 最長、200 筆行動）開啟 ≤ 300ms。開發用 seed（src/dev/handSeed.ts）產生 10,000 手（30% 簡易、70% 完整）。
// 這個 spec 在 playwright.config.ts 的效能 project，其他測試全部跑完才執行（避免平行測試搶 CPU）。
//
// 捲動的門檻比照 tests/e2e/sessions-perf.spec.ts：headless WebKit（軟體繪製）即使只捲動已全部渲染好的 DOM
// 也會有 > 50ms 的 frame，所以採「相對同一次執行的 baseline」——先邊捲邊分批載入，再把已渲染的 DOM 從頭捲一次，
// 只比較分批載入多出的負擔（理由與實測見 sessions-perf.spec.ts 開頭說明）。
// 首次顯示、切換篩選、開啟詳情三項直接採規格的絕對門檻。
const FIRST_RENDER_LIMIT_MS = 1000
const FILTER_LIMIT_MS = 300
const DETAIL_LIMIT_MS = 300
const LONG_FRAME_MS = 50
const LONG_FRAME_RATIO_MARGIN = 0.15
const P95_FLOOR_MS = 80
const P95_BASELINE_FACTOR = 1.5
const MAX_FRAME_FLOOR_MS = 250
const MAX_FRAME_BASELINE_FACTOR = 3
const SCROLL_STEP_PX = 150
const HAND_COUNT = 10_000

test.describe.configure({ mode: 'serial' })
test.use({ trace: 'off' })

/** detail 最長的手牌：2 人桌，翻前 193 次加注 + 跟注，之後三條街都過牌，共 200 筆行動（3.2 上限），進入攤牌 */
function longestHand(): Hand {
  const actions: Action[] = []
  for (let k = 1; k <= 193; k++) actions.push({ street: 'preflop', seatNo: k % 2 === 1 ? 1 : 2, type: 'raise', to: 2 + 2 * k })
  actions.push({ street: 'preflop', seatNo: 2, type: 'call', to: null })
  for (const street of ['flop', 'turn', 'river'] as const) {
    actions.push({ street, seatNo: 2, type: 'check', to: null }, { street, seatNo: 1, type: 'check', to: null })
  }
  expect(actions).toHaveLength(200)
  const ts = '2026-09-30T23:00:00+08:00'
  return {
    id: '00000000-0000-4000-8000-00000000f200',
    exportSeq: HAND_COUNT + 1,
    createdAt: ts,
    updatedAt: ts,
    ...finalizeHandContent({
      source: 'manual',
      gameType: 'cash',
      sessionId: null,
      playedAt: '2026-09-30T22:00:00',
      bb: null,
      heroCards: [],
      heroPosition: null,
      board: ['2c', '7d', '9h', 'Js', '4c'],
      heroNet: null,
      detail: {
        tableSize: 2,
        buttonSeat: 1,
        heroSeat: 1,
        sb: 1,
        bb: 2,
        ante: 0,
        straddle: 0,
        seats: [
          { seatNo: 1, stack: 10000, cards: ['Ah', 'Ad'], mucked: false, name: null },
          { seatNo: 2, stack: 10000, cards: ['Kh', 'Kd'], mucked: false, name: null },
        ],
        actions,
        rake: 0,
        collected: [],
      },
      tags: [],
      note: null,
      sourceHandId: null,
      rawText: null,
      parserVersion: null,
    }),
  }
}

interface ScrollStats {
  frames: number
  rows: number
  medianFrameMs: number
  p95FrameMs: number
  maxFrameMs: number
  longFrames: number
}

/** 每個 frame 往下捲 SCROLL_STEP_PX，直到 expectedRows 筆全部載入並捲到底 */
async function scrollToEnd(page: Page, expectedRows: number): Promise<ScrollStats> {
  return page.evaluate(
    async ({ step, longMs, expected }) => {
      const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
      const rowEls = document.querySelector('main')!.getElementsByTagName('li')
      await frame()
      let last = await frame()
      const gaps: number[] = []
      let stuck = 0
      let lastY = -1
      for (let i = 0; i < 40000; i++) {
        window.scrollBy(0, step)
        const now = await frame()
        gaps.push(now - last)
        last = now
        stuck = window.scrollY === lastY ? stuck + 1 : 0
        lastY = window.scrollY
        if (rowEls.length >= expected && stuck >= 3) break
      }
      const sorted = [...gaps].sort((a, b) => a - b)
      const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0)
      return {
        frames: gaps.length,
        rows: rowEls.length,
        medianFrameMs: at(0.5),
        p95FrameMs: at(0.95),
        maxFrameMs: Math.round(sorted[sorted.length - 1] ?? 0),
        longFrames: gaps.filter((g) => g > longMs).length,
      }
    },
    { step: SCROLL_STEP_PX, longMs: LONG_FRAME_MS, expected: expectedRows },
  )
}

test('12.3 H2 10,000 手時列表首次顯示 ≤ 1 秒、切換篩選 ≤ 300ms、捲動不卡頓；200 筆行動的詳情開啟 ≤ 300ms（11.1）', async ({ page }) => {
  test.setTimeout(900_000)
  await openRecordPage(page)
  const hands = await seedGeneratedHands(page, HAND_COUNT)
  const long = longestHand()
  expect(long.kind).toBe('complete')
  await putRecords(page, 'hands', [long])
  const simple = hands.filter((h) => h.kind === 'simple').length
  // 11.1：30% 簡易、70% 完整
  expect(simple / HAND_COUNT).toBeCloseTo(0.3, 2)
  const total = HAND_COUNT + 1
  const complete = HAND_COUNT - simple + 1

  // ---- 首次顯示：按分頁列「手牌」到第一列畫出來（含讀取 10,001 手、轉成輕量物件、排序、篩選、分組） ----
  const firstRenderMs = await page.evaluate(async () => {
    const link = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].find((a) => a.textContent?.includes('手牌'))
    if (!link) throw new Error('tab link not found')
    const t0 = performance.now()
    link.click()
    await new Promise<void>((resolve) => {
      const check = () => (document.querySelector('[data-testid="hand-row"]') ? resolve() : requestAnimationFrame(check))
      check()
    })
    await new Promise((r) => requestAnimationFrame(r))
    return performance.now() - t0
  })
  await expect(handSummary(page)).toHaveText(`共 ${total} 手（完整 ${complete} 手）`)
  await expect(page.getByTestId('hand-row')).toHaveCount(100)

  // ---- 切換篩選：選單改為「簡易」到彙總與第一列更新完成 ----
  const filterMs = await page.evaluate(async () => {
    const select = document.getElementById('hl-kind') as HTMLSelectElement
    const summary = document.querySelector('[data-testid="hand-list-summary"]')!
    const before = summary.textContent
    const t0 = performance.now()
    select.value = 'simple'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise<void>((resolve) => {
      const check = () => (summary.textContent !== before && document.querySelector('[data-testid="hand-row"]') ? resolve() : requestAnimationFrame(check))
      check()
    })
    await new Promise((r) => requestAnimationFrame(r))
    return performance.now() - t0
  })
  await expect(handSummary(page)).toHaveText(`共 ${simple} 手（完整 0 手）`)
  // 再切回全部（同樣量測，取兩次中較大者）
  const filterBackMs = await page.evaluate(async () => {
    const select = document.getElementById('hl-kind') as HTMLSelectElement
    const summary = document.querySelector('[data-testid="hand-list-summary"]')!
    const before = summary.textContent
    const t0 = performance.now()
    select.value = 'all'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise<void>((resolve) => {
      const check = () => (summary.textContent !== before ? resolve() : requestAnimationFrame(check))
      check()
    })
    await new Promise((r) => requestAnimationFrame(r))
    return performance.now() - t0
  })
  await expect(handSummary(page)).toHaveText(`共 ${total} 手（完整 ${complete} 手）`)

  // ---- 捲動：第一趟邊捲邊分批載入全部；第二趟（baseline）只捲動已渲染的 DOM ----
  const loading = await scrollToEnd(page, total)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  const baseline = await scrollToEnd(page, total)
  const limits = {
    longFrameRatio: baseline.longFrames / baseline.frames + LONG_FRAME_RATIO_MARGIN,
    p95FrameMs: Math.max(P95_FLOOR_MS, baseline.p95FrameMs * P95_BASELINE_FACTOR),
    maxFrameMs: Math.max(MAX_FRAME_FLOOR_MS, baseline.maxFrameMs * MAX_FRAME_BASELINE_FACTOR),
  }

  // ---- 詳情：200 筆行動的手牌，從列表（重新開啟 App 後的第一批 100 筆）改網址到行動列全部畫出來 ----
  // 捲動量測後列表已渲染 10,001 列；重新載入讓量測只反映開啟詳情本身（不含卸載上萬列 DOM 的成本，該成本另記在 detailFromFullListMs）
  const detailFromFullListMs = await page.evaluate(async (id) => {
    const t0 = performance.now()
    location.hash = `#/hands/${id}`
    await new Promise<void>((resolve) => {
      const check = () => (document.querySelectorAll('[data-testid="street-line"]').length >= 202 ? resolve() : requestAnimationFrame(check))
      check()
    })
    return performance.now() - t0
  }, long.id)
  await page.goto('./#/hands')
  await page.reload()
  await expect(page.getByTestId('hand-row')).toHaveCount(100)
  const detailMs = await page.evaluate(async (id) => {
    const t0 = performance.now()
    location.hash = `#/hands/${id}`
    await new Promise<void>((resolve) => {
      const check = () => (document.querySelectorAll('[data-testid="street-line"]').length >= 202 ? resolve() : requestAnimationFrame(check))
      check()
    })
    await new Promise((r) => requestAnimationFrame(r))
    return performance.now() - t0
  }, long.id)
  await expect(page.getByTestId('detail-result-section')).toBeVisible()

  const report = {
    firstRenderMs: Math.round(firstRenderMs),
    filterMs: Math.round(Math.max(filterMs, filterBackMs)),
    detailMs: Math.round(detailMs),
    detailFromFullListMs: Math.round(detailFromFullListMs),
    loading,
    baseline,
    limits,
  }
  console.log(`H2 手牌效能量測：${JSON.stringify(report)}`)
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) })

  expect(firstRenderMs).toBeLessThanOrEqual(FIRST_RENDER_LIMIT_MS)
  expect(Math.max(filterMs, filterBackMs)).toBeLessThanOrEqual(FILTER_LIMIT_MS)
  expect(detailMs).toBeLessThanOrEqual(DETAIL_LIMIT_MS)
  expect(loading.rows).toBe(total)
  expect(loading.longFrames / loading.frames).toBeLessThanOrEqual(limits.longFrameRatio)
  expect(loading.p95FrameMs).toBeLessThanOrEqual(limits.p95FrameMs)
  expect(loading.maxFrameMs).toBeLessThanOrEqual(limits.maxFrameMs)
})
