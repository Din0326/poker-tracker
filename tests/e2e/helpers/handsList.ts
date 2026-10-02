import { expect, type Page } from '@playwright/test'
import { generateHandSeedData } from '../../../src/dev/handSeed'
import type { Hand } from '../../../src/domain/hands'
import { putRecords } from './idb'
import { heading, nav } from './sessions'

// H2 手牌列表 / 詳情 E2E 的操作捷徑

export const handRows = (page: Page) => page.getByTestId('hand-row')
export const handSummary = (page: Page) => page.getByTestId('hand-list-summary')

/** 以分頁列「手牌」進入手牌列表並等資料出現 */
export async function openHands(page: Page): Promise<void> {
  await nav(page).getByRole('link', { name: '手牌' }).click()
  await expect(heading(page)).toHaveText('手牌')
  await expect(handSummary(page).or(page.getByText('還沒有手牌紀錄'))).toBeVisible()
}

export async function handRowIds(page: Page): Promise<string[]> {
  return handRows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-hand-id') ?? ''))
}

/** 點列表中的某一手進入詳情 */
export async function openHandDetail(page: Page, id: string): Promise<void> {
  await page.locator(`[data-hand-id="${id}"]`).first().click()
  await expect(heading(page)).toHaveText('手牌詳情')
  await expect(page.getByTestId('detail-result')).toBeVisible()
}

/** 開發用 seed 產生的手牌（固定種子），分段寫入 IndexedDB */
export async function seedGeneratedHands(page: Page, count: number, extra: Partial<Parameters<typeof generateHandSeedData>[0]> = {}): Promise<Hand[]> {
  const hands = generateHandSeedData({ count, today: '2026-10-01', ...extra })
  for (let i = 0; i < hands.length; i += 1000) await putRecords(page, 'hands', hands.slice(i, i + 1000))
  return hands
}

export const handFilter = (page: Page, label: '紀錄類型' | '來源' | '位置' | '標籤' | '關聯場次') => page.getByRole('combobox', { name: label, exact: true })
