import { expect, test, type Page } from '@playwright/test'
import { finalizeHandContent, type Hand, type HandContent } from '../../src/domain/hands'
import type { Session, Stake } from '../../src/domain/types'
import {
  FIXED_NOW,
  actionButton,
  betTo,
  cardName,
  chooseMode,
  dealStreet,
  dialog,
  enterSetup79,
  handBar,
  openNewHand,
  pickCards,
  pickInSheet,
  preflop79,
  setTime,
  slotButton,
  undoButton,
} from './helpers/handForm'
import { H_79, H_GG, fixtureHands } from './helpers/hands'
import { readSettings, readStore, putRecords } from './helpers/idb'
import { waitForAnimations } from './helpers/layout'
import { chooseImportFile, openSettings } from './helpers/settings'
import { fixture, fixtureSessions, heading, openDetail, openList, seed, stakes, uuid, venues } from './helpers/sessions'

// SPEC-v2-hands 12.3 H1 手動紀錄 UI 的 E2E（另見 tests/component/hands-*.test.tsx）

/** 7.9 範例的 detail（輸入資料 JSON 中的 detail，逐欄） */
const EXAMPLE_79_DETAIL = {
  tableSize: 6,
  buttonSeat: 4,
  heroSeat: 4,
  sb: 100,
  bb: 200,
  ante: 0,
  straddle: 0,
  seats: [
    { seatNo: 1, stack: 20000, cards: [], mucked: false, name: null },
    { seatNo: 2, stack: 20000, cards: [], mucked: false, name: null },
    { seatNo: 3, stack: 20000, cards: [], mucked: false, name: null },
    { seatNo: 4, stack: 20000, cards: ['As', 'Ks'], mucked: false, name: null },
    { seatNo: 5, stack: 24000, cards: [], mucked: false, name: null },
    { seatNo: 6, stack: 17100, cards: ['Kd', 'Qs'], mucked: false, name: null },
  ],
  actions: [
    { street: 'preflop', seatNo: 1, type: 'fold', to: null },
    { street: 'preflop', seatNo: 2, type: 'fold', to: null },
    { street: 'preflop', seatNo: 3, type: 'fold', to: null },
    { street: 'preflop', seatNo: 4, type: 'raise', to: 500 },
    { street: 'preflop', seatNo: 5, type: 'fold', to: null },
    { street: 'preflop', seatNo: 6, type: 'call', to: null },
    { street: 'flop', seatNo: 6, type: 'check', to: null },
    { street: 'flop', seatNo: 4, type: 'bet', to: 700 },
    { street: 'flop', seatNo: 6, type: 'call', to: null },
    { street: 'turn', seatNo: 6, type: 'check', to: null },
    { street: 'turn', seatNo: 4, type: 'bet', to: 1600 },
    { street: 'turn', seatNo: 6, type: 'raise', to: 15900 },
    { street: 'turn', seatNo: 4, type: 'call', to: null },
  ],
  rake: 400,
  collected: [{ seatNo: 4, potIndex: 0, amount: 33900 }],
}

const toast = (page: Page) => page.getByTestId('global-toast-text')
const logLines = (page: Page) => page.getByTestId('action-log').getByTestId('log-line')

/** 7.9 翻牌開始後到結果步驟並完成攤牌、抽水、儲存 */
async function finish79FromFlopAction(page: Page): Promise<void> {
  await actionButton(page, '過牌').click()
  await betTo(page, '下注', '700')
  await actionButton(page, '跟注 $700').click()
  await dealStreet(page, ['9s'], '開始轉牌')
  await expect(page.getByTestId('pot-line').first()).toContainText('底池 $2,500')
  await actionButton(page, '過牌').click()
  await betTo(page, '下注', '1600')
  await betTo(page, '加注', '15900')
  await actionButton(page, '跟注 $14,300').click()
  // BB 全下、Hero 是唯一有籌碼者 → 自動發完：一次選完剩餘公牌（河牌）
  await dealStreet(page, ['3h'], '確認公牌')
  const result = page.getByTestId('result-step')
  await expect(result).toBeVisible()
  await pickCards(page, slotButton(result, 'BB（6）', 1), ['Kd', 'Qs'])
  await page.getByLabel('抽水').fill('400')
  await expect(page.getByTestId('hero-result')).toHaveText('你 +$16,800 · +84.0 bb')
  await handBar(page).getByRole('button', { name: '儲存' }).click()
}

type DraftData = { version: number; values: Record<string, unknown> & { actions: unknown[]; board: unknown[] } }

/** 等草稿寫入（輸入停止 500ms 後）且內容符合條件 */
async function waitForDraft(page: Page, pred: (d: DraftData) => boolean = () => true): Promise<DraftData> {
  await expect
    .poll(async () => {
      const d = (await readSettings(page)).handDraft as DraftData | undefined
      return d !== undefined && pred(d)
    })
    .toBe(true)
  return (await readSettings(page)).handDraft as DraftData
}

function memoHand(id: string, patch: Partial<HandContent> = {}): Hand {
  return {
    id,
    exportSeq: 11,
    createdAt: '2026-09-28T23:00:00+08:00',
    updatedAt: '2026-09-28T23:00:00+08:00',
    ...finalizeHandContent({
      source: 'manual',
      gameType: 'cash',
      sessionId: null,
      playedAt: '2026-09-27T21:15:00',
      bb: 200,
      heroCards: ['As', 'Kd'],
      heroPosition: 'CO',
      board: ['Kh', '7d', '2c'],
      heroNet: 1500,
      detail: null,
      tags: ['3bet', 'bluff'],
      note: '備忘\n第二行',
      sourceHandId: null,
      rawText: null,
      parserVersion: null,
      ...patch,
    }),
  }
}

test.describe('12.3 H1 簡易模式', () => {
  test('12.3 H1 簡易模式新增一手（含手牌、公牌、結果、標籤），DB 內容與輸入一致', async ({ page }) => {
    await openNewHand(page)
    await setTime(page, '2026-09-30', 21, 15)
    await expect(page.getByTestId('hand-time-display')).toHaveText('2026/09/30 21:15')
    await page.getByLabel('位置').selectOption({ label: 'UTG+1' })
    await pickCards(page, slotButton(page.getByTestId('hero-cards'), '手牌', 1), ['As', 'Kd'])
    await pickCards(page, slotButton(page.getByTestId('board-cards'), '公牌', 1), ['Kh', '7d', '2c', '9s', 'Th'])
    await expect(slotButton(page.getByTestId('board-cards'), '公牌', 5)).toHaveAccessibleName('公牌第 5 張：紅心 10')
    // HC31：可接受千分位逗號輸入，儲存前去除
    await page.getByLabel('大盲', { exact: true }).fill('1,000')
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('1,000')
    await page.getByRole('group', { name: '結果' }).getByRole('button', { name: '輸' }).click()
    await page.getByLabel('結果金額').fill('16800')
    await page.getByLabel('新增標籤').fill('3bet')
    await page.getByLabel('新增標籤').press('Enter')
    await page.getByLabel('新增標籤').fill('  river bluff  ')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(page.getByTestId('tag-chip')).toHaveText(['3bet', 'river bluff'])
    await page.getByLabel('備註').fill('第一行\n第二行')
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(toast(page)).toHaveText('已儲存手牌')
    // 直接開啟網址進入（沒有上一頁）：返回首頁（手牌列表於 H2 實作）
    await expect(heading(page)).toHaveText('新增場次')

    const [hand] = await readStore<Hand>(page, 'hands')
    expect(hand).toMatchObject({
      kind: 'simple',
      source: 'manual',
      gameType: 'cash',
      amountUnit: 'yuan',
      sessionId: null,
      playedAt: '2026-09-30T21:15:00',
      bb: 1000,
      heroCards: ['As', 'Kd'],
      heroPosition: 'UTG1',
      board: ['Kh', '7d', '2c', '9s', 'Th'],
      heroNet: -16800,
      detail: null,
      tags: ['3bet', 'river bluff'],
      note: '第一行\n第二行',
      sourceHandId: null,
      rawText: null,
      parserVersion: null,
      exportSeq: 1,
    })
    // 儲存成功後刪除草稿
    expect((await readSettings(page)).handDraft).toBeUndefined()
  })

  test('HC31 簡易模式選「平」時金額為 0 且輸入框停用；結果 0 存為 heroNet 0', async ({ page }) => {
    await openNewHand(page)
    await page.getByRole('group', { name: '結果' }).getByRole('button', { name: '平' }).click()
    await expect(page.getByLabel('結果金額')).toBeDisabled()
    await expect(page.getByLabel('結果金額')).toHaveValue('0')
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(toast(page)).toHaveText('已儲存手牌')
    const [hand] = await readStore<Hand>(page, 'hands')
    expect(hand!.heroNet).toBe(0)
  })
})

test.describe('12.3 H1 完整模式', () => {
  test('12.3 H1 完整模式以 UI 逐步輸入 7.9 範例，儲存後 detail 與 7.9 JSON 完全相同', async ({ page }) => {
    await openNewHand(page)
    await enterSetup79(page)
    await preflop79(page)
    await dealStreet(page, ['Kh', '7d', '2c'], '開始翻牌')
    await expect(page.getByTestId('pot-line').first()).toContainText('底池 $1,100')
    await finish79FromFlopAction(page)
    await expect(toast(page)).toHaveText('已儲存手牌，你 +$16,800')

    const hands = await readStore<Hand>(page, 'hands')
    expect(hands).toHaveLength(1)
    const h = hands[0]!
    expect(h.detail).toStrictEqual(EXAMPLE_79_DETAIL)
    expect({
      kind: h.kind,
      source: h.source,
      gameType: h.gameType,
      amountUnit: h.amountUnit,
      sessionId: h.sessionId,
      playedAt: h.playedAt,
      bb: h.bb,
      heroCards: h.heroCards,
      heroPosition: h.heroPosition,
      board: h.board,
      heroNet: h.heroNet,
      exportSeq: h.exportSeq,
    }).toStrictEqual({
      kind: 'complete',
      source: 'manual',
      gameType: 'cash',
      amountUnit: 'yuan',
      sessionId: null,
      playedAt: '2026-09-30T21:15:00',
      bb: 200,
      heroCards: ['As', 'Ks'],
      heroPosition: 'BTN',
      board: ['Kh', '7d', '2c', '9s', '3h'],
      heroNet: 16800,
      exportSeq: 1,
    })
    // 5.8：完整模式儲存時更新 Settings.lastHandSetup
    expect((await readSettings(page)).lastHandSetup).toEqual({
      gameType: 'cash',
      tableSize: 6,
      sb: 100,
      bb: 200,
      ante: 0,
      straddle: 0,
      defaultStack: 20000,
      heroSeat: 4,
    })
  })

  test('12.3 H1 復原上一步可一路退回到步驟 1 之後；退回公牌步驟會清除該街公牌', async ({ page }) => {
    await openNewHand(page)
    await enterSetup79(page)
    await expect(undoButton(page)).toBeDisabled()
    await preflop79(page)
    await dealStreet(page, ['Kh', '7d', '2c'], '開始翻牌')
    await actionButton(page, '過牌').click()
    await expect(logLines(page)).toHaveCount(7)

    // 移除最後一筆行動（翻牌 BB 過牌）
    await undoButton(page).click()
    await expect(logLines(page)).toHaveCount(6)
    await expect(page.getByTestId('to-act')).toHaveText('輪到 BB（座位 6）· 剩 $16,600')
    // 最後一步是選公牌：清除該街公牌並回到上一街結束狀態（翻牌牌位重新變空）
    await undoButton(page).click()
    const flopSlots = page.getByTestId('street-board-slots').getByRole('button')
    await expect(flopSlots).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(flopSlots.nth(i)).toHaveAttribute('data-card', '')
    await expect(handBar(page).getByRole('button', { name: '開始翻牌' })).toBeVisible()
    // 一路退回到步驟 1 之後（翻前、沒有任何行動）
    for (let i = 0; i < 6; i++) await undoButton(page).click()
    await expect(logLines(page)).toHaveCount(0)
    await expect(page.getByTestId('to-act')).toHaveText('輪到 UTG（座位 1）· 剩 $20,000')
    await expect(page.getByRole('navigation', { name: '進度' }).getByRole('button', { name: '翻前' })).toHaveAttribute('aria-current', 'step')
    await expect(undoButton(page)).toBeDisabled()
  })

  test('5.3 已完成的步驟可點擊回看（只能檢視）；新增模式中回看牌局設定時欄位停用', async ({ page }) => {
    await openNewHand(page)
    await enterSetup79(page)
    await preflop79(page)
    const progress = page.getByRole('navigation', { name: '進度' })
    await expect(progress.getByRole('button', { name: '轉牌' })).toBeDisabled()
    await progress.getByRole('button', { name: '設定' }).click()
    await expect(page.getByLabel('小盲', { exact: true })).toBeDisabled()
    await handBar(page).getByRole('button', { name: '回到目前步驟' }).click()
    await expect(page.getByTestId('street-board-slots')).toBeVisible()
  })

  test('5.1 從「完整」切到「簡易」且已輸入行動時跳出確認，取消不切換、確定則捨棄行動並保留共用欄位', async ({ page }) => {
    await openNewHand(page)
    await enterSetup79(page)
    await actionButton(page, '棄牌').click()
    await chooseMode(page, '簡易')
    const sheet = dialog(page)
    await expect(sheet).toHaveAccessibleName('切換到簡易模式會捨棄已輸入的牌局設定與行動，確定嗎？')
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(logLines(page)).toHaveCount(1)
    await chooseMode(page, '簡易')
    await dialog(page).getByRole('button', { name: '確定' }).click()
    await expect(page.getByTestId('simple-fields')).toBeVisible()
    // 共用欄位（時間、你的手牌）保留
    await expect(page.getByTestId('hand-time-display')).toHaveText('2026/09/30 21:15')
    await expect(slotButton(page.getByTestId('hero-cards'), '手牌', 1)).toHaveAccessibleName('手牌第 1 張：黑桃 A')
    await chooseMode(page, '完整')
    await expect(page.getByTestId('setup-step')).toBeVisible()
    await expect(page.getByLabel('座位 5 籌碼')).toHaveValue('20,000')
  })
})

test.describe('12.3 H1 選牌器', () => {
  test('12.3 H1 選牌器：已使用的牌 disabled；四種花色都用掉的點數 disabled；每顆按鈕觸控區 ≥ 44×44px', async ({ page }) => {
    await openNewHand(page)
    await pickCards(page, slotButton(page.getByTestId('hero-cards'), '手牌', 1), ['As', 'Ah'])
    await slotButton(page.getByTestId('board-cards'), '公牌', 1).click()
    const sheet = page.getByTestId('card-picker')
    await pickInSheet(page, ['Ad', 'Kh'])
    // 已使用的牌：花色按鈕停用，aria-label 標明「已使用」，以刪除線呈現
    await sheet.getByRole('button', { name: '點數 A', exact: true }).click()
    const usedSpade = sheet.getByRole('button', { name: `${cardName('As')}（已使用）` })
    await expect(usedSpade).toBeDisabled()
    await expect(sheet.getByRole('button', { name: `${cardName('Ad')}（已使用）` })).toBeDisabled()
    await expect(sheet.getByRole('button', { name: cardName('Ac'), exact: true })).toBeEnabled()
    expect(await usedSpade.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through')
    // 第 4 張 A 用掉後，點數 A 停用
    await sheet.getByRole('button', { name: cardName('Ac'), exact: true }).click()
    await expect(sheet.getByRole('button', { name: '點數 A', exact: true })).toBeDisabled()
    await expect(sheet.getByRole('button', { name: '點數 K', exact: true })).toBeEnabled()
    // 選完一張自動跳到下一個空牌位：第 4 張為作用中
    await expect(slotButton(sheet, '公牌', 4)).toHaveAttribute('aria-current', 'true')
    // 點擊已填的牌位可清除並重選
    await slotButton(sheet, '公牌', 2).click()
    await expect(slotButton(sheet, '公牌', 2)).toHaveAccessibleName('公牌第 2 張：未選')
    await sheet.getByRole('button', { name: '點數 K', exact: true }).click()
    await expect(sheet.getByRole('button', { name: cardName('Kh'), exact: true })).toBeEnabled()

    // 每顆按鈕觸控區 ≥ 44×44px（量測前等面板彈出動畫結束）
    await waitForAnimations(page)
    const buttons = sheet.getByRole('button')
    const count = await buttons.count()
    expect(count).toBe(5 + 13 + 4 + 1)
    for (let i = 0; i < count; i++) {
      const box = (await buttons.nth(i).boundingBox())!
      expect(box.width, `button ${i}`).toBeGreaterThanOrEqual(44)
      expect(box.height, `button ${i}`).toBeGreaterThanOrEqual(44)
    }
    // 點數 13 顆排成 7 + 6 兩列
    const rankTops = await sheet.getByTestId('picker-rank').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
    expect(new Set(rankTops.slice(0, 7)).size).toBe(1)
    expect(new Set(rankTops.slice(7)).size).toBe(1)
    expect(rankTops[7]!).toBeGreaterThan(rankTops[0]!)
    // 「完成」關閉，未填滿的牌位保持空白
    await sheet.getByRole('button', { name: '完成' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(slotButton(page.getByTestId('board-cards'), '公牌', 2)).toHaveAccessibleName('公牌第 2 張：未選')
  })
})

test.describe('12.3 H1 草稿', () => {
  test('12.3 H1 草稿：簡易模式填到一半重新載入，草稿還原', async ({ page }) => {
    await openNewHand(page)
    await pickCards(page, slotButton(page.getByTestId('hero-cards'), '手牌', 1), ['Qs', 'Qh'])
    await page.getByLabel('大盲', { exact: true }).fill('12.5')
    await page.getByLabel('新增標籤').fill('還沒按新增')
    await page.getByLabel('備註').fill('草稿備註')
    const draft = await waitForDraft(page, (d) => d.values.note === '草稿備註' && d.values.tagInput === '還沒按新增')
    expect(draft).toMatchObject({ version: 1, values: { mode: 'simple', bb: '12.5', note: '草稿備註', heroCards: ['Qs', 'Qh'] } })
    await page.reload()
    await expect(page.getByTestId('simple-fields')).toBeVisible()
    await expect(slotButton(page.getByTestId('hero-cards'), '手牌', 2)).toHaveAccessibleName('手牌第 2 張：紅心 Q')
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('12.5')
    await expect(page.getByLabel('新增標籤')).toHaveValue('還沒按新增')
    await expect(page.getByLabel('備註')).toHaveValue('草稿備註')
    // 「清除」刪除草稿並回到預帶值
    await page.getByRole('button', { name: '清除' }).click()
    await expect(page.getByLabel('備註')).toHaveValue('')
    await expect.poll(async () => (await readSettings(page)).handDraft).toBeUndefined()
  })

  test('12.3 H1 草稿：完整模式填到一半重新載入，草稿還原（步驟、行動、公牌）', async ({ page }) => {
    await openNewHand(page)
    await enterSetup79(page)
    await preflop79(page)
    // 翻牌選了 2 張、尚未開始翻牌
    await pickCards(page, page.getByTestId('street-board-slots').getByRole('button').first(), ['Kh', '7d'], { close: true })
    await waitForDraft(page, (d) => d.values.actions.length === 6 && JSON.stringify(d.values.board) === JSON.stringify(['Kh', '7d', null, null, null]))
    await page.reload()
    await expect(page.getByTestId('street-step-flop')).toBeVisible()
    await expect(logLines(page)).toHaveCount(6)
    const slots = page.getByTestId('street-board-slots').getByRole('button')
    await expect(slots.nth(0)).toHaveAttribute('data-card', 'Kh')
    await expect(slots.nth(1)).toHaveAttribute('data-card', '7d')
    await expect(slots.nth(2)).toHaveAttribute('data-card', '')
    // 還原後可繼續：補第 3 張開始翻牌，一路完成並儲存，結果與 7.9 相同
    await pickCards(page, slots.nth(2), ['2c'])
    await handBar(page).getByRole('button', { name: '開始翻牌' }).click()
    await finish79FromFlopAction(page)
    await expect(toast(page)).toHaveText('已儲存手牌，你 +$16,800')
    const [hand] = await readStore<Hand>(page, 'hands')
    expect(hand!.detail).toStrictEqual(EXAMPLE_79_DETAIL)
  })

  test('5.7 草稿中的行動無法還原時，捨棄行動、保留牌局設定並提示', async ({ page }) => {
    await openNewHand(page)
    await enterSetup79(page)
    await preflop79(page)
    const draft = await waitForDraft(page, (d) => d.values.actions.length === 6)
    const values = draft.values
    // 模擬不合法的行動（座位 1 在翻牌行動，但他已棄牌）
    await putRecords(page, 'settings', [
      { key: 'handDraft', value: { ...draft, values: { ...values, actions: [...(values.actions as unknown[]), { street: 'flop', seatNo: 1, type: 'check', to: null }], boardSteps: [3], board: ['Kh', '7d', '2c', null, null] } } },
    ])
    await page.reload()
    await expect(toast(page)).toHaveText('草稿中的行動無法還原，已保留牌局設定')
    await expect(page.getByTestId('setup-step')).toBeVisible()
    await expect(page.getByLabel('座位 6 籌碼')).toHaveValue('17,100')
    await expect(page.getByRole('radio', { name: '座位 4 按鈕' })).toBeChecked()
  })

  test('12.3 H1 草稿：帶不同 sessionId 進入時跳出 5.7 的選擇（繼續草稿 / 捨棄並重新開始）', async ({ page }) => {
    await seed(page)
    await openNewHand(page)
    await pickCards(page, slotButton(page.getByTestId('hero-cards'), '手牌', 1), ['Jc', 'Td'])
    await waitForDraft(page, (d) => JSON.stringify(d.values.heroCards) === JSON.stringify(['Jc', 'Td']))

    // 草稿沒有關聯場次、這次帶 c1 進入 → 詢問；「繼續草稿」還原草稿並忽略這次帶的 sessionId
    await page.goto(`./#/hands/new?sessionId=${fixture.c1.id}`)
    const prompt = page.getByRole('dialog', { name: '有一手未儲存的手牌草稿，要繼續編輯嗎？' })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: '繼續草稿' }).click()
    await expect(slotButton(page.getByTestId('hero-cards'), '手牌', 1)).toHaveAccessibleName('手牌第 1 張：梅花 J')
    await expect(page.getByLabel('關聯場次')).toHaveValue('')

    // 「捨棄並重新開始」：刪除草稿，依這次的入口預帶（關聯場次 c1、現金桌、盲注帶入該場 50 / 100）
    await page.reload()
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: '捨棄並重新開始' }).click()
    await expect(page.getByLabel('關聯場次')).toHaveValue(fixture.c1.id)
    await expect(slotButton(page.getByTestId('hero-cards'), '手牌', 1)).toHaveAccessibleName('手牌第 1 張：未選')
    await expect.poll(async () => (await readSettings(page)).handDraft).toBeUndefined()
    await chooseMode(page, '完整')
    await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('50')
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('100')

    // 草稿的關聯場次與這次帶的相同 → 直接還原
    await waitForDraft(page, (d) => d.values.mode === 'complete' && d.values.sessionId === fixture.c1.id)
    await page.reload()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('setup-step')).toBeVisible()
  })
})

test.describe('12.3 H1 暫存為簡易、補齊、編輯', () => {
  test('12.3 H1 暫存為簡易：未完成手牌儲存為 simple 且帶 detail，之後「繼續補齊」完成後 kind 變為 complete、id 不變', async ({ page }) => {
    await openNewHand(page)
    await enterSetup79(page)
    await preflop79(page)
    await dealStreet(page, ['Kh', '7d', '2c'], '開始翻牌')
    await actionButton(page, '過牌').click()
    await page.getByRole('button', { name: '更多操作' }).click()
    await dialog(page).getByRole('button', { name: '暫存為簡易' }).click()
    await expect(toast(page)).toHaveText('已儲存手牌')

    const [saved] = await readStore<Hand>(page, 'hands')
    expect(saved!.kind).toBe('simple')
    expect(saved!.heroNet).toBeNull()
    expect(saved!.board).toEqual(['Kh', '7d', '2c'])
    expect(saved!.detail!.actions).toEqual(EXAMPLE_79_DETAIL.actions.slice(0, 7))
    expect(saved!.detail!.collected).toEqual([])
    expect(saved!.detail!.seats.find((s) => s.seatNo === 6)!.cards).toEqual([])
    expect((await readSettings(page)).handDraft).toBeUndefined()

    // 繼續補齊（H2 的詳情頁按鈕進入同一個編輯頁）：進度停在最後狀態
    await page.goto(`./#/hands/${saved!.id}/edit`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('編輯手牌')
    await expect(page.getByTestId('to-act')).toHaveText('輪到 你 BTN（座位 4）· 剩 $19,500')
    await betTo(page, '下注', '700')
    await actionButton(page, '跟注 $700').click()
    await dealStreet(page, ['9s'], '開始轉牌')
    await actionButton(page, '過牌').click()
    await betTo(page, '下注', '1600')
    await betTo(page, '加注', '15900')
    await actionButton(page, '跟注 $14,300').click()
    await dealStreet(page, ['3h'], '確認公牌')
    await pickCards(page, slotButton(page.getByTestId('result-step'), 'BB（6）', 1), ['Kd', 'Qs'])
    await page.getByLabel('抽水').fill('400')
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('新增場次')

    const hands = await readStore<Hand>(page, 'hands')
    expect(hands).toHaveLength(1)
    const done = hands[0]!
    expect(done.id).toBe(saved!.id)
    expect(done.exportSeq).toBe(saved!.exportSeq)
    expect(done.createdAt).toBe(saved!.createdAt)
    expect(done.kind).toBe('complete')
    expect(done.heroNet).toBe(16800)
    expect(done.detail).toStrictEqual(EXAMPLE_79_DETAIL)
  })

  test('12.3 H1 補齊為完整手牌：簡易備忘的手牌、大盲、時間、標籤、備註預填', async ({ page }) => {
    await openNewHand(page)
    const id = uuid(0x9001)
    await putRecords(page, 'hands', [memoHand(id)])
    await page.goto(`./#/hands/${id}/edit`)
    await expect(page.getByTestId('simple-fields')).toBeVisible()
    await page.getByRole('button', { name: '補齊為完整手牌' }).click()
    await expect(page.getByTestId('setup-step')).toBeVisible()
    // 時間、手牌、大盲（小盲 = 大盲 ÷ 2）預填
    await expect(page.getByTestId('hand-time-display')).toHaveText('2026/09/27 21:15')
    await expect(slotButton(page.getByTestId('setup-hero-cards'), '你的手牌', 1)).toHaveAccessibleName('你的手牌第 1 張：黑桃 A')
    await expect(slotButton(page.getByTestId('setup-hero-cards'), '你的手牌', 2)).toHaveAccessibleName('你的手牌第 2 張：方塊 K')
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('200')
    await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('100')
    // 位置 CO：你在座位 1（預設），按鈕推算為座位 2（6 人桌 2 BTN、3 SB、4 BB、5 UTG、6 HJ、1 CO）
    await expect(page.getByRole('radio', { name: '座位 1 你' })).toBeChecked()
    await expect(page.getByRole('radio', { name: '座位 2 按鈕' })).toBeChecked()
    await expect(page.getByRole('switch', { name: '座位 1 空位' })).toHaveAttribute('aria-checked', 'false')
    await handBar(page).getByRole('button', { name: '開始翻前' }).click()
    // 翻前其他人都棄牌到大盲（UTG、HJ、你、BTN、SB）→ 結果步驟：標籤、備註已預填
    for (let i = 0; i < 5; i++) await actionButton(page, '棄牌').click()
    await expect(page.getByTestId('result-step')).toBeVisible()
    await expect(page.getByTestId('tag-chip')).toHaveText(['3bet', 'bluff'])
    await expect(page.getByLabel('備註')).toHaveValue('備忘\n第二行')
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('新增場次')
    const [hand] = await readStore<Hand>(page, 'hands')
    expect(hand).toMatchObject({ id, exportSeq: 11, kind: 'complete', heroPosition: 'CO', bb: 200, heroCards: ['As', 'Kd'], board: [], heroNet: 0, tags: ['3bet', 'bluff'], note: '備忘\n第二行', playedAt: '2026-09-27T21:15:00' })
    // 備忘的結果被計算值取代（你在 CO 棄牌、沒有投入）
    expect(hand!.detail!.buttonSeat).toBe(2)
  })

  test('12.3 H1 修改牌局設定時跳出「會清除所有已輸入的行動」確認，取消不變更；確定後清除行動、公牌保留', async ({ page }) => {
    await seed(page)
    await putRecords(page, 'hands', fixtureHands())
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto(`./#/hands/${H_79}/edit`)
    await expect(page.getByTestId('result-step')).toBeVisible()
    await expect(logLines(page)).toHaveCount(13)
    await page.getByRole('navigation', { name: '進度' }).getByRole('button', { name: '設定' }).click()
    // 編輯模式：時間、你的手牌可直接修改（不清除行動）
    await page.getByRole('combobox', { name: '分鐘' }).selectOption('30')
    await expect(dialog(page)).toHaveCount(0)

    await page.getByLabel('小盲', { exact: true }).fill('50')
    const confirm = page.getByRole('dialog', { name: '修改牌局設定會清除所有已輸入的行動，確定嗎？' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('100')
    await handBar(page).getByRole('button', { name: '回到目前步驟' }).click()
    await expect(logLines(page)).toHaveCount(13)

    await page.getByRole('navigation', { name: '進度' }).getByRole('button', { name: '設定' }).click()
    // 已有行動時，點按鈕單選先跳出確認（選取狀態不變），確定後才套用
    await page.getByRole('radio', { name: '座位 5 按鈕' }).click()
    await expect(page.getByRole('radio', { name: '座位 4 按鈕' })).toBeChecked()
    await page.getByRole('dialog', { name: '修改牌局設定會清除所有已輸入的行動，確定嗎？' }).getByRole('button', { name: '確定' }).click()
    await expect(page.getByRole('radio', { name: '座位 5 按鈕' })).toBeChecked()
    await handBar(page).getByRole('button', { name: '開始翻前' }).click()
    await expect(logLines(page)).toHaveCount(0)
    await page.getByRole('button', { name: '更多操作' }).click()
    await dialog(page).getByRole('button', { name: '暫存為簡易' }).click()
    await expect(heading(page)).toHaveText('新增場次')
    const hand = (await readStore<Hand>(page, 'hands')).find((h) => h.id === H_79)!
    expect(hand.kind).toBe('simple')
    expect(hand.detail!.actions).toEqual([])
    expect(hand.detail!.buttonSeat).toBe(5)
    expect(hand.playedAt).toBe('2026-09-27T21:30:00')
  })

  test('5.8 編輯有未儲存變更時按返回，跳出「放棄變更？」確認', async ({ page }) => {
    await openNewHand(page)
    const id = uuid(0x9002)
    await putRecords(page, 'hands', [memoHand(id)])
    await page.goto('./#/')
    await page.goto(`./#/hands/${id}/edit`)
    await page.getByLabel('備註').fill('改過')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '放棄變更？' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(page.getByLabel('備註')).toHaveValue('改過')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('dialog', { name: '放棄變更？' }).getByRole('button', { name: '確定' }).click()
    await expect(heading(page)).toHaveText('新增場次')
    const [hand] = await readStore<Hand>(page, 'hands')
    expect(hand!.note).toBe('備忘\n第二行')
  })

  test('HC31 手動簡易手牌由現金桌改為錦標賽後 amountUnit 變為 chip、bb 數值不變', async ({ page }) => {
    await openNewHand(page)
    const id = uuid(0x9003)
    await putRecords(page, 'hands', [memoHand(id)])
    await page.goto(`./#/hands/${id}/edit`)
    await page.getByRole('group', { name: '牌局類型' }).getByRole('button', { name: '錦標賽' }).click()
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('新增場次')
    const [hand] = await readStore<Hand>(page, 'hands')
    expect(hand).toMatchObject({ id, gameType: 'tournament', amountUnit: 'chip', bb: 200, heroNet: 1500, exportSeq: 11 })
  })

  test('5.8 匯入的手牌（GG）只能修改關聯場次、標籤與備註（HQ17）', async ({ page }) => {
    await seed(page)
    await putRecords(page, 'hands', fixtureHands())
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto(`./#/hands/${H_GG}/edit`)
    await expect(page.getByRole('note')).toHaveText('匯入的手牌只能修改關聯場次、標籤與備註')
    await expect(page.getByLabel('日期', { exact: true })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: '小時' })).toBeDisabled()
    await expect(page.getByTestId('setup-step')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '更多操作' })).toHaveCount(0)
    const before = (await readStore<Hand>(page, 'hands')).find((h) => h.id === H_GG)!
    await page.getByLabel('關聯場次').selectOption(fixture.c1.id)
    await page.getByLabel('新增標籤').fill('GG')
    await page.getByLabel('新增標籤').press('Enter')
    await page.getByLabel('備註').fill('匯入後補註')
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('新增場次')
    const after = (await readStore<Hand>(page, 'hands')).find((h) => h.id === H_GG)!
    const { updatedAt: _a, sessionId: _s, tags: _t, note: _n, ...restAfter } = after
    const { updatedAt: _b, sessionId: _s2, tags: _t2, note: _n2, ...restBefore } = before
    void [_a, _s, _t, _n, _b, _s2, _t2, _n2]
    expect(restAfter).toStrictEqual(restBefore)
    expect({ sessionId: after.sessionId, tags: after.tags, note: after.note }).toEqual({ sessionId: fixture.c1.id, tags: ['GG'], note: '匯入後補註' })
  })
})

test.describe('12.3 H1 入口與預帶', () => {
  test('5.1 場次詳情「＋ 新增手牌」→ 預先關聯該場、盲注帶入該場，儲存後返回場次詳情', async ({ page }) => {
    await seed(page)
    await openList(page)
    await openDetail(page, fixture.c1.id)
    await page.getByRole('button', { name: '＋ 新增手牌' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增手牌')
    expect(decodeURIComponent(new URL(page.url()).hash)).toBe(`#/hands/new?sessionId=${fixture.c1.id}`)
    await expect(page.getByLabel('關聯場次')).toHaveValue(fixture.c1.id)
    await expect(page.getByLabel('關聯場次').locator('option:checked')).toHaveText('09/27 · 6bet · 50/100')
    await chooseMode(page, '完整')
    await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('50')
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('100')
    // 首次使用：預設籌碼 100 bb
    await expect(page.getByLabel('預設籌碼')).toHaveValue('10,000')
    await chooseMode(page, '簡易')
    await pickCards(page, slotButton(page.getByTestId('hero-cards'), '手牌', 1), ['As', 'Kd'])
    await handBar(page).getByRole('button', { name: '儲存' }).click()
    await expect(heading(page)).toHaveText('場次詳情')
    await expect(toast(page)).toHaveText('已儲存手牌')
    const [hand] = await readStore<Hand>(page, 'hands')
    expect(hand!.sessionId).toBe(fixture.c1.id)
  })

  test('HC31 從 Stake 1/2 的場次新增手牌預帶 sb 1、bb 2（不 × 100）', async ({ page }) => {
    const stake: Stake = { id: uuid(0x2101), sb: 1, bb: 2, archived: false, sortOrder: 5 }
    const session: Session = { ...fixture.c1, id: uuid(0x2102), stakeId: stake.id }
    await seed(page, { venues, stakes: [...stakes, stake], sessions: [...fixtureSessions, session] })
    await openNewHand(page, `?sessionId=${session.id}`)
    await chooseMode(page, '完整')
    await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('1')
    await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('2')
    await expect(page.getByLabel('預設籌碼')).toHaveValue('200')
  })

  test('5.1 lastHandSetup 預帶；與這次 gameType 不同時前注、預設籌碼改用首次預設', async ({ page }) => {
    await seed(page)
    await putRecords(page, 'settings', [
      { key: 'lastHandSetup', value: { gameType: 'tournament', tableSize: 8, sb: 300, bb: 600, ante: 75, straddle: 0, defaultStack: 30000, heroSeat: 3 } },
    ])
    // 不帶場次：沿用 lastHandSetup（錦標賽、8 人、300 / 600、前注 75、預設籌碼 30,000、你在座位 3）
    await openNewHand(page)
    await chooseMode(page, '完整')
    await expect(page.getByRole('group', { name: '牌局類型' }).getByRole('button', { name: '錦標賽' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('group', { name: '人數' }).getByRole('button', { name: '8' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('前注')).toHaveValue('75')
    await expect(page.getByLabel('預設籌碼')).toHaveValue('30,000')
    await expect(page.getByRole('radio', { name: '座位 3 你' })).toBeChecked()
    // 從現金桌場次進入：盲注帶入該場、前注 0、預設籌碼 100 bb
    await page.getByRole('button', { name: '清除' }).click()
    await expect.poll(async () => (await readSettings(page)).handDraft).toBeUndefined()
    await openNewHand(page, `?sessionId=${fixture.c1.id}`)
    await chooseMode(page, '完整')
    await expect(page.getByRole('group', { name: '牌局類型' }).getByRole('button', { name: '現金桌' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('50')
    await expect(page.getByLabel('前注')).toHaveValue('0')
    await expect(page.getByLabel('預設籌碼')).toHaveValue('10,000')
  })
})

test.describe('12.3 H1 版面', () => {
  // 9.2：375–430px 間不得出現橫向捲動；所有可點擊元件觸控區域至少 44×44px
  for (const width of [375, 430]) {
    test(`寬度 ${width}px 新增手牌頁（簡易、完整各步驟）無橫向捲動`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      const noOverflow = async (label: string) =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBeLessThanOrEqual(0)
      await openNewHand(page)
      await noOverflow('simple')
      await enterSetup79(page)
      await noOverflow('preflop')
      await preflop79(page)
      await noOverflow('flop board')
      await dealStreet(page, ['Kh', '7d', '2c'], '開始翻牌')
      await actionButton(page, '過牌').click()
      await actionButton(page, '下注').click()
      await noOverflow('bet sheet')
    })
  }

  test('新增手牌頁可點擊元件觸控區域至少 44×44px', async ({ page }) => {
    // 量測的元件多，平行執行時較慢
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 375, height: 812 })
    const check = async (label: string) => {
      await waitForAnimations(page)
      // 一次取得所有可見的可點擊元件尺寸（可見 = 有尺寸且未 visibility: hidden，同 Playwright :visible）
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('a, button, select, input, textarea')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden')
          .map(({ el, r }) => ({ name: el.getAttribute('aria-label') ?? el.textContent ?? el.tagName, width: r.width, height: r.height })),
      )
      expect(sizes.length).toBeGreaterThan(0)
      for (const s of sizes) {
        expect(s.width, `${label} ${s.name}`).toBeGreaterThanOrEqual(44)
        expect(s.height, `${label} ${s.name}`).toBeGreaterThanOrEqual(44)
      }
    }
    await openNewHand(page)
    await page.getByLabel('新增標籤').fill('x')
    await page.getByLabel('新增標籤').press('Enter')
    await check('simple')
    await enterSetup79(page)
    await page.getByRole('navigation', { name: '進度' }).getByRole('button', { name: '設定' }).click()
    await check('setup')
    await handBar(page).getByRole('button', { name: '回到目前步驟' }).click()
    await check('action bar')
    await preflop79(page)
    await dealStreet(page, ['Kh', '7d', '2c'], '開始翻牌')
    await actionButton(page, '過牌').click()
    await actionButton(page, '下注').click()
    await check('bet sheet')
  })
})

test('10.2 匯入確認視窗並排顯示「目前：N 場、H 手 / 備份檔：M 場、K 手（備份時間）」，完成提示含手牌數', async ({ page }) => {
  await seed(page)
  await putRecords(page, 'hands', fixtureHands())
  await openSettings(page)
  const hands = fixtureHands().slice(0, 3)
  await chooseImportFile(
    page,
    JSON.stringify({ app: 'poker-tracker', schemaVersion: 3, exportedAt: '2026-09-28T21:05:00+08:00', sessions: fixtureSessions.slice(0, 4), venues, stakes, hands, settings: {} }),
  )
  const sheet = page.getByRole('dialog', { name: '匯入備份？' })
  await expect(sheet.getByTestId('import-current-count')).toHaveText('7 場、5 手')
  await expect(sheet.getByTestId('import-backup-count')).toHaveText('4 場、3 手')
  await expect(sheet.getByTestId('import-backup-time')).toHaveText('備份時間 2026/09/28 21:05')
  await sheet.getByRole('button', { name: '匯入', exact: true }).click()
  await expect(toast(page)).toHaveText('已匯入 4 場紀錄、3 手牌')
  expect(await readStore(page, 'hands')).toHaveLength(3)
})
