import { expect, test, type Page } from '@playwright/test'
import dayjs from 'dayjs'
import { generateSeedData } from '../../src/dev/seed'
import { metricValue, openReport, reportTab } from './helpers/report'
import { seed } from './helpers/sessions'

// 10.3 P4-5（6.6）：5,000 筆場次時，切換頁籤或期間後到畫面更新完成的時間（performance.now）。
// 「更新完成」定義：指標卡（盈利）文字與曲線路徑都已改變，且之後再經過兩個 requestAnimationFrame（已繪製）。
// 這個 spec 屬於效能 project（playwright.config.ts），其他測試全部跑完才執行，避免平行測試搶 CPU。
//
// 門檻：規格目標為 iPhone 實機 ≤ 300ms；此環境（headless WebKit）實測遠低於目標，所以直接以 300ms 為每一次量測的上限
//（不另設寬鬆的回歸門檻）。實測數字寫入測試輸出（console 與 annotation）；實機數字仍需 iPhone 實機確認。
const TARGET_MS = 300

test.describe.configure({ mode: 'serial' })
// trace 會在每個動作錄製快照，干擾量測
test.use({ trace: 'off' })

type Step = { kind: 'tab'; label: string } | { kind: 'period'; value: string }

/** 在頁面內觸發切換並量測到畫面更新完成的時間 */
async function measure(page: Page, step: Step): Promise<number> {
  return page.evaluate(async (step) => {
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
    const heroText = () =>
      document.querySelector('[data-testid="metric-card"] [data-testid="metric-value"]')?.textContent ?? ''
    const pathD = () => document.querySelector('[data-testid="profit-curve"] .recharts-line-curve')?.getAttribute('d') ?? ''
    const beforeHero = heroText()
    const beforePath = pathD()

    const t0 = performance.now()
    if (step.kind === 'tab') {
      const group = document.querySelector('[role="group"][aria-label="分類"]')
      const button = [...(group?.querySelectorAll('button') ?? [])].find((b) => b.textContent === step.label)
      if (!button) throw new Error(`tab not found: ${step.label}`)
      button.click()
    } else {
      const select = document.querySelector<HTMLSelectElement>('#rp-period')
      if (!select) throw new Error('period select not found')
      // React 受控元件：以原生 setter 設值再送出 change 事件
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, step.value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    for (let i = 0; i < 600; i++) {
      if (heroText() !== beforeHero && pathD() !== beforePath && pathD() !== '') break
      await frame()
    }
    await frame()
    await frame()
    return performance.now() - t0
  }, step)
}

test('P4-5 5,000 筆：切換頁籤與期間到畫面更新完成的時間', async ({ page }) => {
  test.setTimeout(300_000)
  const data = generateSeedData({ today: dayjs().format('YYYY-MM-DD') })
  expect(data.sessions).toHaveLength(5000)
  await seed(page, data)
  await openReport(page)
  await expect(metricValue(page, 'count')).toHaveText('5000')
  await expect(page.getByTestId('profit-curve')).toHaveAttribute('data-points', '5000')

  const tabSteps: Step[] = [
    { kind: 'tab', label: '現金桌' },
    { kind: 'tab', label: 'MTT' },
    { kind: 'tab', label: '限時 MTT' },
    { kind: 'tab', label: '總體' },
  ]
  const periodSteps: Step[] = [
    { kind: 'period', value: 'last6Months' },
    { kind: 'period', value: 'last3Months' },
    { kind: 'period', value: 'all' },
  ]

  const tabTimes: number[] = []
  const periodTimes: number[] = []
  // 第一輪暖身（JIT、字型等），不計入
  for (const round of [0, 1, 2]) {
    for (const step of tabSteps) {
      const ms = await measure(page, step)
      if (round > 0) tabTimes.push(ms)
    }
    for (const step of periodSteps) {
      const ms = await measure(page, step)
      if (round > 0) periodTimes.push(ms)
    }
  }
  // 量測結束後狀態正確：總體、全部期間
  await expect(reportTab(page, '總體')).toHaveAttribute('aria-pressed', 'true')
  await expect(metricValue(page, 'count')).toHaveText('5000')

  const stats = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b)
    return {
      n: xs.length,
      medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]!),
      maxMs: Math.round(sorted[sorted.length - 1]!),
      all: xs.map(Math.round),
    }
  }
  const report = { targetMs: TARGET_MS, tab: stats(tabTimes), period: stats(periodTimes) }
  console.log(`P4-5 效能量測：${JSON.stringify(report)}`)
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) })

  for (const ms of [...tabTimes, ...periodTimes]) expect(ms).toBeLessThanOrEqual(TARGET_MS)
})
