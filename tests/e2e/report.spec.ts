import { expect, test, type Page } from '@playwright/test'
import {
  groupByButton,
  groupLabels,
  groupRow,
  manySessions,
  metricLabels,
  metricValue,
  metricValues,
  openReport,
  reportTab,
  timedAt,
} from './helpers/report'
import { waitForAnimations } from './helpers/layout'
import { openSettings } from './helpers/settings'
import { fixture, hashPath, heading, nav, rows, seed, stakes, summary, typeFilter, venues } from './helpers/sessions'

// 10.3 P4 報表（第 6 節）
// 資料：tests/e2e/helpers/sessions.ts 的 7 筆固定場次（現金桌 3、MTT 2、限時 MTT 2）

/** 固定「今天」（4.5 期間以本地日期判斷）；須在開啟頁面前呼叫 */
async function fixToday(page: Page, localDateTime: string) {
  await page.clock.setFixedTime(new Date(localDateTime))
}

async function seedAndOpen(page: Page) {
  await fixToday(page, '2026-09-30T12:00:00')
  await seed(page)
  await openReport(page)
}

const LABELS = {
  all: ['盈利', '場次數', '贏率', '總時數', '總投入', '總到手', '總服務費', '服務費比例'],
  cash: ['盈利', '場次數', '贏率', '時薪', 'bb/hr', '平均每場盈利', '總時數', '總投入', '總到手', '總服務費', '服務費比例'],
  mtt: [
    '盈利',
    '場次數',
    '贏率',
    'ROI',
    '時薪',
    'ITM%',
    '平均名次百分位',
    '平均每場盈利',
    '平均單次買入（ABI）',
    '平均進場次數',
    '總時數',
    '總投入',
    '總到手',
    '總服務費',
    '服務費比例',
  ],
  timed_mtt: [
    '盈利',
    '場次數',
    '贏率',
    'ROI',
    '時薪',
    '平均每場盈利',
    '平均單次買入（ABI）',
    '平均進場次數',
    '總時數',
    '總投入',
    '總到手',
    '總服務費',
    '服務費比例',
  ],
}

// ---------------------------------------------------------------------------
// P4-1 各頁籤指標
// ---------------------------------------------------------------------------

test('P4-1 四個頁籤顯示的指標與順序完全照 6.2 表格，預設為總體', async ({ page }) => {
  await seedAndOpen(page)
  await expect(reportTab(page, '總體')).toHaveAttribute('aria-pressed', 'true')
  expect(await metricLabels(page)).toEqual(LABELS.all)
  for (const [label, key] of [
    ['現金桌', 'cash'],
    ['MTT', 'mtt'],
    ['限時 MTT', 'timed_mtt'],
    ['總體', 'all'],
  ] as const) {
    await reportTab(page, label).click()
    await expect(reportTab(page, label)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('report-content')).toHaveAttribute('data-tab', key)
    expect(await metricLabels(page), label).toEqual(LABELS[key])
  }
  // 第一張「盈利」橫跨整列（寬度約為其他卡的兩倍）
  const cards = page.getByTestId('metric-card')
  const first = (await cards.nth(0).boundingBox())!
  const second = (await cards.nth(1).boundingBox())!
  expect(first.width).toBeGreaterThan(second.width * 1.9)
})

test('P4-1 已知資料的指標數值（ROI、時薪、bb/hr、ITM%、平均名次百分位、ABI、平均進場次數、服務費比例）', async ({ page }) => {
  await seedAndOpen(page)
  expect(await metricValues(page)).toEqual({
    profit: '+$8,400',
    count: '7',
    winRate: '4/7（57.1%）',
    totalHours: '26.3 小時',
    totalBuyIn: '$48,100',
    totalCashOut: '$56,500',
    totalFee: '$1,900',
    feeRate: '4.0%',
  })

  await reportTab(page, '現金桌').click()
  // c1 +2,000（50/100）、c2 −1,000（50/100）、a1 +6,000（100/200，已封存）；共 690 分鐘
  // bb/hr = (20 − 10 + 30) ÷ 11.5 = 3.48
  expect(await metricValues(page)).toEqual({
    profit: '+$7,000',
    count: '3',
    winRate: '2/3（66.7%）',
    hourly: '+$609/hr',
    bbPerHour: '+3.5 bb/hr',
    avgProfit: '+$2,333',
    totalHours: '11.5 小時',
    totalBuyIn: '$35,000',
    totalCashOut: '$42,000',
    totalFee: '$800',
    feeRate: '2.3%',
  })

  await reportTab(page, 'MTT').click()
  // m1：買入 3,400 + 3,200、到手 9,000、12/180；a2：買入 3,400、到手 0、只填人數
  expect(await metricValues(page)).toEqual({
    profit: '−$1,000',
    count: '2',
    winRate: '1/2（50.0%）',
    roi: '−10.0%',
    hourly: '−$98/hr',
    itm: '1/2（50.0%）',
    placePercentile: '前 6.7%（n=1）',
    avgProfit: '−$500',
    abi: '$3,333',
    avgEntries: '1.50',
    totalHours: '10.3 小時',
    totalBuyIn: '$10,000',
    totalCashOut: '$9,000',
    totalFee: '$1,000',
    feeRate: '10.0%',
  })

  await reportTab(page, '限時 MTT').click()
  expect(await metricValues(page)).toEqual({
    profit: '+$2,400',
    count: '2',
    winRate: '1/2（50.0%）',
    roi: '+77.4%',
    hourly: '+$533/hr',
    avgProfit: '+$1,200',
    abi: '$1,550',
    avgEntries: '1.00',
    totalHours: '4.5 小時',
    totalBuyIn: '$3,100',
    totalCashOut: '$5,500',
    totalFee: '$100',
    feeRate: '3.2%',
  })
})

test('帶正負號的指標依 gain / loss token 上色，0 與不帶號的指標不上色', async ({ page }) => {
  await seedAndOpen(page)
  await reportTab(page, 'MTT').click()
  const color = (key: string) => metricValue(page, key).evaluate((el) => getComputedStyle(el).color)
  const loss = await page.evaluate(() => {
    const el = document.createElement('span')
    el.style.color = 'var(--color-loss)'
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  })
  for (const key of ['profit', 'roi', 'hourly', 'avgProfit']) expect(await color(key), key).toBe(loss)
  for (const key of ['count', 'abi', 'totalBuyIn']) expect(await color(key), key).not.toBe(loss)
})

// ---------------------------------------------------------------------------
// P4-2 期間篩選（4.5、C9、C10）
// ---------------------------------------------------------------------------

test('P4-2 期間篩選：近三個月（C9 月底收斂）、近半年、自訂同一天（C10）', async ({ page }) => {
  // 今天 2026-05-31：近三個月起日 2026-02-28 00:00，近半年起日 2025-11-30 00:00
  await fixToday(page, '2026-05-31T23:30:00')
  const sessions = [
    timedAt(1, '2025-11-29T23:00', 1), // 近半年之前一天
    timedAt(2, '2025-11-30T00:00', 10), // 近半年起日 00:00
    timedAt(3, '2026-02-27T23:00', 100), // 近三個月之前一天
    timedAt(4, '2026-02-28T00:00', 1000), // 近三個月起日 00:00
    timedAt(5, '2026-03-14T23:00', 10000),
    timedAt(6, '2026-03-15T00:00', 20000), // 自訂同一天 00:00
    timedAt(7, '2026-03-15T23:00', 40000), // 自訂同一天 23:00
    timedAt(8, '2026-03-16T00:00', 80000),
    timedAt(9, '2026-05-31T23:00', 160000), // 今天
  ]
  await seed(page, { sessions })
  await openReport(page)
  await expect(metricValue(page, 'count')).toHaveText('9')

  await page.getByLabel('期間').selectOption({ label: '近三個月' })
  await expect(metricValue(page, 'count')).toHaveText('6')
  await expect(metricValue(page, 'profit')).toHaveText('+$311,000')

  await page.getByLabel('期間').selectOption({ label: '近半年' })
  await expect(metricValue(page, 'count')).toHaveText('8')
  await expect(metricValue(page, 'profit')).toHaveText('+$311,110')

  // 自訂：起迄未填齊不套用
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  await expect(metricValue(page, 'count')).toHaveText('9')
  await page.getByLabel('起日').fill('2026-03-15')
  await expect(metricValue(page, 'count')).toHaveText('9')
  await page.getByLabel('迄日').fill('2026-03-15')
  await expect(metricValue(page, 'count')).toHaveText('2')
  await expect(metricValue(page, 'profit')).toHaveText('+$60,000')
  // 曲線也只含期間內的場次，並從 0 開始累積
  await expect(page.getByTestId('profit-curve')).toHaveAttribute('data-points', '2')

  // 起日晚於迄日：顯示錯誤且不套用期間
  await page.getByLabel('起日').fill('2026-03-16')
  await expect(page.getByText('起日不可晚於迄日')).toBeVisible()
  await expect(page.getByLabel('起日')).toHaveAttribute('aria-invalid', 'true')
  await expect(metricValue(page, 'count')).toHaveText('9')
})

// ---------------------------------------------------------------------------
// P4-3 累積盈利曲線
// ---------------------------------------------------------------------------

const dots = (page: Page) => page.locator('[data-testid="profit-curve"] .recharts-line-dots circle')

test('P4-3 曲線：0 筆顯示期間無紀錄、1 筆顯示提示、2 筆畫線與資料點、600 筆不畫點圓圈；Y=0 基準線', async ({ page }) => {
  await fixToday(page, '2026-09-30T12:00:00')
  const many = manySessions(600)
  await seed(page, { venues, stakes, sessions: [...Object.values(fixture), ...many] })
  await openReport(page)

  // 600 筆（MTT 頁籤：固定資料 2 筆 + 600 筆）
  await reportTab(page, 'MTT').click()
  const curve = page.getByTestId('profit-curve')
  await expect(curve).toHaveAttribute('data-points', '602')
  await expect(curve.locator('.recharts-line-curve')).toHaveCount(1)
  await expect(dots(page)).toHaveCount(0)
  await expect(curve.locator('.recharts-reference-line')).toHaveCount(1)

  // 2 筆：自訂期間只含 m1、a2
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  await page.getByLabel('起日').fill('2026-08-01')
  await page.getByLabel('迄日').fill('2026-09-30')
  await expect(curve).toHaveAttribute('data-points', '2')
  await expect(curve.locator('.recharts-line-curve')).toHaveCount(1)
  await expect(dots(page)).toHaveCount(2)
  const baseline = curve.locator('.recharts-reference-line line')
  await expect(baseline).toHaveAttribute('stroke-dasharray', /\d/)
  // 基準線在 Y=0：累積盈利 −3,400 → −1,000 都在 0 之下，基準線仍畫出（擴充 Y 軸範圍）且位於兩點上方
  const y0 = (await baseline.boundingBox())!.y
  const points = await dots(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
  expect(y0).toBeLessThan(Math.min(...points))

  // 1 筆：只含 m1
  await page.getByLabel('起日').fill('2026-09-01')
  await expect(page.getByText('至少需要 2 場紀錄才能畫出曲線')).toBeVisible()
  await expect(curve).toHaveCount(0)

  // 0 筆：期間內沒有紀錄（6.5）
  await page.getByLabel('起日').fill('2026-09-20')
  await expect(page.getByTestId('curve-no-records')).toHaveText('這個期間沒有紀錄')
  await expect(page.getByTestId('groups-empty')).toHaveText('這個期間沒有紀錄')
  await expect(curve).toHaveCount(0)
})

test('曲線 tooltip：點按資料點顯示日期、類型、該場盈利、累積盈利；滑過改變顯示的場次', async ({ page }) => {
  await seedAndOpen(page)
  const curve = page.getByTestId('profit-curve')
  await curve.scrollIntoViewIfNeeded()
  // 總體 7 筆由舊到新：old1 +4,400、a2 −3,400、a1 +6,000、t1 −2,000、m1 +2,400、c1 +2,000、c2 −1,000
  const pointBox = async (i: number) => (await dots(page).nth(i).boundingBox())!
  const p3 = await pointBox(2)
  await page.touchscreen.tap(p3.x + p3.width / 2, p3.y + p3.height / 2)
  const tooltip = page.getByTestId('curve-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip.getByTestId('tooltip-heading')).toHaveText('2026/08/31 · 現金桌')
  await expect(tooltip.getByTestId('tooltip-profit')).toHaveText('該場盈利+$6,000')
  await expect(tooltip.getByTestId('tooltip-cumulative')).toHaveText('累積盈利+$7,000')

  const p4 = await pointBox(3)
  await page.mouse.move(p4.x + p4.width / 2, p4.y + p4.height / 2)
  await expect(tooltip.getByTestId('tooltip-heading')).toHaveText('2026/09/01 · 限時 MTT')
  await expect(tooltip.getByTestId('tooltip-profit')).toHaveText('該場盈利−$2,000')
  await expect(tooltip.getByTestId('tooltip-cumulative')).toHaveText('累積盈利+$5,000')
})

// ---------------------------------------------------------------------------
// 6.3 水上水下顏色（v1.4）
// ---------------------------------------------------------------------------

/** 依序產生每場盈利為 profits[i] 的限時 MTT（每天一場），累積值即 profits 的前綴和 */
function curveSessions(profits: number[]) {
  return profits.map((profit, i) => {
    const s = timedAt(100 + i, `2026-09-${String(i + 1).padStart(2, '0')}T20:00`, profit)
    const buy = 10000
    return { ...s, buyIns: [{ amount: buy, fee: 0 }], cashOut: buy + profit }
  })
}

async function openCurve(page: Page, profits: number[]) {
  await fixToday(page, '2026-09-30T12:00:00')
  await seed(page, { sessions: curveSessions(profits) })
  await openReport(page)
  const curve = page.getByTestId('profit-curve')
  await expect(curve).toHaveAttribute('data-points', String(profits.length))
  await curve.scrollIntoViewIfNeeded()
  return curve
}

/** 解析目前的 --color-gain / --color-loss 實際色值 */
const toneColors = (page: Page) =>
  page.evaluate(() => {
    const resolve = (token: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${token})`
      document.body.append(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    }
    return { gain: resolve('--color-gain'), loss: resolve('--color-loss') }
  })

/** 曲線 path 的 stroke 屬性、計算後顏色，以及（若指向漸層）漸層 stops 的 offset 與計算後顏色 */
const curveStrokeInfo = (page: Page) =>
  page.locator('[data-testid="profit-curve"] .recharts-line-curve').evaluate((path) => {
    const attr = path.getAttribute('stroke') ?? ''
    const m = /^url\(#([^)]+)\)$/.exec(attr)
    const gradient = m ? document.getElementById(m[1]!) : null
    const stops = gradient
      ? [...gradient.querySelectorAll('stop')].map((s) => ({
          offset: Number(s.getAttribute('offset')),
          color: getComputedStyle(s).stopColor,
        }))
      : null
    return {
      attr,
      computed: getComputedStyle(path).stroke,
      gradientTag: gradient?.tagName ?? null,
      units: gradient?.getAttribute('gradientUnits') ?? null,
      stops,
    }
  })

const dotFills = (page: Page) => dots(page).evaluateAll((els) => els.map((el) => getComputedStyle(el).fill))

test('6.3 水上水下顏色：跨 0 時線條以 linearGradient 在 y = 0 硬切換，圓點與作用中圓點依正負著色，隨盈虧顏色設定改變', async ({
  page,
}) => {
  // 累積值 +1,000、−500、+300 → max 1,000、min −500，切換點 offset = 1000 / 1500
  const curve = await openCurve(page, [1000, -1500, 800])
  const red = await toneColors(page)
  expect(red.gain).not.toBe(red.loss)

  const info = await curveStrokeInfo(page)
  expect(info.attr).toMatch(/^url\(#[A-Za-z0-9_-]+\)$/)
  expect(info.gradientTag).toBe('linearGradient')
  // 預設 objectBoundingBox（bbox = 線條 path 的資料 min～max）
  expect(info.units).toBeNull()
  expect(info.stops!.map((s) => s.color)).toEqual([red.gain, red.gain, red.loss, red.loss])
  const offsets = info.stops!.map((s) => s.offset)
  expect(offsets[0]).toBe(0)
  expect(offsets[1]).toBeCloseTo(1000 / 1500, 3)
  expect(offsets[2]).toBeCloseTo(1000 / 1500, 3)
  expect(offsets[3]).toBe(1)
  expect(Math.abs(offsets[1]! - 2 / 3)).toBeLessThan(0.001)

  // 幾何驗證：切換點換算成像素後與 Y=0 基準線同高（容差 1px）
  const geo = await curve.evaluate((el, offset) => {
    const path = el.querySelector<SVGPathElement>('.recharts-line-curve')!
    const line = el.querySelector<SVGLineElement>('.recharts-reference-line line')!
    const b = path.getBBox()
    return { split: b.y + offset * b.height, baseline: Number(line.getAttribute('y1')) }
  }, offsets[1]!)
  expect(Math.abs(geo.split - geo.baseline)).toBeLessThan(1)

  // 資料點圓圈依累積值：+1,000 gain、−500 loss、+300 gain
  await expect(dots(page)).toHaveCount(3)
  expect(await dotFills(page)).toEqual([red.gain, red.loss, red.gain])

  // tooltip 啟用時的作用中圓點同理
  const activeDot = curve.locator('.recharts-active-dot circle')
  for (const [i, tone] of [
    [1, 'loss'],
    [2, 'gain'],
  ] as const) {
    const box = (await dots(page).nth(i).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByTestId('curve-tooltip')).toBeVisible()
    await expect(activeDot).toHaveCount(1)
    await expect(activeDot).toHaveCSS('fill', red[tone])
  }

  // 切換盈虧顏色（綠色為贏）後回到報表：gain / loss 對調，曲線跟著改變
  await openSettings(page)
  await page.getByRole('group', { name: '盈虧顏色' }).getByRole('button', { name: '綠色為贏、紅色為輸' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'greenGain')
  await openReport(page)
  const green = await toneColors(page)
  expect(green).toEqual({ gain: red.loss, loss: red.gain })
  const after = await curveStrokeInfo(page)
  expect(after.stops!.map((s) => s.color)).toEqual([green.gain, green.gain, green.loss, green.loss])
  expect(await dotFills(page)).toEqual([green.gain, green.loss, green.gain])
})

test('6.3 水上水下顏色：全部 ≥ 0 整條 gain（單色，不用漸層），剛好 0 的點視為水上', async ({ page }) => {
  // 累積值 0、+500、+200：全部在 0 以上
  await openCurve(page, [0, 500, -300])
  const c = await toneColors(page)
  const info = await curveStrokeInfo(page)
  expect(info.attr).toBe('var(--color-gain)')
  expect(info.computed).toBe(c.gain)
  expect(info.stops).toBeNull()
  await expect(page.getByTestId('curve-gradient')).toHaveCount(0)
  expect(await dotFills(page)).toEqual([c.gain, c.gain, c.gain])
})

test('6.3 水上水下顏色：全部 < 0 整條 loss（單色，不用漸層）', async ({ page }) => {
  // 累積值 −200、−700：全部在 0 以下
  await openCurve(page, [-200, -500])
  const c = await toneColors(page)
  const info = await curveStrokeInfo(page)
  expect(info.attr).toBe('var(--color-loss)')
  expect(info.computed).toBe(c.loss)
  expect(info.stops).toBeNull()
  expect(await dotFills(page)).toEqual([c.loss, c.loss])
})

test('6.3 水上水下顏色：全部相同值（path 高度 0）時線條仍可見，stroke 不是失效的 url', async ({ page }) => {
  // 累積值 +500、+500、+500
  const curve = await openCurve(page, [500, 0, 0])
  const c = await toneColors(page)
  const info = await curveStrokeInfo(page)
  expect(info.attr).not.toMatch(/url\(/)
  expect(info.computed).toBe(c.gain)
  const box = (await curve.locator('.recharts-line-curve').boundingBox())!
  expect(box.width).toBeGreaterThan(100)
  expect(box.height).toBeGreaterThan(0)
})

// ---------------------------------------------------------------------------
// P4-4 分組 → 紀錄列表
// ---------------------------------------------------------------------------

async function expectList(
  page: Page,
  opts: { type: '全部' | '現金桌' | 'MTT' | '限時 MTT'; period: string; tags: string[]; count: number },
) {
  await expect(heading(page)).toHaveText('紀錄')
  await expect(typeFilter(page, opts.type)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('期間')).toHaveValue(opts.period)
  await expect(page.getByTestId('filter-tag')).toHaveText(opts.tags)
  await expect(summary(page)).toContainText(`共 ${opts.count} 場`)
  await expect(rows(page)).toHaveCount(opts.count)
}

test('P4-4 分組排序、欄位與已封存標示', async ({ page }) => {
  await seedAndOpen(page)
  // 總體：場地（唯一選項）
  await expect(groupByButton(page, '場地')).toHaveAttribute('aria-pressed', 'true')
  expect(await groupLabels(page)).toEqual(['6bet', '舊場館（已封存）', '未指定'])
  await expect(groupRow(page, '6bet').getByTestId('group-cell')).toHaveText(['場次數3', '盈利+$8,800', '總服務費$1,000'])

  await reportTab(page, '現金桌').click()
  expect(await groupLabels(page)).toEqual(['舊場館（已封存）', '6bet', '未指定'])
  await groupByButton(page, '盲注級別').click()
  expect(await groupLabels(page)).toEqual(['100/200（已封存）', '50/100'])
  await expect(groupRow(page, '50/100').getByTestId('group-cell')).toHaveText([
    '場次數2',
    '盈利+$1,000',
    '時薪+$154/hr',
    'bb/hr+1.5 bb/hr',
  ])

  // 切換頁籤時分組依據重設為該頁籤第一個選項
  await reportTab(page, 'MTT').click()
  await expect(groupByButton(page, '場地')).toHaveAttribute('aria-pressed', 'true')
  await groupByButton(page, '名稱').click()
  expect(await groupLabels(page)).toEqual(['週日賽'])
  await expect(groupRow(page, '週日賽').getByTestId('group-cell')).toHaveText([
    '場次數2',
    '盈利−$1,000',
    'ROI−10.0%',
    'ITM%1/2（50.0%）',
  ])

  await reportTab(page, '限時 MTT').click()
  await groupByButton(page, '名稱').click()
  expect(await groupLabels(page)).toEqual(['Summer Cup', '未命名'])
})

test('P4-4 點分組跳到紀錄列表並套用類型、期間與分組篩選（場地、盲注、名稱、未指定、未命名）', async ({ page }) => {
  await seedAndOpen(page)

  // 場地：總體 + 近三個月 → 列表類型全部、期間近三個月、標籤「場地：6bet」
  await page.getByLabel('期間').selectOption({ label: '近三個月' })
  await groupRow(page, '6bet').click()
  await expectList(page, { type: '全部', period: 'last3Months', tags: ['場地：6bet'], count: 3 })
  expect(hashPath(page)).toMatch(/^\/sessions\?venue=/)

  // 盲注：現金桌 50/100
  await openReport(page)
  await reportTab(page, '現金桌').click()
  await groupByButton(page, '盲注級別').click()
  await groupRow(page, '50/100').click()
  await expectList(page, { type: '現金桌', period: 'last3Months', tags: ['盲注：50/100'], count: 2 })

  // 未指定：現金桌場地「未指定」（c2）
  await openReport(page)
  await groupByButton(page, '場地').click()
  await groupRow(page, '未指定').click()
  await expectList(page, { type: '現金桌', period: 'last3Months', tags: ['場地：未指定'], count: 1 })

  // 名稱：MTT 自訂期間 2026-08-01 – 2026-09-30「週日賽」（m1、a2）
  await openReport(page)
  await reportTab(page, 'MTT').click()
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  await page.getByLabel('起日').fill('2026-08-01')
  await page.getByLabel('迄日').fill('2026-09-30')
  await groupByButton(page, '名稱').click()
  await groupRow(page, '週日賽').click()
  await expectList(page, { type: 'MTT', period: 'custom', tags: ['名稱：週日賽'], count: 2 })
  await expect(page.getByLabel('起日')).toHaveValue('2026-08-01')
  await expect(page.getByLabel('迄日')).toHaveValue('2026-09-30')

  // 未命名：限時 MTT 全部期間（t1）
  await openReport(page)
  await reportTab(page, '限時 MTT').click()
  await page.getByLabel('期間').selectOption({ label: '全部' })
  await groupByButton(page, '名稱').click()
  await groupRow(page, '未命名').click()
  await expectList(page, { type: '限時 MTT', period: 'all', tags: ['名稱：未命名'], count: 1 })
  await expect(page.locator(`[data-session-id="${fixture.t1.id}"]`)).toBeVisible()
})

// ---------------------------------------------------------------------------
// 總體小表、狀態保留、空狀態
// ---------------------------------------------------------------------------

test('總體小表：三種類型的場次數與盈利，點擊整列切換到該類型頁籤（期間不變）', async ({ page }) => {
  await seedAndOpen(page)
  const rowsOf = page.getByTestId('type-breakdown-row')
  await expect(rowsOf).toHaveCount(3)
  await expect(rowsOf.getByTestId('breakdown-count')).toHaveText(['3 場', '2 場', '2 場'])
  await expect(rowsOf.getByTestId('breakdown-profit')).toHaveText(['+$7,000', '−$1,000', '+$2,400'])

  await page.getByLabel('期間').selectOption({ label: '近三個月' })
  await page.getByTestId('type-breakdown-row').filter({ hasText: 'MTT' }).first().click()
  await expect(reportTab(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('期間')).toHaveValue('last3Months')
  await expect(page.getByTestId('type-breakdown-row')).toHaveCount(0)

  await reportTab(page, '總體').click()
  await page.locator('[data-testid="type-breakdown-row"][data-type="timed_mtt"]').click()
  await expect(reportTab(page, '限時 MTT')).toHaveAttribute('aria-pressed', 'true')
})

test('6.1 頁籤、期間與分組依據在切到其他分頁再回來時保留', async ({ page }) => {
  await seedAndOpen(page)
  await reportTab(page, '現金桌').click()
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  await page.getByLabel('起日').fill('2026-09-01')
  await page.getByLabel('迄日').fill('2026-09-30')
  await groupByButton(page, '盲注級別').click()
  await expect(metricValue(page, 'count')).toHaveText('2')

  for (const tab of ['新增', '紀錄', '設定']) {
    await nav(page).getByRole('link', { name: tab }).click()
    await expect(heading(page)).not.toHaveText('報表')
    await openReport(page)
    await expect(reportTab(page, '現金桌')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('期間')).toHaveValue('custom')
    await expect(page.getByLabel('起日')).toHaveValue('2026-09-01')
    await expect(page.getByLabel('迄日')).toHaveValue('2026-09-30')
    await expect(groupByButton(page, '盲注級別')).toHaveAttribute('aria-pressed', 'true')
    await expect(metricValue(page, 'count')).toHaveText('2')
  }

  // App 重啟（重新載入）後回到預設
  await page.reload()
  await expect(reportTab(page, '總體')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('期間')).toHaveValue('all')
})

test('6.5 完全沒有紀錄：整頁顯示「還沒有紀錄」與「去新增第一場」', async ({ page }) => {
  await page.goto('./#/report')
  await expect(page.getByText('還沒有紀錄')).toBeVisible()
  await expect(page.getByRole('group', { name: '分類' })).toHaveCount(0)
  await page.getByRole('link', { name: '去新增第一場' }).click()
  await expect(heading(page)).toHaveText('新增場次')
})

test('6.5 有紀錄但期間沒有符合的：指標卡顯示 —（場次數 0、金額 $0），圖表與分組顯示「這個期間沒有紀錄」', async ({ page }) => {
  await seedAndOpen(page)
  await reportTab(page, 'MTT').click()
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  await page.getByLabel('起日').fill('2025-01-01')
  await page.getByLabel('迄日').fill('2025-01-31')
  await expect(metricValue(page, 'count')).toHaveText('0')
  expect(await metricValues(page)).toEqual({
    profit: '$0',
    count: '0',
    winRate: '—',
    roi: '—',
    hourly: '—',
    itm: '—',
    placePercentile: '—',
    avgProfit: '—',
    abi: '—',
    avgEntries: '—',
    totalHours: '0.0 小時',
    totalBuyIn: '$0',
    totalCashOut: '$0',
    totalFee: '$0',
    feeRate: '—',
  })
  await expect(page.getByTestId('curve-no-records')).toHaveText('這個期間沒有紀錄')
  await expect(page.getByTestId('groups-empty')).toHaveText('這個期間沒有紀錄')
})

// ---------------------------------------------------------------------------
// 9.x 版面
// ---------------------------------------------------------------------------

test('報表：觸控區域至少 44×44、375 與 430px 無橫向捲動', async ({ page }) => {
  await seedAndOpen(page)
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  for (const width of [375, 430]) {
    await page.setViewportSize({ width, height: 800 })
    for (const tab of ['總體', '現金桌', 'MTT', '限時 MTT'] as const) {
      await reportTab(page, tab).click()
      await waitForAnimations(page)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${width} ${tab}`).toBeLessThanOrEqual(0)
      const targets = page.locator('main a:visible, main button:visible, main select:visible, main input:visible')
      const count = await targets.count()
      expect(count).toBeGreaterThan(0)
      for (let i = 0; i < count; i++) {
        const box = (await targets.nth(i).boundingBox())!
        expect(box.width, `${width} ${tab} target ${i}`).toBeGreaterThanOrEqual(44)
        expect(box.height, `${width} ${tab} target ${i}`).toBeGreaterThanOrEqual(44)
      }
    }
  }
})

test.describe('lazy chunk', () => {
  // 封鎖 service worker，避免預先快取的請求混入量測
  test.use({ serviceWorkers: 'block' })
  test('報表頁為獨立 chunk：首頁載入時不下載 Recharts，進入報表才載入', async ({ page }) => {
    const scripts: string[] = []
    page.on('request', (r) => {
      if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
    })
    await page.goto('./')
    await expect(heading(page)).toHaveText('新增場次')
    expect(scripts.some((s) => /ReportPage/.test(s))).toBe(false)
    await openReport(page)
    expect(scripts.some((s) => /ReportPage/.test(s))).toBe(true)
  })
})
