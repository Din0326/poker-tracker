import { expect, type Locator, type Page } from '@playwright/test'

// H1 新增 / 編輯手牌頁的操作捷徑

const SUIT_NAMES: Record<string, string> = { s: '黑桃', h: '紅心', d: '方塊', c: '梅花' }
const rankText = (r: string) => (r === 'T' ? '10' : r)

/** 牌的完整名稱（選牌器花色按鈕的 aria-label），例 As → 黑桃 A */
export function cardName(card: string): string {
  return `${SUIT_NAMES[card[1]!]} ${rankText(card[0]!)}`
}

/** 測試固定的「現在」：2026-10-01 12:00（本地時間）；計時器照常運作（setFixedTime 只固定 Date） */
export const FIXED_NOW = new Date(2026, 9, 1, 12, 0, 0)

export async function openNewHand(page: Page, query = ''): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await page.goto(`./#/hands/new${query}`)
  await expect(page.getByTestId('hand-form')).toBeVisible()
}

export const handBar = (page: Page) => page.getByTestId('hand-bar')
export const dialog = (page: Page) => page.getByRole('dialog')

export async function chooseMode(page: Page, mode: '簡易' | '完整'): Promise<void> {
  await page.getByRole('group', { name: '紀錄模式' }).getByRole('button', { name: mode, exact: true }).click()
}

/** 在已開啟的選牌器中依序選牌（每張先點數再花色） */
export async function pickInSheet(page: Page, cards: readonly string[]): Promise<void> {
  const sheet = page.getByTestId('card-picker')
  for (const card of cards) {
    await sheet.getByRole('button', { name: `點數 ${rankText(card[0]!)}`, exact: true }).click()
    await sheet.getByRole('button', { name: cardName(card), exact: true }).click()
  }
}

/** 點擊牌位開啟選牌器並選牌；選滿後選牌器自動關閉，未選滿時按「完成」 */
export async function pickCards(page: Page, slot: Locator, cards: readonly string[], { close = false } = {}): Promise<void> {
  await slot.click()
  await expect(page.getByTestId('card-picker')).toBeVisible()
  await pickInSheet(page, cards)
  if (close) await page.getByTestId('card-picker').getByRole('button', { name: '完成' }).click()
  await expect(page.getByTestId('card-picker')).toHaveCount(0)
}

export const slotButton = (scope: Page | Locator, group: string, n: number) =>
  scope.getByRole('button', { name: new RegExp(`^${group}第 ${n} 張：`) })

export async function setTime(page: Page, date: string, hour: number, minute: number): Promise<void> {
  await page.getByLabel('日期', { exact: true }).fill(date)
  await page.getByRole('combobox', { name: '小時' }).selectOption(String(hour))
  await page.getByRole('combobox', { name: '分鐘' }).selectOption(String(minute))
}

export const actionBar = (page: Page) => page.getByTestId('action-bar')
export const actionButton = (page: Page, name: string | RegExp) => actionBar(page).getByRole('button', { name, exact: typeof name === 'string' })

/** 行動列按「下注 / 加注」後在 bottom sheet 輸入金額並確定 */
export async function betTo(page: Page, kind: '下注' | '加注', amount: string): Promise<void> {
  await actionButton(page, kind).click()
  const sheet = dialog(page)
  await sheet.getByLabel(kind === '下注' ? '下注到' : '加注到').fill(amount)
  await sheet.getByRole('button', { name: '確定' }).click()
  await expect(sheet).toHaveCount(0)
}

export const undoButton = (page: Page) => handBar(page).getByRole('button', { name: '復原上一步' })

/** 完整模式：輸入公牌（街開始時的牌位）並按開始該街 */
export async function dealStreet(page: Page, cards: readonly string[], start: string): Promise<void> {
  const slots = page.getByTestId('street-board-slots')
  await pickCards(page, slots.getByRole('button').first(), cards)
  await handBar(page).getByRole('button', { name: start }).click()
}

/** 完整模式步驟 1：7.9 的牌局設定（6 人、100 / 200、按鈕與你在座位 4、座位 5 24000、座位 6 17100、你 A♠ K♠） */
export async function enterSetup79(page: Page): Promise<void> {
  await chooseMode(page, '完整')
  await setTime(page, '2026-09-30', 21, 15)
  await expect(page.getByLabel('小盲', { exact: true })).toHaveValue('100')
  await expect(page.getByLabel('大盲', { exact: true })).toHaveValue('200')
  await expect(page.getByLabel('預設籌碼')).toHaveValue('20,000')
  await page.getByLabel('座位 5 籌碼').fill('24000')
  await page.getByLabel('座位 6 籌碼').fill('17100')
  await page.getByRole('radio', { name: '座位 4 按鈕' }).check()
  await page.getByRole('radio', { name: '座位 4 你' }).check()
  await pickCards(page, slotButton(page.getByTestId('setup-hero-cards'), '你的手牌', 1), ['As', 'Ks'])
  await handBar(page).getByRole('button', { name: '開始翻前' }).click()
}

/** 7.9 翻前到翻牌開始 */
export async function preflop79(page: Page): Promise<void> {
  await expect(page.getByTestId('to-act')).toHaveText('輪到 UTG（座位 1）· 剩 $20,000')
  await actionButton(page, '棄牌').click()
  await actionButton(page, '棄牌').click()
  await actionButton(page, '棄牌').click()
  await expect(page.getByTestId('to-act')).toHaveText('輪到 你 BTN（座位 4）· 剩 $20,000')
  await betTo(page, '加注', '500')
  await actionButton(page, '棄牌').click()
  await actionButton(page, '跟注 $300').click()
}

