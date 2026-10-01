import { expect, test, type Page } from '@playwright/test'
import type { Session } from '../../src/domain/types'
import { readSettings, readStore } from './helpers/idb'
import { waitForAnimations } from './helpers/layout'
import { addStakeInline, buyInInput, feeInput, openRecordPage, saveButton, setDuration, typeButton } from './helpers/record'
import { metricValue, openReport, reportTab } from './helpers/report'
import {
  fixture,
  fixtureSessions,
  heading,
  openDetail,
  openList,
  rows,
  seed,
  stakedFixture,
  stakedSessions,
  stakes,
  summary,
  uuid,
  venues,
} from './helpers/sessions'

// 10.3 P5.5 賣股份（v1.2）

test.use({ timezoneId: 'Asia/Taipei' })

const section = (page: Page) => page.getByTestId('staking-section')
const backerRows = (page: Page) => page.getByTestId('backer-row')
const toast = (page: Page) => page.getByRole('status').filter({ hasText: '已儲存' })

/** 新增一列出資者並填入名稱、比例（與倍數） */
async function addBacker(page: Page, name: string, share: string, markup?: string) {
  await page.getByRole('button', { name: /^＋ (賣股份|新增出資者)$/ }).click()
  const row = backerRows(page).last()
  if (name !== '') await row.getByLabel('出資者名稱', { exact: true }).fill(name)
  if (share !== '') await row.getByLabel('比例', { exact: true }).fill(share)
  if (markup !== undefined) await row.getByLabel('加價倍數', { exact: true }).fill(markup)
}

async function rowValues(page: Page) {
  return backerRows(page).evaluateAll((els) =>
    els.map((el) =>
      ['出資者名稱', '比例', '加價倍數'].map((label) => {
        const id = [...el.querySelectorAll('label')].find((l) => l.textContent === label)?.htmlFor ?? ''
        return (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''
      }),
    ),
  )
}

/** 去掉 backers：v1（v1.0–v1.1）資料庫中的場次格式 */
function toV1(s: Session): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...s }
  delete copy.backers
  return copy
}

test('P5.5 三種類型各新增一筆含 2 位出資者（其中 1 位加價），DB 內 backers 與輸入一致', async ({ page }) => {
  await openRecordPage(page)
  await expect(section(page)).toHaveAttribute('data-expanded', 'false')

  // ---- 現金桌 ----
  await addStakeInline(page, '50', '100')
  await page.getByLabel('買入（含服務費）', { exact: true }).fill('10000')
  await page.getByLabel('到手金額').fill('12400')
  await addBacker(page, 'Alice', '10')
  await addBacker(page, 'Bob', '20', '1.2')
  await setDuration(page, 3, 0)
  // 全額 +2,400；付款 1,000 + 2,400、分走 1,240 + 2,480 → 你的盈利 = 8,680 − 6,600 = +2,080
  await expect(page.getByTestId('record-preview-line1')).toHaveText('買入 $10,000 · 服務費 $0 · 全額 +$2,400')
  await expect(page.getByTestId('record-preview-line2')).toHaveText('賣出 30% · 你的盈利 +$2,080')
  await saveButton(page).click()
  await expect(toast(page)).toHaveText('已儲存，你的盈利 +$2,080')
  await expect(backerRows(page)).toHaveCount(0)
  await expect(section(page)).toHaveAttribute('data-expanded', 'false')

  // ---- MTT ----
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('3000')
  await feeInput(page, 1).fill('300')
  await page.getByLabel('到手金額').fill('0')
  await addBacker(page, 'Carol', '12.5', '1.15')
  await addBacker(page, 'Dave', '33.3')
  await setDuration(page, 4, 0)
  await saveButton(page).click()
  await expect(toast(page)).toContainText('已儲存，你的盈利')

  // ---- 限時 MTT ----
  await typeButton(page, '限時 MTT').click()
  await buyInInput(page, 1).fill('2000')
  await page.getByLabel('到手金額').fill('5000')
  await addBacker(page, 'Eve', '50', '2.5')
  await addBacker(page, 'Frank', '0.1')
  await setDuration(page, 1, 30)
  await saveButton(page).click()
  await expect(toast(page)).toContainText('已儲存，你的盈利')

  const all = await readStore<Session>(page, 'sessions')
  expect(all).toHaveLength(3)
  const byType = Object.fromEntries(all.map((s) => [s.type, s.backers]))
  expect(byType).toEqual({
    cash: [
      { name: 'Alice', sharePermille: 100, markupPermille: 1000 },
      { name: 'Bob', sharePermille: 200, markupPermille: 1200 },
    ],
    mtt: [
      { name: 'Carol', sharePermille: 125, markupPermille: 1150 },
      { name: 'Dave', sharePermille: 333, markupPermille: 1000 },
    ],
    timed_mtt: [
      { name: 'Eve', sharePermille: 500, markupPermille: 2500 },
      { name: 'Frank', sharePermille: 1, markupPermille: 1000 },
    ],
  })
  // 出資者不存入任何 last* 設定
  const settings = await readSettings(page)
  expect(Object.keys(settings).sort()).toEqual(['lastStakeId', 'lastType', 'lastVenueByType'])
})

test('P5.5 填入出資者後重新載入頁面，草稿還原出資者列；儲存後出資者列清空並收合', async ({ page }) => {
  await openRecordPage(page)
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('10000')
  await page.getByLabel('到手金額').fill('50000')
  await setDuration(page, 2, 0)
  // 含加價、空白列與尚未通過驗證（比例空白）的列
  await addBacker(page, 'A', '10', '1.2')
  await addBacker(page, '', '')
  await addBacker(page, 'B', '')
  await expect
    .poll(async () => ((await readSettings(page)).recordDraft as { values?: { backers?: unknown } } | undefined)?.values?.backers, {
      timeout: 5000,
    })
    .toEqual([
      { name: 'A', share: '10', markup: '1.2' },
      { name: '', share: '', markup: '1.0' },
      { name: 'B', share: '', markup: '1.0' },
    ])

  await page.reload()
  await expect(typeButton(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  await expect(section(page)).toHaveAttribute('data-expanded', 'true')
  await expect(backerRows(page)).toHaveCount(3)
  expect(await rowValues(page)).toEqual([
    ['A', '10', '1.2'],
    ['', '', '1.0'],
    ['B', '', '1.0'],
  ])
  await expect(page.getByTestId('record-preview-line2')).toHaveText('賣出 10% · 你的盈利 —')

  // 補上 B 的比例後儲存：空白列自動移除；儲存後清空並收合，草稿刪除
  await backerRows(page).nth(2).getByLabel('比例', { exact: true }).fill('20')
  await saveButton(page).click()
  await expect(toast(page)).toHaveText('已儲存，你的盈利 +$28,200')
  await expect(backerRows(page)).toHaveCount(0)
  await expect(section(page)).toHaveAttribute('data-expanded', 'false')
  const [saved] = await readStore<Session>(page, 'sessions')
  expect(saved!.backers).toEqual([
    { name: 'A', sharePermille: 100, markupPermille: 1200 },
    { name: 'B', sharePermille: 200, markupPermille: 1000 },
  ])
  await expect.poll(async () => (await readSettings(page)).recordDraft).toBeUndefined()
})

test('P5.5 編輯含出資者的場次可增刪修改出資者並正確寫回；複製為新紀錄帶出出資者列（7.4）', async ({ page }) => {
  await seed(page, { venues, stakes, sessions: [...fixtureSessions, ...stakedSessions] })
  const s14 = stakedFixture.s14
  await openList(page)
  await openDetail(page, s14.id)

  // ---- 7.4 複製為新紀錄：出資者列展開並預填 ----
  await page.getByRole('button', { name: '複製為新紀錄' }).click()
  await expect(heading(page)).toHaveText('新增場次')
  await expect(section(page)).toHaveAttribute('data-expanded', 'true')
  expect(await rowValues(page)).toEqual([
    ['A', '10', '1.2'],
    ['B', '20', '1.2'],
  ])
  await expect(buyInInput(page, 1)).toHaveValue('10,000')
  await expect(page.getByLabel('到手金額')).toHaveValue('')
  await page.getByRole('button', { name: '清除' }).click()

  // ---- 5.7 編輯：修改 A 的比例、刪除 B、新增 C ----
  await openList(page)
  await openDetail(page, s14.id)
  await page.getByRole('button', { name: '編輯' }).click()
  await expect(heading(page)).toHaveText('編輯場次')
  await expect(section(page)).toHaveAttribute('data-expanded', 'true')
  expect(await rowValues(page)).toEqual([
    ['A', '10', '1.2'],
    ['B', '20', '1.2'],
  ])
  await backerRows(page).nth(0).getByLabel('比例', { exact: true }).fill('12.5')
  await backerRows(page).nth(1).getByRole('button', { name: '刪除出資者' }).click()
  await addBacker(page, 'C', '50', '1.15')
  await saveButton(page).click()
  await expect(heading(page)).toHaveText('場次詳情')
  await expect(page.getByTestId('detail-backer')).toHaveText([
    'A · 12.5% · ×1.2付你 $1,500 · 分走 $6,250',
    'C · 50% · ×1.15付你 $5,750 · 分走 $25,000',
  ])
  const stored = (await readStore<Session>(page, 'sessions')).find((s) => s.id === s14.id)!
  expect(stored.backers).toEqual([
    { name: 'A', sharePermille: 125, markupPermille: 1200 },
    { name: 'C', sharePermille: 500, markupPermille: 1150 },
  ])
  expect(stored.createdAt).toBe(s14.createdAt)
  expect(stored.updatedAt).not.toBe(s14.updatedAt)
})

test('P5.5 列表顯示你的盈利與 `賣30%` 標籤；詳情顯示 7.2 的賣股份區塊，C14 場次的數字與 10.2 一致', async ({ page }) => {
  // 錦標賽進場 2 次且有出資者：×2 標籤在前、賣30% 在後
  const double: Session = {
    ...stakedFixture.s14,
    id: uuid(0x53),
    startAt: '2026-09-19T19:00',
    name: 'Double',
    buyIns: [
      { amount: 5000, fee: 0 },
      { amount: 5000, fee: 0 },
    ],
  }
  await seed(page, { venues, stakes, sessions: [...fixtureSessions, ...stakedSessions, double] })
  await openList(page)

  const row = page.locator(`[data-session-id="${stakedFixture.s14.id}"]`)
  await expect(row.getByTestId('row-profit')).toHaveText('+$28,600')
  await expect(row.getByTestId('row-sold-badge')).toHaveText('賣30%')
  // 沒有出資者的場次沒有標籤
  await expect(page.locator(`[data-session-id="${fixture.m1.id}"]`).getByTestId('row-sold-badge')).toHaveCount(0)
  const doubleRow = page.locator(`[data-session-id="${double.id}"]`)
  const badges = await doubleRow.locator('[data-testid="row-badge"], [data-testid="row-sold-badge"]').allTextContents()
  expect(badges).toEqual(['×2', '賣30%'])
  // 月份彙總與篩選彙總為 Σ 你的盈利：fixture 9 月 +1,400 + s14 +28,600 + s23 +2,000 + double +28,600
  await expect(page.locator('[data-month="2026-09"] [data-testid="month-header"]')).toHaveText('2026 年 9 月 · 7 場 · +$60,600')
  await expect(summary(page)).toHaveText('共 10 場 · +$67,600')

  // ---- 詳情（C14） ----
  await openDetail(page, stakedFixture.s14.id)
  await expect(page.getByTestId('detail-profit-label')).toHaveText('你的盈利')
  await expect(page.getByTestId('detail-profit')).toHaveText('+$28,600')
  await expect(page.getByTestId('detail-full-summary')).toHaveText('全額 +$40,000 · 賣出 30%')
  const staking = page.getByTestId('detail-staking')
  await expect(staking.getByRole('heading', { name: '賣股份' })).toBeVisible()
  await expect(page.getByTestId('detail-backer')).toHaveText([
    'A · 10% · ×1.2付你 $1,200 · 分走 $5,000',
    'B · 20% · ×1.2付你 $2,400 · 分走 $10,000',
  ])
  await expect(page.getByTestId('detail-staking-total')).toHaveText('賣出 30% · 出資者付款合計 $3,600 · 分走獎金合計 $15,000')
  await expect(page.getByTestId('detail-staking-buyInTotal')).toHaveText('買入總額$10,000')
  await expect(page.getByTestId('detail-staking-cashOut')).toHaveText('到手金額$50,000')
  await expect(page.getByTestId('detail-staking-fullProfit')).toHaveText('全額盈利+$40,000')
  await expect(page.getByTestId('detail-my-share')).toHaveText('你的份額（你佔 70%）')
  await expect(page.getByTestId('detail-myCost')).toHaveText('你的成本$6,400')
  await expect(page.getByTestId('detail-myCashOut')).toHaveText('你的到手$35,000')
  await expect(page.getByTestId('detail-myProfit')).toHaveText('你的盈利+$28,600')
  // 金額區塊維持全額；時薪以你的盈利計算並改標籤
  await expect(page.getByTestId('detail-buyInTotal')).toHaveText('買入總額$10,000')
  await expect(page.getByTestId('detail-cashOut')).toHaveText('到手金額$50,000')
  await expect(page.getByTestId('detail-hourly')).toHaveText('你的時薪+$5,720/hr')

  // 7.5 刪除確認：盈利為你的盈利並加註「賣 30%」
  await page.getByRole('button', { name: '刪除' }).click()
  await expect(page.getByTestId('delete-sheet-profit')).toHaveText('+$28,600賣 30%')
  await page.getByRole('button', { name: '取消' }).click()

  // 現金桌（C23）：你的 bb 盈利 +20.0 bb、你的時薪 +$1,000/hr
  await openList(page)
  await openDetail(page, stakedFixture.s23.id)
  await expect(page.getByTestId('detail-bbProfit')).toHaveText('你的 bb 盈利+20.0 bb')
  await expect(page.getByTestId('detail-hourly')).toHaveText('你的時薪+$1,000/hr')

  // 沒有出資者的場次不顯示賣股份區塊與標籤
  await openList(page)
  await openDetail(page, fixture.m1.id)
  await expect(page.getByTestId('detail-staking')).toHaveCount(0)
  await expect(page.getByTestId('detail-profit-label')).toHaveCount(0)
  await expect(page.getByTestId('detail-hourly')).toContainText('時薪')
  await expect(page.getByTestId('detail-hourly')).not.toContainText('你的時薪')
})

test.describe('P5.5 報表', () => {
  // C22：第 1 場同 C13 但服務費 1,000；第 2 場買入 3,000、到手 0、無出資者
  const c22a: Session = {
    ...stakedFixture.s14,
    id: uuid(0x61),
    startAt: '2026-09-10T19:00',
    name: 'C22-1',
    buyIns: [{ amount: 10000, fee: 1000 }],
    backers: [
      { name: 'A', sharePermille: 100, markupPermille: 1000 },
      { name: 'B', sharePermille: 200, markupPermille: 1000 },
    ],
    createdAt: '2026-09-10T23:00:00+08:00',
    updatedAt: '2026-09-10T23:00:00+08:00',
  }
  const c22b: Session = {
    ...fixture.t1,
    id: uuid(0x62),
    type: 'mtt',
    startAt: '2026-09-11T19:00',
    buyIns: [{ amount: 3000, fee: 0 }],
    cashOut: 0,
    createdAt: '2026-09-11T23:00:00+08:00',
    updatedAt: '2026-09-11T23:00:00+08:00',
  }

  test('P5.5 有賣股場次時顯示口徑小字，無時不顯示；C22 的資料在 MTT 頁籤顯示 ROI +250.0%、ABI $6,500', async ({ page }) => {
    await seed(page, { venues, stakes, sessions: [c22a, c22b, fixture.c2] })
    await openReport(page)
    const note = page.getByTestId('staking-note')
    await expect(note).toHaveText('含賣股場次，盈利相關指標以你的份額計算')
    // 現金桌頁籤只有沒有出資者的 c2：不顯示
    await reportTab(page, '現金桌').click()
    await expect(note).toHaveCount(0)
    await reportTab(page, 'MTT').click()
    await expect(note).toBeVisible()
    await expect(metricValue(page, 'profit')).toHaveText('+$25,000')
    await expect(metricValue(page, 'winRate')).toHaveText('1/2（50.0%）')
    await expect(metricValue(page, 'roi')).toHaveText('+250.0%')
    await expect(metricValue(page, 'abi')).toHaveText('$6,500')
    await expect(metricValue(page, 'totalBuyIn')).toHaveText('$10,000')
    await expect(metricValue(page, 'totalCashOut')).toHaveText('$35,000')
    await expect(metricValue(page, 'totalFee')).toHaveText('$1,000')
    await expect(metricValue(page, 'feeRate')).toHaveText('7.7%')

    // 6.3 tooltip：該場有出資者時加註「（賣 30%）」
    const dots = page.locator('[data-testid="profit-curve"] .recharts-line-dots circle')
    await page.getByTestId('profit-curve').scrollIntoViewIfNeeded()
    const box = (await dots.nth(0).boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    const tooltip = page.getByTestId('curve-tooltip')
    await expect(tooltip.getByTestId('tooltip-profit')).toHaveText('該場盈利+$28,000（賣 30%）')
    await expect(tooltip.getByTestId('tooltip-cumulative')).toHaveText('累積盈利+$28,000')
    const box2 = (await dots.nth(1).boundingBox())!
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2)
    await expect(tooltip.getByTestId('tooltip-profit')).toHaveText('該場盈利−$3,000')
  })

  test('P5.5 沒有任何賣股場次時不顯示口徑小字', async ({ page }) => {
    await seed(page)
    await openReport(page)
    await expect(page.getByTestId('metric-cards')).toBeVisible()
    await expect(page.getByTestId('staking-note')).toHaveCount(0)
  })
})

test('P5.5 E2E 遷移：以 v1 結構直接寫入 IndexedDB 後載入 App，列表與詳情正常、資料逐欄一致、報表總體不變', async ({ page }) => {
  // 先開同源的靜態檔（不執行 App，不會建立資料庫），以原生 API 建立 Dexie version 1（原生版本 10）的資料庫
  await page.goto('./icons/icon-192.png')
  const v1Sessions = fixtureSessions.map(toV1)
  const v1Settings = [
    { key: 'lastType', value: 'mtt' },
    { key: 'profitColorScheme', value: 'redGain' },
    { key: 'lastBackupAt', value: '2026-09-30T12:00:00+08:00' },
  ]
  await page.evaluate(
    async ({ sessions, venues, stakes, settings }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('poker-tracker', 10)
        req.onupgradeneeded = () => {
          const db = req.result
          const s = db.createObjectStore('sessions', { keyPath: 'id' })
          for (const k of ['type', 'startAt', 'venueId', 'stakeId']) s.createIndex(k, k)
          const v = db.createObjectStore('venues', { keyPath: 'id' })
          v.createIndex('name', 'name')
          v.createIndex('archived', 'archived')
          db.createObjectStore('stakes', { keyPath: 'id' }).createIndex('archived', 'archived')
          db.createObjectStore('settings', { keyPath: 'key' })
        }
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['sessions', 'venues', 'stakes', 'settings'], 'readwrite')
          for (const x of sessions) tx.objectStore('sessions').put(x)
          for (const x of venues) tx.objectStore('venues').put(x)
          for (const x of stakes) tx.objectStore('stakes').put(x)
          for (const x of settings) tx.objectStore('settings').put(x)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      })
    },
    { sessions: v1Sessions, venues, stakes, settings: v1Settings },
  )

  // 載入新版 App：開啟時執行 version 1 → 2 → 3 遷移（v2 起新版為 version 3，SPEC-v2-hands 3.12）
  await page.goto('./#/sessions')
  await expect(heading(page)).toHaveText('紀錄')
  await expect(rows(page)).toHaveCount(7)
  await expect(summary(page)).toHaveText('共 7 場 · +$8,400')
  await expect(page.getByTestId('row-sold-badge')).toHaveCount(0)
  await openDetail(page, fixture.m1.id)
  await expect(page.getByTestId('detail-profit')).toHaveText('+$2,400')
  await expect(page.getByTestId('detail-staking')).toHaveCount(0)

  // 資料逐欄一致：只多了 backers: []
  const stored = await readStore<Session>(page, 'sessions')
  expect(stored).toHaveLength(7)
  for (const s of stored) {
    expect(s.backers).toEqual([])
    expect(toV1(s)).toStrictEqual(v1Sessions.find((x) => x.id === s.id))
  }
  expect(await readStore(page, 'venues')).toEqual(expect.arrayContaining(venues))
  expect(await readStore(page, 'stakes')).toEqual(expect.arrayContaining(stakes))
  expect(await readSettings(page)).toEqual(Object.fromEntries(v1Settings.map((r) => [r.key, r.value])))
  // 原生版本為 30（Dexie version 3；v1.2 時為 20），hands 表為空
  expect(await readStore(page, 'hands')).toEqual([])
  const version = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('poker-tracker')
        req.onsuccess = () => {
          resolve(req.result.version)
          req.result.close()
        }
      }),
  )
  expect(version).toBe(30)

  // 報表總體：與遷移前（v1.1 全額口徑）相同，7 場 +$8,400；遷移不更新 updatedAt，不觸發備份提醒
  await openReport(page)
  await expect(metricValue(page, 'profit')).toHaveText('+$8,400')
  await expect(metricValue(page, 'count')).toHaveText('7')
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0)
})

test('P5.5 版面：375–430px 無橫向捲動；賣股份區塊的可點擊元件觸控區域至少 44×44px', async ({ page }) => {
  await seed(page, { venues, stakes, sessions: [...fixtureSessions, ...stakedSessions] })
  for (const width of [375, 430]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('./')
    await typeButton(page, 'MTT').click()
    await expect(section(page)).toHaveAttribute('data-expanded', 'false')
    const collapsedTargets = section(page).locator('button:visible')
    for (let i = 0; i < (await collapsedTargets.count()); i++) {
      const box = (await collapsedTargets.nth(i).boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
    // 兩列出資者、驗證錯誤與名稱建議同時出現
    await addBacker(page, '一二三四五六七八九十一二三四五六七八九十一', '50', '0.5')
    await addBacker(page, '', '60')
    await saveButton(page).click()
    await expect(page.locator('#rf-backers-total-error')).toBeVisible()
    await backerRows(page).nth(1).getByLabel('出資者名稱', { exact: true }).click()
    await expect(page.getByTestId('backer-suggestions')).toBeVisible()
    await waitForAnimations(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `record ${width}`).toBeLessThanOrEqual(0)
    const targets = section(page).locator('button:visible, input:visible')
    const count = await targets.count()
    expect(count).toBeGreaterThan(5)
    for (let i = 0; i < count; i++) {
      const box = (await targets.nth(i).boundingBox())!
      expect(box.width, `target ${i}`).toBeGreaterThanOrEqual(44)
      expect(box.height, `target ${i}`).toBeGreaterThanOrEqual(44)
    }
    await page.getByRole('button', { name: '清除' }).click()

    for (const hash of ['#/sessions', `#/sessions/${stakedFixture.s14.id}`, '#/report']) {
      await page.goto(`./${hash}`)
      await expect(heading(page)).toBeVisible()
      await expect(page.getByTestId('session-row').first().or(page.getByTestId('detail-staking')).or(page.getByTestId('staking-note'))).toBeVisible()
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(o, `${hash} ${width}`).toBeLessThanOrEqual(0)
    }
  }
})

test('P5.5 預覽列兩行時，正在輸入的欄位不被固定底部列遮住（9.2）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await openRecordPage(page)
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('10000')
  await page.getByLabel('到手金額').fill('50000')
  await addBacker(page, 'A', '10')
  await addBacker(page, 'B', '20', '1.2')
  await expect(page.getByTestId('record-preview')).toHaveAttribute('data-lines', '2')
  const preview = page.getByTestId('record-preview')
  const fields = [
    backerRows(page).nth(0).getByLabel('出資者名稱', { exact: true }),
    backerRows(page).nth(1).getByLabel('比例', { exact: true }),
    backerRows(page).nth(1).getByLabel('加價倍數', { exact: true }),
    page.getByLabel('備註'),
  ]
  for (const field of fields) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await field.focus()
    // 等 useKeepFocusedVisible 的延遲確認（350ms）
    await page.waitForTimeout(450)
    const box = (await field.boundingBox())!
    const barTop = (await preview.boundingBox())!.y
    expect(box.y + box.height).toBeLessThanOrEqual(barTop)
    expect(box.y).toBeGreaterThanOrEqual(0)
  }
})
