import { expect, type Page } from '@playwright/test'

// 新增頁的操作捷徑

export async function openRecordPage(page: Page): Promise<void> {
  await page.goto('./')
  await expect(page.getByRole('button', { name: '儲存', exact: true })).toBeVisible()
}

export const saveButton = (page: Page) => page.getByRole('form').getByRole('button', { name: '儲存', exact: true })

export const typeButton = (page: Page, label: '現金桌' | 'MTT' | '限時 MTT') =>
  page.getByRole('group', { name: '類型' }).getByRole('button', { name: label, exact: true })

export const buyInInput = (page: Page, n: number) =>
  page.getByRole('textbox', { name: `第 ${n} 次 買入（含服務費）`, exact: true })

export const feeInput = (page: Page, n: number) => page.getByRole('textbox', { name: `第 ${n} 次 服務費`, exact: true })

export const dialog = (page: Page) => page.getByRole('dialog')

/** 以行內「＋ 新增盲注」新增盲注（沒有盲注時點擊「請先新增盲注」） */
export async function addStakeInline(page: Page, sb: string, bb: string, { expectClosed = true } = {}): Promise<void> {
  const empty = page.getByRole('button', { name: /請先新增盲注/ })
  if (await empty.isVisible()) await empty.click()
  else await page.getByLabel('盲注級別').selectOption({ label: '＋ 新增盲注' })
  const sheet = dialog(page)
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('小盲').fill(sb)
  await sheet.getByLabel('大盲').fill(bb)
  await sheet.getByRole('button', { name: '儲存' }).click()
  if (expectClosed) await expect(sheet).toHaveCount(0)
}

export async function addVenueInline(page: Page, name: string, { expectClosed = true } = {}): Promise<void> {
  await page.getByLabel('場地', { exact: true }).selectOption({ label: '＋ 新增場地' })
  const sheet = dialog(page)
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('場地名稱').fill(name)
  await sheet.getByRole('button', { name: '儲存' }).click()
  if (expectClosed) await expect(sheet).toHaveCount(0)
}

export async function setDuration(page: Page, hours: number, minutes: number): Promise<void> {
  await page.getByRole('combobox', { name: '時長（小時）' }).selectOption({ label: `${hours} 時` })
  await page.getByRole('combobox', { name: '時長（分鐘）' }).selectOption({ label: `${minutes} 分` })
}

export async function setStart(page: Page, date: string, hour: number): Promise<void> {
  await page.getByLabel('開始日期').fill(date)
  await page.getByRole('combobox', { name: '開始小時' }).selectOption(String(hour))
}
