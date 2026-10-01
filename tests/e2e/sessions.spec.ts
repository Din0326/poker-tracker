import { expect, test } from '@playwright/test'
import dayjs from 'dayjs'
import { generateSeedData } from '../../src/dev/seed'
import type { Session } from '../../src/domain/types'
import { readSettings, readStore } from './helpers/idb'
import { waitForAnimations } from './helpers/layout'
import {
  S_100,
  S_50,
  V_6BET,
  V_OLD,
  fixture,
  fixtureOrder,
  hashPath,
  heading,
  monthHeaders,
  nav,
  openDetail,
  openList,
  rowIds,
  seed,
  stakes,
  summary,
  typeFilter,
  uuid,
  venues,
} from './helpers/sessions'

// 10.3 P3 紀錄列表、詳情、編輯、複製、刪除與復原（第 7 節、5.7）

const MINUS = '−'
const f = fixture

// ---------------------------------------------------------------------------
// 10.3 P3-1 列表排序與月份彙總符合 7.1
// ---------------------------------------------------------------------------

test('P3-1 列表排序與月份彙總符合 7.1（同 startAt 依 createdAt、跨月、月份標題場次數與盈利）', async ({ page }) => {
  await seed(page)
  await openList(page)

  // 排序：startAt 由新到舊；c1、c2 同 startAt，c2 較晚建立排前面
  expect(await rowIds(page)).toEqual(fixtureOrder)

  // 月份標題與頂端彙總
  await expect(monthHeaders(page)).toHaveText([
    '2026 年 9 月 · 4 場 · +$1,400',
    '2026 年 8 月 · 2 場 · +$2,600',
    '2026 年 7 月 · 1 場 · +$4,400',
  ])
  await expect(summary(page)).toHaveText('共 7 場 · +$8,400')

  // 單列：日期、標題（7.1 三個順位）、×N、盈利正負號與顏色
  const expected = [
    { id: f.c2.id, date: '09/27', title: '50/100', profit: `${MINUS}$1,000`, color: 'loss' },
    { id: f.c1.id, date: '09/27', title: '6bet · 50/100', profit: '+$2,000', color: 'gain' },
    { id: f.m1.id, date: '09/14', title: '週日賽', badge: '×2', profit: '+$2,400', color: 'gain' },
    { id: f.t1.id, date: '09/01', title: '限時 MTT', profit: `${MINUS}$2,000`, color: 'loss' },
    // 已封存的場地與盲注照常顯示名稱
    { id: f.a1.id, date: '08/31', title: '舊場館 · 100/200', profit: '+$6,000', color: 'gain' },
    { id: f.a2.id, date: '08/15', title: '週日賽', profit: `${MINUS}$3,400`, color: 'loss' },
    { id: f.old1.id, date: '07/04', title: 'Summer Cup', profit: '+$4,400', color: 'gain' },
  ]
  for (const e of expected) {
    const row = page.locator(`[data-session-id="${e.id}"]`)
    await expect(row.getByTestId('row-date')).toHaveText(e.date)
    await expect(row.getByTestId('row-title')).toHaveText(e.title)
    await expect(row.getByTestId('row-profit')).toHaveText(e.profit)
    await expect(row.getByTestId('row-profit')).toHaveClass(new RegExp(`--color-${e.color}`))
    if (e.badge) await expect(row.getByTestId('row-badge')).toHaveText(e.badge)
    else await expect(row.getByTestId('row-badge')).toHaveCount(0)
  }

  // 月份標題捲動時黏在頁首下方（資料只有 7 筆，暫時撐高頁面讓它捲得動）
  await page.evaluate(() => document.body.style.setProperty('min-height', '3000px'))
  const headerBottom = await page.locator('header').evaluate((el) => el.getBoundingClientRect().bottom)
  const firstTop = await monthHeaders(page).first().evaluate((el) => el.getBoundingClientRect().top)
  const y = Math.round(firstTop - headerBottom + 60)
  await page.evaluate((y) => window.scrollTo(0, y), y)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y)
  await expect
    .poll(() => monthHeaders(page).first().evaluate((el) => Math.round(el.getBoundingClientRect().top)))
    .toBe(Math.round(headerBottom))
})

test('無任何紀錄：「還沒有紀錄」與「去新增第一場」', async ({ page }) => {
  await page.goto('./#/sessions')
  await expect(page.getByText('還沒有紀錄')).toBeVisible()
  await expect(page.getByRole('group', { name: '類型' })).toHaveCount(0)
  await page.getByRole('link', { name: '去新增第一場' }).click()
  await expect(heading(page)).toHaveText('新增場次')
})

// ---------------------------------------------------------------------------
// 10.3 P3-2 兩項篩選同時套用時結果正確，清除篩選可回到全部
// ---------------------------------------------------------------------------

test('P3-2 類型 + 關鍵字、類型 + 期間同時套用，月份彙總只算符合的場次，清除篩選回到全部', async ({ page }) => {
  await seed(page)
  await openList(page)
  const keyword = page.getByLabel('關鍵字')

  // 類型 + 關鍵字（關鍵字比對 name 與 note，不分大小寫、部分符合；debounce 後套用）
  await typeFilter(page, 'MTT').click()
  await expect(typeFilter(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  expect(await rowIds(page)).toEqual([f.m1.id, f.a2.id])
  await keyword.fill('RE-ENTRY')
  await expect.poll(() => rowIds(page)).toEqual([f.m1.id])
  await expect(monthHeaders(page)).toHaveText(['2026 年 9 月 · 1 場 · +$2,400'])
  await expect(summary(page)).toHaveText('共 1 場 · +$2,400')

  // 限時 MTT + 關鍵字（比對 note）
  await typeFilter(page, '限時 MTT').click()
  await keyword.fill('final')
  await expect.poll(() => rowIds(page)).toEqual([f.old1.id])

  // 沒有符合：現金桌 + final
  await typeFilter(page, '現金桌').click()
  await expect(page.getByText('沒有符合條件的紀錄')).toBeVisible()
  await expect(summary(page)).toHaveText('共 0 場 · $0')
  await page.getByRole('main').getByRole('button', { name: '清除篩選' }).last().click()
  await expect.poll(() => rowIds(page)).toEqual(fixtureOrder)
  await expect(keyword).toHaveValue('')
  await expect(typeFilter(page, '全部')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '清除篩選' })).toHaveCount(0)

  // 類型 + 期間（自訂 8/1–8/31，兩端皆含）
  await typeFilter(page, '現金桌').click()
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  await page.getByLabel('起日').fill('2026-08-01')
  await page.getByLabel('迄日').fill('2026-08-31')
  await expect.poll(() => rowIds(page)).toEqual([f.a1.id])
  await expect(monthHeaders(page)).toHaveText(['2026 年 8 月 · 1 場 · +$6,000'])

  // 起日晚於迄日：顯示錯誤且不套用期間（類型仍套用）
  await page.getByLabel('起日').fill('2026-09-30')
  await expect(page.getByText('起日不可晚於迄日')).toBeVisible()
  await expect(page.getByLabel('起日')).toHaveAttribute('aria-invalid', 'true')
  await expect.poll(() => rowIds(page)).toEqual([f.c2.id, f.c1.id, f.a1.id])

  await page.getByRole('button', { name: '清除篩選' }).click()
  await expect.poll(() => rowIds(page)).toEqual(fixtureOrder)
  await expect(page.getByLabel('期間')).toHaveValue('all')
  await expect(page.getByLabel('起日')).toHaveCount(0)
})

test('P3-2 類型 + 近三個月（依今天推算）', async ({ page }) => {
  const day = (n: number) => dayjs().subtract(n, 'day').format('YYYY-MM-DD')
  const threeMonthsAgo = dayjs().subtract(3, 'month').format('YYYY-MM-DD')
  const mk = (id: number, type: Session['type'], date: string): Session => ({
    ...f.t1,
    id: uuid(id),
    type,
    startAt: `${date}T10:00`,
    stakeId: type === 'cash' ? S_50 : null,
    ...(type === 'cash' ? { buyIns: [{ amount: 1000, fee: 0 }] } : {}),
  })
  const recentCash = mk(11, 'cash', day(1))
  const edgeCash = mk(12, 'cash', threeMonthsAgo)
  const oldCash = mk(13, 'cash', dayjs(threeMonthsAgo).subtract(1, 'day').format('YYYY-MM-DD'))
  const recentMtt = mk(14, 'mtt', day(2))
  await seed(page, { venues, stakes, sessions: [recentCash, edgeCash, oldCash, recentMtt] })
  await openList(page)
  await page.getByLabel('期間').selectOption({ label: '近三個月' })
  await typeFilter(page, '現金桌').click()
  await expect.poll(() => rowIds(page)).toEqual([recentCash.id, edgeCash.id])
  await expect(summary(page)).toHaveText(`共 2 場 · ${MINUS}$2,000`)
})

test('Q2 篩選條件在 App 開啟期間保留，切頁再回來不重置；重新載入回到預設', async ({ page }) => {
  await seed(page)
  await openList(page)
  await typeFilter(page, 'MTT').click()
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  await page.getByLabel('起日').fill('2026-08-01')
  await page.getByLabel('迄日').fill('2026-09-30')
  await page.getByLabel('關鍵字').fill('週日')
  await expect.poll(() => rowIds(page)).toEqual([f.m1.id, f.a2.id])

  await nav(page).getByRole('link', { name: '報表' }).click()
  await expect(heading(page)).toHaveText('報表')
  await nav(page).getByRole('link', { name: '紀錄' }).click()
  await expect(typeFilter(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('期間')).toHaveValue('custom')
  await expect(page.getByLabel('起日')).toHaveValue('2026-08-01')
  await expect(page.getByLabel('迄日')).toHaveValue('2026-09-30')
  await expect(page.getByLabel('關鍵字')).toHaveValue('週日')
  expect(await rowIds(page)).toEqual([f.m1.id, f.a2.id])

  await page.reload()
  await expect(typeFilter(page, '全部')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('期間')).toHaveValue('all')
  await expect(page.getByLabel('關鍵字')).toHaveValue('')
  await expect.poll(() => rowIds(page)).toEqual(fixtureOrder)
})

test('Q3 網址帶入場地 / 盲注 / 名稱標籤，可移除；type / period 覆蓋記憶的篩選；清除篩選移除網址參數', async ({
  page,
}) => {
  await seed(page)
  await openList(page)
  const tags = page.getByTestId('filter-tag')

  // 先在畫面上選現金桌，網址帶入 type=mtt 會覆蓋
  await typeFilter(page, '現金桌').click()
  await page.goto(`./#/sessions?type=mtt&period=all&venue=${V_6BET}`)
  await expect(typeFilter(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  await expect(tags).toHaveText(['場地：6bet'])
  await expect.poll(() => rowIds(page)).toEqual([f.m1.id])
  // type / period 套用後從網址移除，只留標籤條件
  await expect.poll(() => hashPath(page)).toBe(`/sessions?venue=${V_6BET}`)

  // 移除標籤：回到只有類型篩選
  await page.getByRole('button', { name: '移除篩選 場地：6bet' }).click()
  await expect(tags).toHaveCount(0)
  await expect.poll(() => rowIds(page)).toEqual([f.m1.id, f.a2.id])
  expect(hashPath(page)).toBe('/sessions')

  // 名稱（去除前後空白、不分大小寫完全相同）
  await page.goto('./#/sessions?type=all&period=all&name=%20summer%20CUP%20')
  await expect(tags).toHaveText(['名稱：summer CUP'])
  await expect.poll(() => rowIds(page)).toEqual([f.old1.id])

  // 未命名、未指定場地
  await page.goto('./#/sessions?type=all&period=all&name=')
  await expect(tags).toHaveText(['名稱：未命名'])
  await expect.poll(() => rowIds(page)).toEqual([f.c2.id, f.c1.id, f.t1.id, f.a1.id])
  await page.goto('./#/sessions?type=all&period=all&venue=')
  await expect(tags).toHaveText(['場地：未指定'])
  await expect.poll(() => rowIds(page)).toEqual([f.c2.id, f.t1.id])

  // 盲注（已封存照常顯示）+ 自訂期間 + 場地
  await page.goto(`./#/sessions?type=cash&period=custom&from=2026-08-01&to=2026-08-31&venue=${V_OLD}&stake=${S_100}`)
  await expect(tags).toHaveText(['場地：舊場館', '盲注：100/200'])
  await expect(page.getByLabel('期間')).toHaveValue('custom')
  await expect(page.getByLabel('起日')).toHaveValue('2026-08-01')
  await expect.poll(() => rowIds(page)).toEqual([f.a1.id])
  await expect(summary(page)).toHaveText('共 1 場 · +$6,000')

  // 從詳情返回時標籤仍在
  await openDetail(page, f.a1.id)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(tags).toHaveText(['場地：舊場館', '盲注：100/200'])

  // 清除篩選：全部條件與標籤一起清除，網址參數移除
  await page.getByRole('button', { name: '清除篩選' }).click()
  await expect(tags).toHaveCount(0)
  await expect.poll(() => rowIds(page)).toEqual(fixtureOrder)
  expect(hashPath(page)).toBe('/sessions')
  await expect(typeFilter(page, '全部')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('期間')).toHaveValue('all')
})

// ---------------------------------------------------------------------------
// 7.2 詳情
// ---------------------------------------------------------------------------

test('7.2 詳情顯示內容：MTT 名次百分位、現金桌 bb 盈利、備註換行、已封存標註、時間戳', async ({ page }) => {
  await seed(page)
  await openList(page)

  // MTT（有名次）
  await openDetail(page, f.m1.id)
  await expect(page.getByTestId('detail-profit')).toHaveText('+$2,400')
  await expect(page.getByTestId('detail-profit')).toHaveClass(/--color-gain/)
  await expect(page.getByTestId('detail-type')).toHaveText('MTT')
  await expect(page.getByTestId('detail-title')).toHaveText('週日賽')
  await expect(page.getByTestId('detail-startAt')).toHaveText('開始時間2026/09/14 13 時')
  await expect(page.getByTestId('detail-duration')).toHaveText('時長6 小時 15 分')
  await expect(page.getByTestId('detail-venue')).toHaveText('場地6bet')
  await expect(page.getByTestId('detail-name')).toHaveText('名稱週日賽')
  await expect(page.getByTestId('detail-stake')).toHaveCount(0)
  await expect(page.getByTestId('detail-buyIn')).toHaveText([
    '第 1 次$3,400，服務費 $400',
    '第 2 次$3,200，服務費 $200',
  ])
  await expect(page.getByTestId('detail-buyInTotal')).toHaveText('買入總額$6,600')
  await expect(page.getByTestId('detail-feeTotal')).toHaveText('服務費總額$600')
  await expect(page.getByTestId('detail-cashOut')).toHaveText('到手金額$9,000')
  // 時薪 2,400 ÷ 6.25 = 384
  await expect(page.getByTestId('detail-hourly')).toHaveText('時薪+$384/hr')
  await expect(page.getByTestId('detail-finish')).toHaveText('名次第 12 名 / 180 人（前 6.7%）')
  await expect(page.getByTestId('detail-bbProfit')).toHaveCount(0)
  const local = (iso: string) => dayjs(iso).format('YYYY/MM/DD HH:mm')
  await expect(page.getByTestId('detail-timestamps')).toHaveText(
    `建立時間 ${local(f.m1.createdAt)}最後修改 ${local(f.m1.updatedAt)}`,
  )
  await expect(page.getByRole('button', { name: '編輯' })).toBeVisible()
  await expect(page.getByRole('button', { name: '複製為新紀錄' })).toBeVisible()
  await expect(page.getByRole('button', { name: '刪除' })).toHaveClass(/--color-danger/)

  // 現金桌：bb 盈利、備註保留換行
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDetail(page, f.c1.id)
  await expect(page.getByTestId('detail-title')).toHaveText('6bet · 50/100')
  await expect(page.getByTestId('detail-stake')).toHaveText('盲注50/100')
  await expect(page.getByTestId('detail-bbProfit')).toHaveText('bb 盈利+20.0 bb')
  await expect(page.getByTestId('detail-duration')).toHaveText('時長4 小時 30 分')
  await expect(page.getByTestId('detail-finish')).toHaveCount(0)
  const note = page.getByTestId('detail-note')
  expect(await note.evaluate((el) => (el as HTMLElement).innerText)).toBe('第一行\n第二行')
  await expect(note).toHaveCSS('white-space', 'pre-wrap')

  // 已封存的場地與盲注標註「（已封存）」；MTT 沒填名次時不顯示名次
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDetail(page, f.a1.id)
  await expect(page.getByTestId('detail-venue')).toHaveText('場地舊場館（已封存）')
  await expect(page.getByTestId('detail-stake')).toHaveText('盲注100/200（已封存）')
  await expect(page.getByTestId('detail-bbProfit')).toHaveText('bb 盈利+30.0 bb')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDetail(page, f.a2.id)
  await expect(page.getByTestId('detail-venue')).toHaveText('場地舊場館（已封存）')
  await expect(page.getByTestId('detail-finish')).toHaveCount(0)
  await expect(page.getByTestId('detail-hourly')).toHaveText(`時薪${MINUS}$850/hr`)

  // 限時 MTT：沒有場地、名稱、備註
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDetail(page, f.t1.id)
  await expect(page.getByTestId('detail-title')).toHaveText('限時 MTT')
  await expect(page.getByTestId('detail-venue')).toHaveText('場地—')
  await expect(page.getByTestId('detail-name')).toHaveText('名稱—')
  await expect(page.getByTestId('detail-note')).toHaveText('—')
})

test('7.2 MTT 只填參賽人數時詳情顯示『共 N 人』', async ({ page }) => {
  // 只填參賽人數（finishPlace 為 null）、兩者都沒填各一筆，另加有名次的 m1 對照
  const fieldOnly: Session = { ...f.m1, id: uuid(0x301), startAt: '2026-09-20T13:00', fieldSize: 180, finishPlace: null }
  const neither: Session = { ...f.m1, id: uuid(0x302), startAt: '2026-09-21T13:00', fieldSize: null, finishPlace: null }
  await seed(page, { venues, stakes, sessions: [f.m1, fieldOnly, neither] })
  await openList(page)

  await openDetail(page, fieldOnly.id)
  await expect(page.getByTestId('detail-fieldSize')).toHaveText('參賽人數共 180 人')
  await expect(page.getByTestId('detail-finish')).toHaveCount(0)

  // 兩者都沒填：不顯示參賽人數與名次列
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDetail(page, neither.id)
  await expect(page.getByTestId('detail-fieldSize')).toHaveCount(0)
  await expect(page.getByTestId('detail-finish')).toHaveCount(0)

  // 有填名次：維持名次列，不另外顯示參賽人數列
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDetail(page, f.m1.id)
  await expect(page.getByTestId('detail-finish')).toHaveText('名次第 12 名 / 180 人（前 6.7%）')
  await expect(page.getByTestId('detail-fieldSize')).toHaveCount(0)
})

test('7.2 網址 id 不存在：顯示「找不到這筆紀錄」與返回列表', async ({ page }) => {
  await seed(page)
  await page.goto(`./#/sessions/${uuid(0xdead)}`)
  await expect(heading(page)).toHaveText('場次詳情')
  await expect(page.getByText('找不到這筆紀錄')).toBeVisible()
  await page.getByRole('button', { name: '返回列表' }).click()
  await expect(heading(page)).toHaveText('紀錄')
  await expect.poll(() => rowIds(page)).toEqual(fixtureOrder)
})

// ---------------------------------------------------------------------------
// 5.7 編輯
// ---------------------------------------------------------------------------

type Stored = Session & Record<string, unknown>

async function stored(page: import('@playwright/test').Page, id: string): Promise<Stored | undefined> {
  return (await readStore<Stored>(page, 'sessions')).find((s) => s.id === id)
}

test('5.7 編輯儲存後返回詳情且 updatedAt 更新、createdAt 不變；類型不可修改', async ({ page }) => {
  await seed(page)
  await openList(page)
  await openDetail(page, f.c1.id)
  await page.getByRole('button', { name: '編輯' }).click()
  await expect(heading(page)).toHaveText('編輯場次')
  expect(hashPath(page)).toBe(`/sessions/${f.c1.id}/edit`)

  // 帶入全部欄位；類型停用並有說明
  await expect(page.getByRole('group', { name: '類型' }).getByRole('button', { name: '現金桌' })).toBeDisabled()
  await expect(page.getByText('類型無法修改，如需更改請刪除後重新新增')).toBeVisible()
  await expect(page.getByLabel('盲注級別')).toHaveValue(S_50)
  await expect(page.getByLabel('場地', { exact: true })).toHaveValue(V_6BET)
  await expect(page.getByLabel('買入（含服務費）', { exact: true })).toHaveValue('10,000')
  await expect(page.getByLabel('服務費', { exact: true })).toHaveValue('300')
  await expect(page.getByLabel('到手金額')).toHaveValue('12,000')
  await expect(page.getByLabel('備註')).toHaveValue('第一行\n第二行')

  await page.getByLabel('到手金額').fill('13500')
  await page.getByRole('form').getByRole('button', { name: '儲存', exact: true }).click()

  // 返回詳情，不跳「放棄變更？」
  await expect(heading(page)).toHaveText('場次詳情')
  expect(hashPath(page)).toBe(`/sessions/${f.c1.id}`)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('detail-profit')).toHaveText('+$3,500')

  const after = await stored(page, f.c1.id)
  expect(after).toMatchObject({ id: f.c1.id, cashOut: 13500, createdAt: f.c1.createdAt })
  expect(after!.updatedAt).not.toBe(f.c1.updatedAt)
  expect(Date.parse(after!.updatedAt)).toBeGreaterThan(Date.parse(f.c1.updatedAt))

  // 詳情返回列表：列表同步更新；詳情頁不會因編輯頁而多一層（返回一次就回到列表）
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(heading(page)).toHaveText('紀錄')
  await expect(page.locator(`[data-session-id="${f.c1.id}"]`).getByTestId('row-profit')).toHaveText('+$3,500')
})

test('Q1 編輯有未儲存變更時，返回鈕與分頁列都跳「放棄變更？」：取消留下、確定離開', async ({ page }) => {
  await seed(page)
  await openList(page)
  await openDetail(page, f.m1.id)
  await page.getByRole('button', { name: '編輯' }).click()
  await expect(heading(page)).toHaveText('編輯場次')

  // 沒有變更：直接返回，不確認
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(heading(page)).toHaveText('場次詳情')
  await page.getByRole('button', { name: '編輯' }).click()
  await expect(heading(page)).toHaveText('編輯場次')

  await page.getByLabel('名稱', { exact: true }).fill('改過的名稱')
  const sheet = page.getByRole('dialog', { name: '放棄變更？' })

  // 返回鈕 → 取消
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: '確定' })).toHaveClass(/--color-danger/)
  await sheet.getByRole('button', { name: '取消' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(heading(page)).toHaveText('編輯場次')
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('改過的名稱')

  // 分頁列 → 取消
  await nav(page).getByRole('link', { name: '報表' }).click()
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: '取消' }).click()
  await expect(heading(page)).toHaveText('編輯場次')
  expect(hashPath(page)).toBe(`/sessions/${f.m1.id}/edit`)

  // 分頁列 → 確定：離開到報表，資料未改變
  await nav(page).getByRole('link', { name: '報表' }).click()
  await sheet.getByRole('button', { name: '確定' }).click()
  await expect(heading(page)).toHaveText('報表')
  expect((await stored(page, f.m1.id))!.name).toBe('週日賽')

  // 返回鈕 → 確定：回到詳情
  await page.goBack()
  await expect(heading(page)).toHaveText('編輯場次')
  await page.getByLabel('名稱', { exact: true }).fill('又改了')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await sheet.getByRole('button', { name: '確定' }).click()
  await expect(heading(page)).toHaveText('場次詳情')
  await expect(page.getByTestId('detail-title')).toHaveText('週日賽')
})

// ---------------------------------------------------------------------------
// 10.3 P3-4 刪除後 5 秒內按復原，資料與原本完全相同
// ---------------------------------------------------------------------------

test('P3-4 刪除後 5 秒內按復原，資料與原本完全相同（含 id 與時間戳，逐欄比對）', async ({ page }) => {
  await seed(page)
  await openList(page)
  const original = await stored(page, f.m1.id)
  expect(original).toEqual(f.m1)

  await openDetail(page, f.m1.id)
  await page.getByRole('button', { name: '刪除' }).click()
  const sheet = page.getByRole('dialog', { name: '刪除這筆紀錄？' })
  await expect(sheet).toBeVisible()
  // 確認視窗內容：日期、標題、盈利；確認鈕為紅色「刪除」
  await expect(sheet).toContainText('2026/09/14 13 時')
  await expect(sheet).toContainText('週日賽')
  await expect(sheet).toContainText('+$2,400')
  await expect(sheet.getByRole('button', { name: '刪除' })).toHaveClass(/--color-danger/)
  await sheet.getByRole('button', { name: '刪除' }).click()

  // 返回列表（replace），實體刪除
  await expect(heading(page)).toHaveText('紀錄')
  expect(hashPath(page)).toBe('/sessions')
  await expect(page.locator(`[data-session-id="${f.m1.id}"]`)).toHaveCount(0)
  await expect(summary(page)).toHaveText('共 6 場 · +$6,000')
  expect(await stored(page, f.m1.id)).toBeUndefined()

  const toast = page.getByRole('status').filter({ hasText: '已刪除' })
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: '復原' }).click()
  await expect(toast).toHaveCount(0)

  // 原封不動寫回（id、createdAt、updatedAt 與所有欄位逐欄深度比對）
  await expect.poll(() => stored(page, f.m1.id)).toEqual(original)
  await expect.poll(() => rowIds(page)).toEqual(fixtureOrder)
  await expect(summary(page)).toHaveText('共 7 場 · +$8,400')
  // 停留在目前頁面
  expect(hashPath(page)).toBe('/sessions')
})

test('P3-4 復原提示顯示 5 秒後消失；切到其他分頁時提示仍在，並可在其他頁復原', async ({ page }) => {
  await seed(page)
  await openList(page)

  // 5 秒後消失
  await openDetail(page, f.c2.id)
  await page.getByRole('button', { name: '刪除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '刪除' }).click()
  const toast = page.getByRole('status').filter({ hasText: '已刪除' })
  await expect(toast).toBeVisible()
  const shownAt = Date.now()
  await page.waitForTimeout(4000)
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCount(0, { timeout: 3000 })
  const elapsed = Date.now() - shownAt
  expect(elapsed).toBeGreaterThanOrEqual(4500)
  expect(elapsed).toBeLessThan(7000)
  expect(await stored(page, f.c2.id)).toBeUndefined()

  // 刪除後切到報表：提示仍在，按復原後停留在報表頁
  await openDetail(page, f.t1.id)
  await page.getByRole('button', { name: '刪除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '刪除' }).click()
  await expect(toast).toBeVisible()
  await nav(page).getByRole('link', { name: '報表' }).click()
  await expect(heading(page)).toHaveText('報表')
  await expect(toast).toBeVisible()
  await nav(page).getByRole('link', { name: '設定' }).click()
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: '復原' }).click()
  await expect(heading(page)).toHaveText('設定')
  await expect.poll(() => stored(page, f.t1.id)).toEqual(f.t1)
})

// ---------------------------------------------------------------------------
// 10.3 P3-5 複製為新紀錄欄位預填符合 7.4
// ---------------------------------------------------------------------------

test('P3-5 複製為新紀錄：預填類型、場地、名稱、全部買入列；開始時間為現在；其餘留空', async ({ page }) => {
  await seed(page)
  await openList(page)
  await openDetail(page, f.m1.id)
  const before = Date.now()
  await page.getByRole('button', { name: '複製為新紀錄' }).click()
  await expect(heading(page)).toHaveText('新增場次')
  expect(hashPath(page)).toBe('/')

  const group = page.getByRole('group', { name: '類型' })
  await expect(group.getByRole('button', { name: 'MTT', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('textbox', { name: '第 1 次 買入（含服務費）' })).toHaveValue('3,400')
  await expect(page.getByRole('textbox', { name: '第 1 次 服務費' })).toHaveValue('400')
  await expect(page.getByRole('textbox', { name: '第 2 次 買入（含服務費）' })).toHaveValue('3,200')
  await expect(page.getByRole('textbox', { name: '第 2 次 服務費' })).toHaveValue('200')
  await expect(page.getByLabel('場地', { exact: true })).toHaveValue(V_6BET)
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('週日賽')
  for (const label of ['到手金額', '名次', '參賽人數', '備註']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('')
  }
  await expect(page.getByRole('combobox', { name: '時長（小時）' })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: '時長（分鐘）' })).toHaveValue('')
  const now = dayjs(before)
  await expect(page.getByLabel('開始日期')).toHaveValue(now.format('YYYY-MM-DD'))
  await expect(page.getByRole('combobox', { name: '開始小時' })).toHaveValue(String(now.hour()))
  await expect(page.getByTestId('record-preview')).toHaveText('買入 $6,600（2 次）· 服務費 $600 · 盈利 —')
  // 預填內容與預設值不同，視為草稿（可「清除」）
  await expect(page.getByRole('button', { name: '清除' })).toBeVisible()
})

test('P3-5 複製：來源場地、盲注已封存時留空不預填', async ({ page }) => {
  await seed(page)
  await openList(page)
  await openDetail(page, f.a1.id)
  await page.getByRole('button', { name: '複製為新紀錄' }).click()
  await expect(heading(page)).toHaveText('新增場次')
  const group = page.getByRole('group', { name: '類型' })
  await expect(group.getByRole('button', { name: '現金桌', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('盲注級別')).toHaveValue('')
  await expect(page.getByLabel('場地', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('買入（含服務費）', { exact: true })).toHaveValue('20,000')
  await expect(page.getByLabel('服務費', { exact: true })).toHaveValue('500')
  await expect(page.getByLabel('到手金額')).toHaveValue('')
})

test('P3-5 複製：新增頁已有草稿時先確認「覆蓋目前的草稿？」，取消留在詳情、確定覆蓋', async ({ page }) => {
  await seed(page)
  // 新增頁先填一半，留下草稿
  await page.getByLabel('買入（含服務費）', { exact: true }).fill('777')
  await expect.poll(async () => (await readSettings(page)).recordDraft).toBeTruthy()
  const draftBefore = (await readSettings(page)).recordDraft

  await openList(page)
  await openDetail(page, f.c1.id)
  await page.getByRole('button', { name: '複製為新紀錄' }).click()
  const sheet = page.getByRole('dialog', { name: '覆蓋目前的草稿？' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: '確定' })).toHaveClass(/--color-danger/)

  // 取消：留在詳情，草稿不變
  await sheet.getByRole('button', { name: '取消' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(heading(page)).toHaveText('場次詳情')
  expect((await readSettings(page)).recordDraft).toEqual(draftBefore)

  // 確定：切到新增頁並預填來源場次
  await page.getByRole('button', { name: '複製為新紀錄' }).click()
  await sheet.getByRole('button', { name: '確定' }).click()
  await expect(heading(page)).toHaveText('新增場次')
  await expect(page.getByLabel('盲注級別')).toHaveValue(S_50)
  await expect(page.getByLabel('場地', { exact: true })).toHaveValue(V_6BET)
  await expect(page.getByLabel('買入（含服務費）', { exact: true })).toHaveValue('10,000')
  await expect(page.getByLabel('服務費', { exact: true })).toHaveValue('300')
  await expect(page.getByLabel('備註')).toHaveValue('')

  // 沒有草稿時直接複製，不跳確認
  await page.getByRole('button', { name: '清除' }).click()
  await expect.poll(async () => (await readSettings(page)).recordDraft).toBeUndefined()
  await openList(page)
  await openDetail(page, f.old1.id)
  await page.getByRole('button', { name: '複製為新紀錄' }).click()
  await expect(heading(page)).toHaveText('新增場次')
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('Summer Cup')
})

test('9.1 從詳情返回列表時恢復已載入的筆數與捲動位置（1,000 筆，分批載入 3 批以上）', async ({ page }) => {
  test.setTimeout(120_000)
  await seed(page, generateSeedData({ count: 1000, today: dayjs().format('YYYY-MM-DD') }))
  await nav(page).getByRole('link', { name: '紀錄' }).click()
  await expect(page.getByTestId('session-row')).toHaveCount(100)

  // 捲到第 250 列附近（需載入 3 批）
  for (let i = 0; i < 100 && (await page.getByTestId('session-row').count()) < 300; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000))
    await page.waitForTimeout(50)
  }
  const target = page.getByTestId('session-row').nth(249)
  await target.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -200))
  const id = await target.getAttribute('data-session-id')
  const loaded = await page.getByTestId('session-row').count()
  const scrollY = await page.evaluate(() => window.scrollY)
  const topBefore = await target.evaluate((el) => el.getBoundingClientRect().top)
  expect(loaded).toBeGreaterThanOrEqual(300)

  // 以 DOM click 進入詳情：Playwright 的 click 會先把元素捲到可點擊的位置，改變要驗證的捲動位置
  await target.evaluate((el) => (el as HTMLElement).click())
  await expect(heading(page)).toHaveText('場次詳情')
  await expect(page.getByTestId('detail-profit')).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(heading(page)).toHaveText('紀錄')
  await expect(page.getByTestId('session-row')).toHaveCount(loaded)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY)
  const topAfter = await page.locator(`[data-session-id="${id}"]`).evaluate((el) => el.getBoundingClientRect().top)
  expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(1)
})

// ---------------------------------------------------------------------------
// 9.1、9.2 版面
// ---------------------------------------------------------------------------

test('列表與詳情：觸控區域至少 44×44、375px 無橫向捲動、分頁列仍顯示', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto(`./#/sessions?type=mtt&period=custom&from=2026-01-01&to=2026-09-30&venue=${V_6BET}&name=週日賽`)
  await expect(page.getByTestId('filter-tag')).toHaveCount(2)
  for (const target of ['list', 'detail'] as const) {
    if (target === 'detail') await openDetail(page, f.m1.id)
    // 詳情頁以推入動效進入：動畫中的 transform 會讓尺寸量到 43.999…（浮點誤差），等動畫結束再量
    await waitForAnimations(page)
    await expect(nav(page)).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, target).toBeLessThanOrEqual(0)
    const targets = page.locator('main a:visible, main button:visible, main select:visible, main input:visible, header button:visible')
    const count = await targets.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const box = await targets.nth(i).boundingBox()
      expect(box!.width, `${target} target ${i}`).toBeGreaterThanOrEqual(44)
      expect(box!.height, `${target} target ${i}`).toBeGreaterThanOrEqual(44)
    }
  }
})

test('Q6 正式建置不含開發用 seed 按鈕', async ({ page }) => {
  await page.goto('./#/settings')
  await expect(heading(page)).toHaveText('設定')
  await expect(page.getByRole('button', { name: '產生 5,000 筆測試資料' })).toHaveCount(0)
})
