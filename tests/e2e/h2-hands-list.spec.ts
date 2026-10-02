import { expect, test, type Page } from '@playwright/test'
import { finalizeHandContent, type Hand, type HandContent } from '../../src/domain/hands'
import { FIXED_NOW, chooseMode, handBar, pickCards, slotButton } from './helpers/handForm'
import { H_79, H_GG, H_MEMO, H_MTT, H_SIDE, fixtureHands } from './helpers/hands'
import { handFilter, handRowIds, handRows, handSummary, openHandDetail, openHands, seedGeneratedHands } from './helpers/handsList'
import { putRecords, readSettings, readStore } from './helpers/idb'
import { waitForAnimations } from './helpers/layout'
import { fixture, hashPath, heading, nav, openDetail, openList, seed, uuid } from './helpers/sessions'

// SPEC-v2-hands 12.3 H2 列表與詳情的 E2E（另見 tests/unit/hands-list.test.ts、tests/component/hand-detail.test.tsx）

const toast = (page: Page) => page.getByTestId('global-toast-text')
const activeTab = (page: Page) => nav(page).locator('a[aria-current="page"]')

/** 簡易備忘手牌（測試用固定 id、時間） */
function memo(id: string, playedAt: string, patch: Partial<HandContent> = {}, createdAt = '2026-09-30T23:00:00+08:00'): Hand {
  return {
    id,
    exportSeq: Number.parseInt(id.slice(-4), 16),
    createdAt,
    updatedAt: createdAt,
    ...finalizeHandContent({
      source: 'manual',
      gameType: 'cash',
      sessionId: null,
      playedAt,
      bb: 200,
      heroCards: ['As', 'Kd'],
      heroPosition: 'CO',
      board: [],
      heroNet: 400,
      detail: null,
      tags: [],
      note: null,
      sourceHandId: null,
      rawText: null,
      parserVersion: null,
      ...patch,
    }),
  }
}

async function seedFixtureHands(page: Page): Promise<Hand[]> {
  await seed(page)
  const hands = fixtureHands()
  await putRecords(page, 'hands', hands)
  return hands
}

test.describe('12.3 H2 分頁列五個頁籤（5.1）', () => {
  test('12.3 H2 底部分頁列為 5 個頁籤，順序為新增 / 紀錄 / 手牌 / 報表 / 設定；375px 寬時每個頁籤觸控區 ≥ 44×44px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('./')
    await expect(heading(page)).toHaveText('新增場次')
    const links = nav(page).getByRole('link')
    await expect(links).toHaveText(['新增', '紀錄', '手牌', '報表', '設定'])
    for (let i = 0; i < 5; i++) {
      const box = (await links.nth(i).boundingBox())!
      expect(box.width, `tab ${i}`).toBeGreaterThanOrEqual(44)
      expect(box.height, `tab ${i}`).toBeGreaterThanOrEqual(44)
      // 五個頁籤平分 375px：每個約 75px
      expect(Math.abs(box.width - 75), `tab ${i}`).toBeLessThanOrEqual(1)
      // 標籤為 2 個中文字，不省略、不換行（單行高度）
      const label = links.nth(i).locator('span')
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getClientRects().length === 1)).toBe(true)
    }
    // 最寬 480px 時每個 96px
    await page.setViewportSize({ width: 1024, height: 800 })
    const wide = (await links.nth(2).boundingBox())!
    expect(Math.abs(wide.width - 96)).toBeLessThanOrEqual(1)
  })

  test('12.3 H2「手牌」頁籤進入手牌列表，#/hands 開頭的子頁中「手牌」為作用中；紀錄頁沒有「場次 / 手牌」切換', async ({ page }) => {
    await seedFixtureHands(page)
    await openHands(page)
    expect(hashPath(page)).toBe('/hands')
    await expect(activeTab(page)).toHaveText('手牌')
    // 分頁根頁面沒有返回鈕
    await expect(page.getByRole('button', { name: '返回', exact: true })).toHaveCount(0)

    // 子頁：新增、詳情、編輯 → 「手牌」作用中、有返回鈕、分頁列仍顯示
    for (const path of ['/hands/new', `/hands/${H_79}`, `/hands/${H_79}/edit`]) {
      await page.goto(`./#${path}`)
      await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible()
      await expect(nav(page)).toBeVisible()
      await expect(activeTab(page), path).toHaveText('手牌')
    }

    // 紀錄頁：維持場次列表，沒有「場次 / 手牌」切換
    await page.goto('./#/sessions')
    await expect(heading(page)).toHaveText('紀錄')
    await expect(page.getByRole('main').getByRole('button', { name: '手牌' })).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('group', { name: /場次|手牌/ })).toHaveCount(0)
    await expect(page.getByRole('main').getByText('手牌', { exact: true })).toHaveCount(0)

    // 從場次詳情（紀錄頁籤）點進手牌詳情 → 作用中變為「手牌」；返回場次詳情 → 回到「紀錄」
    await openDetail(page, fixture.c1.id)
    await expect(activeTab(page)).toHaveText('紀錄')
    await page.getByTestId('session-hands').locator(`[data-hand-id="${H_79}"]`).click()
    await expect(heading(page)).toHaveText('手牌詳情')
    await expect(activeTab(page)).toHaveText('手牌')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(heading(page)).toHaveText('場次詳情')
    await expect(activeTab(page)).toHaveText('紀錄')
  })

  test('12.3 H2「手牌」頁籤捲動記憶：列表捲動後進入詳情再返回、或切到其他頁籤再切回，捲動位置與篩選相同', async ({ page }) => {
    await seed(page)
    await seedGeneratedHands(page, 400)
    await openHands(page)
    await handFilter(page, '紀錄類型').selectOption({ label: '完整' })
    await expect(handSummary(page)).toContainText('（完整')
    const summaryText = await handSummary(page).textContent()
    expect(summaryText).toMatch(/^共 (\d+) 手（完整 \1 手）$/)
    // 捲到第 2 批（分批載入的第 100 筆之後）
    await expect(handRows(page)).toHaveCount(100)
    await page.evaluate(() => window.scrollTo(0, 7000))
    await expect(handRows(page)).toHaveCount(200)
    await page.evaluate(() => window.scrollTo(0, 6400))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(6400)

    // 點畫面中的一列進入詳情，再返回
    const target = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="hand-row"]')]
      const row = rows.find((r) => r.getBoundingClientRect().top > 200)!
      return row.dataset.handId!
    })
    await openHandDetail(page, target)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(heading(page)).toHaveText('手牌')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(6400)
    await expect(handFilter(page, '紀錄類型')).toHaveValue('complete')
    await expect(handSummary(page)).toHaveText(summaryText!)

    // 切到其他頁籤再切回
    await nav(page).getByRole('link', { name: '報表' }).click()
    await expect(heading(page)).toHaveText('報表')
    await nav(page).getByRole('link', { name: '手牌' }).click()
    await expect(heading(page)).toHaveText('手牌')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(6400)
    await expect(handFilter(page, '紀錄類型')).toHaveValue('complete')

    // 從詳情按分頁列「手牌」也回到列表的原位置
    await openHandDetail(page, target)
    await nav(page).getByRole('link', { name: '手牌' }).click()
    await expect(heading(page)).toHaveText('手牌')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(6400)
  })
})

test.describe('12.3 H2 手牌列表（6.1）', () => {
  test('12.3 H2 列表排序、月份分組、彙總「共 N 手（完整 M 手）」符合 6.1，且不顯示結果加總', async ({ page }) => {
    await seedFixtureHands(page)
    const a = memo(uuid(0x8101), '2026-10-01T09:00:00', { heroNet: 1000 })
    const b = memo(uuid(0x8102), '2026-08-31T23:55:00', { heroNet: -600 })
    // 同時間：c 較晚建立（createdAt 時區偏移不同），排在 d 之前
    const c = memo(uuid(0x8103), '2026-09-27T21:15:00', {}, '2026-09-28T16:00:00+00:00')
    await putRecords(page, 'hands', [a, b, c])
    await page.clock.setFixedTime(FIXED_NOW)
    await openHands(page)
    await expect(handSummary(page)).toHaveText('共 8 手（完整 3 手）')
    await expect(page.getByTestId('hand-month-header')).toHaveText(['2026 年 10 月 · 1 手', '2026 年 9 月 · 6 手', '2026 年 8 月 · 1 手'])
    const order = await handRowIds(page)
    expect(order[0]).toBe(a.id)
    expect(order[1]).toBe(c.id)
    expect(order.at(-2)).toBe(H_GG)
    expect(order.at(-1)).toBe(b.id)
    // 不顯示結果加總（4.13）：彙總與月份標題都沒有金額
    for (const text of [await handSummary(page).textContent(), ...(await page.getByTestId('hand-month-header').allTextContents())]) {
      expect(text).not.toMatch(/\$|bb|[+−]/)
    }
    // 單列：手牌、位置 + 盲注、小標籤、時間、標籤、結果
    const row = page.locator(`[data-hand-id="${H_79}"]`)
    await expect(row.getByTestId('row-title')).toHaveText('BTN · $100/$200')
    await expect(row.getByTestId('row-time')).toHaveText('09/27 21:15')
    await expect(row.getByTestId('row-tag')).toHaveText(['3bet'])
    await expect(row.getByTestId('row-result')).toHaveText('+84.0 bb')
    await expect(row.getByTestId('row-cards')).toContainText('A♠')
    await expect(page.locator(`[data-hand-id="${H_MEMO}"]`).getByTestId('row-badge')).toHaveText(['簡易'])
    await expect(page.locator(`[data-hand-id="${H_GG}"]`).getByTestId('row-badge')).toHaveText(['GG'])
    await expect(page.locator(`[data-hand-id="${H_MTT}"]`).getByTestId('row-title')).toHaveText('大盲 400')
    await expect(page.locator(`[data-hand-id="${H_MTT}"]`).getByTestId('row-result')).toHaveText('—')
  })

  test('12.3 H2 HC29 畫面顯示：元、分、籌碼三種單位（列表與詳情）', async ({ page }) => {
    await seedFixtureHands(page)
    const chip = memo(uuid(0x8201), '2026-09-26T20:00:00', { gameType: 'tournament', bb: null, heroNet: 1500, heroPosition: 'BB' })
    const zero = memo(uuid(0x8202), '2026-09-26T19:00:00', { bb: null, heroNet: 0, heroPosition: 'SB' })
    await putRecords(page, 'hands', [chip, zero])
    await openHands(page)
    // 元：$100/$200；分（GG 匯入）：金額固定 2 位小數；籌碼：無 $、千分位
    await expect(page.locator(`[data-hand-id="${H_79}"]`).getByTestId('row-title')).toHaveText('BTN · $100/$200')
    await expect(page.locator(`[data-hand-id="${H_GG}"]`).getByTestId('row-title')).toHaveText('BTN · $1.00/$2.00')
    await expect(page.locator(`[data-hand-id="${chip.id}"]`).getByTestId('row-result')).toHaveText('+1,500')
    await expect(page.locator(`[data-hand-id="${zero.id}"]`).getByTestId('row-result')).toHaveText('$0')
    await openHandDetail(page, H_GG)
    await expect(page.getByTestId('detail-result')).toHaveText('+85.8 bb')
    await expect(page.getByTestId('detail-result-amount')).toHaveText('+$171.56')
    await expect(page.getByTestId('detail-summary')).toHaveText('現金桌 · 6-max · $1.00/$2.00 · 有效 100.0 bb')
    await expect(page.getByTestId('detail-seat').first().getByTestId('seat-stack')).toHaveText('$200.00 · 100.0 bb')
    await expect(page.getByTestId('result-rake')).toHaveText('抽水 $0.44')
    // GG 手牌另顯示原站手牌編號與「實驗」標籤
    await expect(page.getByTestId('detail-source-hand-id')).toHaveText('原站手牌編號 RC1000000001')
    await expect(page.getByTestId('detail-badge')).toHaveText(['GG', '實驗'])
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await openHandDetail(page, H_79)
    await expect(page.getByTestId('detail-result-amount')).toHaveText('+$16,800')
  })

  test('12.3 H2 6.1 篩選：兩種篩選同時套用結果正確；清除篩選回到全部；空狀態', async ({ page }) => {
    await seedFixtureHands(page)
    await page.clock.setFixedTime(FIXED_NOW)
    await openHands(page)
    await expect(handSummary(page)).toHaveText('共 5 手（完整 3 手）')
    await handFilter(page, '紀錄類型').selectOption({ label: '完整' })
    await expect(handSummary(page)).toHaveText('共 3 手（完整 3 手）')
    await handFilter(page, '來源').selectOption({ label: '手動' })
    await expect(handSummary(page)).toHaveText('共 2 手（完整 2 手）')
    expect((await handRowIds(page)).sort()).toEqual([H_79, H_SIDE].sort())
    await handFilter(page, '關聯場次').selectOption({ label: '獨立' })
    expect(await handRowIds(page)).toEqual([H_SIDE])
    await handFilter(page, '關聯場次').selectOption({ label: '有關聯' })
    expect(await handRowIds(page)).toEqual([H_79])
    await page.getByRole('button', { name: '清除篩選' }).click()
    await expect(handSummary(page)).toHaveText('共 5 手（完整 3 手）')
    await expect(handFilter(page, '紀錄類型')).toHaveValue('all')

    // 標籤選單列出出現過的標籤；位置、關鍵字、期間
    await handFilter(page, '標籤').selectOption('3bet')
    expect(await handRowIds(page)).toEqual([H_79])
    await handFilter(page, '標籤').selectOption({ label: '全部' })
    await handFilter(page, '位置').selectOption({ label: 'CO' })
    expect(await handRowIds(page)).toEqual([H_MEMO])
    await handFilter(page, '位置').selectOption({ label: '未指定' })
    expect(await handRowIds(page)).toEqual([H_MTT])
    await handFilter(page, '位置').selectOption({ label: '全部' })
    await page.getByLabel('關鍵字').fill('第二行')
    await expect.poll(() => handRowIds(page)).toEqual([H_79])
    await page.getByLabel('期間').selectOption({ label: '自訂' })
    await page.getByLabel('起日').fill('2026-09-28')
    await page.getByLabel('迄日').fill('2026-09-30')
    // 篩選無結果
    await expect(page.getByText('沒有符合條件的手牌')).toBeVisible()
    await page.getByRole('main').getByRole('button', { name: '清除篩選' }).last().click()
    await expect(handSummary(page)).toHaveText('共 5 手（完整 3 手）')
  })

  test('6.1 空狀態：沒有任何手牌時顯示「還沒有手牌紀錄」與「新增第一手」；右上角「＋ 新增手牌」不關聯場次', async ({ page }) => {
    await seed(page)
    await openHands(page)
    await expect(page.getByText('還沒有手牌紀錄')).toBeVisible()
    await page.getByRole('link', { name: '新增第一手' }).click()
    await expect(heading(page)).toHaveText('新增手牌')
    expect(hashPath(page)).toBe('/hands/new')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('link', { name: '＋ 新增手牌' }).click()
    expect(hashPath(page)).toBe('/hands/new')
    await expect(page.getByLabel('關聯場次')).toHaveValue('')
  })
})

test.describe('12.3 H2 場次詳情手牌區塊（6.3）', () => {
  test('12.3 H2 場次詳情手牌區塊：最新 5 手、查看全部、新增手牌預帶 sessionId 與盲注', async ({ page }) => {
    await seed(page)
    const hands = Array.from({ length: 7 }, (_, i) => memo(uuid(0x8300 + i), `2026-09-27T2${i % 4}:${String(i * 5).padStart(2, '0')}:00`, { sessionId: fixture.c1.id }))
    const other = memo(uuid(0x8310), '2026-09-27T22:00:00')
    await putRecords(page, 'hands', [...hands, other])
    const newest5 = [...hands].sort((x, y) => (x.playedAt < y.playedAt ? 1 : -1)).slice(0, 5).map((h) => h.id)
    await openList(page)
    await openDetail(page, fixture.c1.id)
    const section = page.getByTestId('session-hands')
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('手牌（7）')
    await expect.poll(() => section.getByTestId('hand-row').evaluateAll((els) => els.map((el) => el.getAttribute('data-hand-id')))).toEqual(newest5)
    // 區塊在「備註」之後
    const noteBox = (await page.getByTestId('detail-note').boundingBox())!
    expect((await section.boundingBox())!.y).toBeGreaterThan(noteBox.y)

    // 查看全部 → 手牌列表並套用該場次篩選；作用中頁籤變為「手牌」；返回回到場次詳情
    await section.getByRole('link', { name: '查看全部 7 手' }).click()
    await expect(heading(page)).toHaveText('手牌')
    expect(hashPath(page)).toBe(`/hands?sessionId=${fixture.c1.id}`)
    await expect(activeTab(page)).toHaveText('手牌')
    await expect(page.getByTestId('hand-filter-tag')).toHaveText('場次：09/27 6bet · 50/100')
    await expect(handSummary(page)).toHaveText('共 7 手（完整 0 手）')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(heading(page)).toHaveText('場次詳情')
    await expect(activeTab(page)).toHaveText('紀錄')
    // 子頁的篩選不寫入「手牌」頁籤的列表
    await openHands(page)
    await expect(handSummary(page)).toHaveText('共 8 手（完整 0 手）')
    await expect(page.getByTestId('hand-filter-tag')).toHaveCount(0)

    // 新增手牌：預帶 sessionId 與該場盲注（50/100）
    await page.goBack()
    await expect(heading(page)).toHaveText('場次詳情')
    await section.getByRole('button', { name: '＋ 新增手牌' }).click()
    await expect(heading(page)).toHaveText('新增手牌')
    expect(hashPath(page)).toBe(`/hands/new?sessionId=${fixture.c1.id}`)
    await expect(page.getByLabel('關聯場次')).toHaveValue(fixture.c1.id)
    await chooseMode(page, '完整')
    await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('50')
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('100')
  })

  test('6.3 沒有手牌時顯示「這場還沒有手牌」；不超過 5 手時沒有「查看全部」', async ({ page }) => {
    await seedFixtureHands(page)
    await openList(page)
    await openDetail(page, fixture.c2.id)
    await expect(page.getByTestId('session-hands').getByRole('heading', { level: 2 })).toHaveText('手牌（0）')
    await expect(page.getByTestId('session-hands-empty')).toHaveText('這場還沒有手牌')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await openDetail(page, fixture.c1.id)
    await expect(page.getByTestId('session-hands').getByTestId('hand-row')).toHaveCount(2)
    await expect(page.getByRole('link', { name: /查看全部/ })).toHaveCount(0)
  })
})

test.describe('12.3 H2 刪除與復原（6.4）、刪除場次（6.5）', () => {
  test('12.3 H2 刪除手牌後 5 秒內復原，資料逐欄相同（含 exportSeq）', async ({ page }) => {
    const hands = await seedFixtureHands(page)
    const original = hands.find((h) => h.id === H_79)!
    await openHands(page)
    await openHandDetail(page, H_79)
    await page.getByRole('button', { name: '刪除' }).click()
    const sheet = page.getByRole('dialog', { name: '刪除這手牌？' })
    // 確認視窗：時間、Hero 手牌、位置、結果
    await expect(sheet.getByTestId('hand-delete-summary')).toContainText('2026/09/27 21:15')
    await expect(sheet.getByTestId('hand-delete-summary')).toContainText('黑桃 A')
    await expect(sheet.getByTestId('hand-delete-summary')).toContainText('BTN')
    await expect(sheet.getByTestId('hand-delete-summary')).toContainText('+84.0 bb')
    await sheet.getByRole('button', { name: '刪除' }).click()
    // 返回上一頁（列表），底部「已刪除 · 復原」
    await expect(heading(page)).toHaveText('手牌')
    await expect(toast(page)).toHaveText('已刪除')
    await expect(page.locator(`[data-hand-id="${H_79}"]`)).toHaveCount(0)
    await expect(handSummary(page)).toHaveText('共 4 手（完整 2 手）')
    expect((await readStore<Hand>(page, 'hands')).some((h) => h.id === H_79)).toBe(false)
    await page.getByRole('button', { name: '復原' }).click()
    await expect(page.locator(`[data-hand-id="${H_79}"]`)).toHaveCount(1)
    const restored = (await readStore<Hand>(page, 'hands')).find((h) => h.id === H_79)
    expect(restored).toStrictEqual(original)
    // exportSeq 不重用：lastHandSeq 不因刪除而改變
    expect((await readSettings(page)).lastHandSeq).toBeUndefined()
  })

  test('6.4 復原提示 5 秒後消失；從場次詳情進入的手牌刪除後返回場次詳情', async ({ page }) => {
    await seedFixtureHands(page)
    await openList(page)
    await openDetail(page, fixture.c1.id)
    await page.getByTestId('session-hands').locator(`[data-hand-id="${H_MEMO}"]`).click()
    await expect(heading(page)).toHaveText('手牌詳情')
    await page.getByRole('button', { name: '刪除' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '刪除' }).click()
    await expect(heading(page)).toHaveText('場次詳情')
    await expect(page.getByTestId('session-hands').getByRole('heading', { level: 2 })).toHaveText('手牌（1）')
    await expect(toast(page)).toHaveText('已刪除')
    await expect(toast(page)).toHaveCount(0, { timeout: 7000 })
    expect((await readStore<Hand>(page, 'hands')).some((h) => h.id === H_MEMO)).toBe(false)
  })

  test('6.5 刪除場次：確認視窗加註「這場有 N 手手牌…」，刪除後手牌轉為獨立（updatedAt 不變），復原後重新關聯', async ({ page }) => {
    const hands = await seedFixtureHands(page)
    await openList(page)
    // 沒有手牌的場次：不顯示手牌數
    await openDetail(page, fixture.c2.id)
    await page.getByRole('button', { name: '刪除' }).click()
    await expect(page.getByRole('dialog', { name: '刪除這筆紀錄？' })).toBeVisible()
    await expect(page.getByTestId('delete-sheet-hands')).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()

    await openDetail(page, fixture.c1.id)
    await expect(page.getByTestId('session-hands').getByTestId('hand-row')).toHaveCount(2)
    await page.getByRole('button', { name: '刪除' }).click()
    const sheet = page.getByRole('dialog', { name: '刪除這筆紀錄？' })
    await expect(sheet.getByTestId('delete-sheet-hands')).toHaveText('這場有 2 手手牌，刪除後會轉為獨立手牌（不會刪除）')
    await sheet.getByRole('button', { name: '刪除' }).click()
    await expect(heading(page)).toHaveText('紀錄')
    const linked = hands.filter((h) => h.sessionId === fixture.c1.id)
    const after = await readStore<Hand>(page, 'hands')
    for (const h of linked) {
      const now = after.find((x) => x.id === h.id)!
      expect(now.sessionId).toBeNull()
      expect(now.updatedAt).toBe(h.updatedAt)
    }
    // 手牌列表：轉為獨立
    await openHands(page)
    await handFilter(page, '關聯場次').selectOption({ label: '獨立' })
    await expect(handSummary(page)).toHaveText('共 4 手（完整 3 手）')
    await page.getByRole('button', { name: '復原' }).click()
    await expect(handSummary(page)).toHaveText('共 2 手（完整 2 手）')
    const restored = await readStore<Hand>(page, 'hands')
    for (const h of linked) expect(restored.find((x) => x.id === h.id)).toStrictEqual(h)
  })
})

test.describe('5.8 儲存後導向', () => {
  test('5.8 從手牌列表新增 → 儲存後返回手牌列表；從場次詳情新增 → 返回場次詳情', async ({ page }) => {
    await seed(page)
    await page.clock.setFixedTime(FIXED_NOW)
    await openHands(page)
    await page.getByRole('link', { name: '新增第一手' }).click()
    await expect(page.getByTestId('hand-form')).toBeVisible()
    await pickCards(page, slotButton(page.getByTestId('hero-cards'), '手牌', 1), ['As', 'Kd'])
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('手牌')
    expect(hashPath(page)).toBe('/hands')
    await expect(toast(page)).toHaveText('已儲存手牌')
    await expect(handRows(page)).toHaveCount(1)

    await openList(page)
    await openDetail(page, fixture.c1.id)
    await page.getByRole('button', { name: '＋ 新增手牌' }).click()
    await expect(page.getByTestId('hand-form')).toBeVisible()
    await pickCards(page, slotButton(page.getByTestId('hero-cards'), '手牌', 1), ['Qh', 'Qd'])
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('場次詳情')
    await expect(page.getByTestId('session-hands').getByTestId('hand-row')).toHaveCount(1)
    // 返回後的歷史：不會再回到新增頁
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(heading(page)).toHaveText('紀錄')
  })

  test('5.8 詳情「編輯」儲存後返回手牌詳情；「補齊為完整手牌」開啟完整模式步驟 1；「繼續補齊」停在最後狀態', async ({ page }) => {
    await seedFixtureHands(page)
    const unfinishedId = uuid(0x8401)
    const base = fixtureHands().find((h) => h.id === H_79)!
    const d = base.detail!
    const unfinished: Hand = {
      ...base,
      ...finalizeHandContent({
        ...base,
        sessionId: null,
        tags: [],
        note: null,
        board: [],
        detail: { ...d, rake: 0, seats: d.seats.map((s) => (s.seatNo === 6 ? { ...s, cards: [] } : s)), actions: d.actions.slice(0, 3) },
      }),
      id: unfinishedId,
      exportSeq: 41,
    }
    await putRecords(page, 'hands', [unfinished])
    await page.clock.setFixedTime(FIXED_NOW)
    await openHands(page)

    // 編輯 → 儲存 → 回到詳情（顯示新內容）
    await openHandDetail(page, H_MEMO)
    await page.getByRole('link', { name: '編輯' }).click()
    await expect(heading(page)).toHaveText('編輯手牌')
    await page.getByLabel('備註').fill('改過的備註')
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('手牌詳情')
    expect(hashPath(page)).toBe(`/hands/${H_MEMO}`)
    await expect(page.getByTestId('detail-note')).toHaveText('改過的備註')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(heading(page)).toHaveText('手牌')

    // 補齊為完整手牌：直接進入完整模式步驟 1，預填手牌與大盲
    await openHandDetail(page, H_MEMO)
    await page.getByRole('link', { name: '補齊為完整手牌' }).click()
    await expect(heading(page)).toHaveText('編輯手牌')
    await expect(page.getByTestId('setup-step')).toBeVisible()
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('100')
    await expect(slotButton(page.getByTestId('setup-hero-cards'), '你的手牌', 1)).toHaveAccessibleName('你的手牌第 1 張：紅心 A')
    // 未修改就返回：不詢問，回到詳情
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(heading(page)).toHaveText('手牌詳情')
    await page.getByRole('button', { name: '返回', exact: true }).click()

    // 未完成的手牌：「（尚未完成）」與「繼續補齊」→ 編輯頁停在最後狀態（翻前輪到你）
    await openHandDetail(page, unfinishedId)
    await expect(page.getByTestId('detail-unfinished')).toHaveText('（尚未完成）')
    await expect(page.getByRole('link', { name: '補齊為完整手牌' })).toHaveCount(0)
    await page.getByRole('link', { name: '繼續補齊' }).click()
    await expect(heading(page)).toHaveText('編輯手牌')
    await expect(page.getByTestId('to-act')).toHaveText('輪到 你 BTN（座位 4）· 剩 $20,000')

    // 完整手牌與 GG 手牌沒有補齊按鈕
    await page.goto(`./#/hands/${H_GG}`)
    await expect(page.getByTestId('detail-result')).toBeVisible()
    await expect(page.getByRole('link', { name: /補齊/ })).toHaveCount(0)
  })
})

test.describe('12.3 H2 設定頁「手牌」區塊（7.3、10.6）', () => {
  test('12.3 H2 設定頁匯出名稱：HC16 的 UI 部分（錯誤訊息）通過；儲存後寫入 Settings.handHeroName', async ({ page }) => {
    await seed(page)
    await page.goto('./#/settings')
    const input = page.getByLabel('匯出名稱')
    await expect(input).toHaveValue('Hero')
    await expect(page.getByText('匯出給 GTO Wizard 等工具時，你在手牌中的名稱')).toBeVisible()
    // 區塊位於顯示設定之後、資料備份之前
    const titles = await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents()
    expect(titles.indexOf('手牌')).toBe(titles.indexOf('顯示設定') + 1)
    expect(titles.indexOf('資料備份')).toBe(titles.indexOf('手牌') + 1)
    const save = page.getByRole('region', { name: '手牌' }).getByRole('button', { name: '儲存' })
    const invalid = '名稱需為 1–12 個英文字母、數字或底線，且以英文字母開頭'
    for (const name of ['1abc', 'Din:1', '[Hero]', '有中文', 'Hero Name', 'A'.repeat(13), '']) {
      await input.fill(name)
      await save.click()
      await expect(page.getByText(invalid), name).toBeVisible()
      await expect(input).toHaveAttribute('aria-invalid', 'true')
    }
    await input.fill('villain3')
    await save.click()
    await expect(page.getByText('不可使用 Villain 加數字的名稱')).toBeVisible()
    expect((await readSettings(page)).handHeroName).toBeUndefined()
    for (const name of ['A', 'Hero', 'Din_0326']) {
      await input.fill(name)
      // 已顯示錯誤後修改即時重新檢查
      await expect(page.getByText(invalid)).toHaveCount(0)
      await save.click()
      await expect(toast(page)).toHaveText('已儲存匯出名稱')
      await expect.poll(async () => (await readSettings(page)).handHeroName).toBe(name)
    }
    // 重新進入設定頁顯示已儲存的名稱
    await page.reload()
    await expect(page.getByLabel('匯出名稱')).toHaveValue('Din_0326')
  })
})

test.describe('H2 版面（9.2）', () => {
  for (const width of [375, 390, 430]) {
    test(`寬度 ${width}px 手牌列表、詳情、場次手牌區塊、設定頁無橫向捲動`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await seedFixtureHands(page)
      await putRecords(page, 'hands', [memo(uuid(0x8501), '2026-09-26T20:00:00', { tags: ['very long tag name 20', 'second tag here', 'third'], note: 'x'.repeat(300) })])
      for (const hash of ['#/hands', `#/hands/${H_79}`, `#/hands/${H_SIDE}`, `#/hands/${H_GG}`, `#/hands/${uuid(0x8501)}`, `#/sessions/${fixture.c1.id}`, '#/settings', `#/hands?sessionId=${fixture.c1.id}`]) {
        await page.goto(`./${hash}`)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expect(page.getByTestId('hand-row').first().or(page.getByTestId('detail-result')).or(page.getByLabel('匯出名稱')).first()).toBeVisible()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow, hash).toBeLessThanOrEqual(0)
      }
    })
  }

  test('手牌列表、詳情、刪除確認、場次手牌區塊的可點擊元件觸控區域至少 44×44px', async ({ page }) => {
    await seedFixtureHands(page)
    const check = async (label: string, scope = page.locator('body')) => {
      await waitForAnimations(page)
      const targets = scope.locator('a:visible, button:visible, select:visible, input:visible, textarea:visible')
      const count = await targets.count()
      expect(count, label).toBeGreaterThan(0)
      for (let i = 0; i < count; i++) {
        const box = (await targets.nth(i).boundingBox())!
        expect(box.width, `${label} target ${i}`).toBeGreaterThanOrEqual(44)
        expect(box.height, `${label} target ${i}`).toBeGreaterThanOrEqual(44)
      }
    }
    await openHands(page)
    await check('list')
    for (const id of [H_79, H_MEMO, H_GG]) {
      await page.goto(`./#/hands/${id}`)
      await expect(page.getByTestId('detail-result')).toBeVisible()
      await check(`detail ${id}`)
    }
    await page.getByRole('button', { name: '刪除' }).click()
    await check('delete sheet', page.getByRole('dialog'))
    await page.goto(`./#/sessions/${fixture.c1.id}`)
    await expect(page.getByTestId('session-hands').getByTestId('hand-row').first()).toBeVisible()
    await check('session detail')
    await page.goto('./#/settings')
    await page.getByLabel('匯出名稱').waitFor()
    await check('settings', page.getByRole('region', { name: '手牌' }))
  })
})
