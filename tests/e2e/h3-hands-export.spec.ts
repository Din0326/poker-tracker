import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'
import { exportPokerStars, type Hand } from '../../src/domain/hands'
import { H_79, H_GG, H_MEMO, H_SIDE, fixtureHands } from './helpers/hands'
import { handFilter, openHandDetail, openHands } from './helpers/handsList'
import { putRecords, readStore } from './helpers/idb'
import { fixture, heading, nav, seed } from './helpers/sessions'

// SPEC-v2-hands 12.3 H3 匯出的 E2E：從列表與詳情匯出（桌機下載路徑：WebKit headless 不支援分享檔案，canShare 為 false 或不存在）、
// 下載的檔名符合 7.2、內容與 fixture（7.9 預期輸出全文）逐字元相同；查看匯出文字；設定頁匯出名稱生效。
// 單元與元件測試見 tests/unit/hands-export.test.ts、hands-parse.test.ts、tests/component/hand-export.test.tsx

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'hands', 'export-example-1.txt')

/** 7.9 範例的 playedAt 為 2026-09-30 21:15；fixtureHands 的 7.9 手牌改成相同時間，匯出內容即與 fixture 相同 */
function handsFor79(): Hand[] {
  return fixtureHands().map((h) => (h.id === H_79 ? { ...h, playedAt: '2026-09-30T21:15:00' } : h))
}

async function seedHands(page: Page): Promise<Hand[]> {
  await seed(page)
  const hands = handsFor79()
  await putRecords(page, 'hands', hands)
  return hands
}

const exportSheet = (page: Page) => page.getByRole('dialog', { name: '匯出手牌' })
const listExportButton = (page: Page) => page.getByRole('button', { name: '匯出目前篩選結果的完整手牌' })

/** WebKit headless 不支援分享檔案：匯出走 Blob 下載（規格 7.1、v1 8.4） */
async function expectNoFileShare(page: Page): Promise<void> {
  const canShareFiles = await page.evaluate(() => {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    try {
      return typeof nav.share === 'function' && nav.canShare?.({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }) === true
    } catch {
      return false
    }
  })
  expect(canShareFiles).toBe(false)
}

async function shareAndDownload(page: Page): Promise<{ download: Download; body: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), exportSheet(page).getByRole('button', { name: '分享 / 下載' }).click()])
  const body = await readFile(await download.path(), 'utf8')
  return { download, body }
}

test.describe('12.3 H3 匯出（第 7 節）', () => {
  test('12.3 H3 從手牌列表匯出：sheet 顯示手數、略過的簡易手牌與 GTO Wizard 提示；桌機下載的檔名符合 7.2，內容為篩選結果中的完整手牌', async ({ page }) => {
    const hands = await seedHands(page)
    await openHands(page)
    await expectNoFileShare(page)
    const button = listExportButton(page)
    await expect(button).toHaveText('匯出')
    const box = (await button.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)

    await button.click()
    const sheet = exportSheet(page)
    await expect(sheet.getByTestId('export-count')).toHaveText('將匯出 3 手完整手牌')
    await expect(sheet.getByTestId('export-skipped')).toHaveText('簡易手牌 2 手無法匯出，已略過')
    // 三人邊池（3-max 現金桌）不在 7.8 支援格式內
    await expect(sheet.getByTestId('export-gto-hint')).toHaveText('其中 1 手的牌局格式（例如 9 人桌現金桌）GTO Wizard 可能無法分析，仍會一併匯出')

    const before = await readStore(page, 'hands')
    const { download, body } = await shareAndDownload(page)
    expect(download.suggestedFilename()).toMatch(/^poker-hands-\d{8}-\d{4}\.txt$/)
    // 7.1：依 playedAt 由舊到新；7.2：手牌間 2 個空行、\n 結尾、無 BOM
    const complete = hands.filter((h) => h.kind === 'complete')
    expect(body).toBe(exportPokerStars(complete))
    expect(body.split('\n\n\n').map((t) => t.split('\n')[0]!.slice(0, 35))).toEqual([
      'PokerStars Hand #7700000000000006: ',
      'PokerStars Hand #7700000000000005: ',
      'PokerStars Hand #7700000000000001: ',
    ])
    expect(body.charCodeAt(0)).not.toBe(0xfeff)
    await expect(exportSheet(page)).toHaveCount(0)
    await expect(page.getByTestId('global-toast-text')).toHaveText('已匯出 3 手')
    // 匯出不改變任何資料
    expect(await readStore(page, 'hands')).toEqual(before)
  })

  test('12.3 H3 列表匯出的範圍為目前篩選結果：場次篩選只含該場的完整手牌，內容與 fixture 相同', async ({ page }) => {
    await seedHands(page)
    await page.goto(`./#/hands?sessionId=${fixture.c1.id}`)
    await expect(page.getByTestId('hand-list-summary')).toHaveText('共 2 手（完整 1 手）')
    await listExportButton(page).click()
    await expect(exportSheet(page).getByTestId('export-count')).toHaveText('將匯出 1 手完整手牌')
    await expect(exportSheet(page).getByTestId('export-skipped')).toHaveText('簡易手牌 1 手無法匯出，已略過')
    await expect(exportSheet(page).getByTestId('export-gto-hint')).toHaveCount(0)
    const { body } = await shareAndDownload(page)
    expect(body).toBe(await readFile(FIXTURE, 'utf8'))
  })

  test('12.3 H3 篩選結果只有簡易手牌：「沒有可匯出的完整手牌」，不顯示匯出按鈕', async ({ page }) => {
    await seedHands(page)
    await openHands(page)
    await handFilter(page, '紀錄類型').selectOption({ label: '簡易' })
    await expect(page.getByTestId('hand-list-summary')).toHaveText('共 2 手（完整 0 手）')
    await listExportButton(page).click()
    await expect(exportSheet(page).getByTestId('export-none')).toHaveText('沒有可匯出的完整手牌')
    await expect(exportSheet(page).getByRole('button', { name: '分享 / 下載' })).toHaveCount(0)
    await exportSheet(page).getByRole('button', { name: '取消' }).click()
    await expect(exportSheet(page)).toHaveCount(0)
  })

  test('12.3 H3 從手牌詳情「匯出這手」：檔名 poker-hand-<匯出編號>.txt，內容與 fixture export-example-1.txt 逐字元相同', async ({ page }) => {
    await seedHands(page)
    await openHands(page)
    await expectNoFileShare(page)
    await openHandDetail(page, H_79)
    await page.getByRole('button', { name: '匯出這手' }).click()
    await expect(exportSheet(page).getByTestId('export-count')).toHaveText('將匯出 1 手完整手牌')
    await expect(exportSheet(page).getByTestId('export-skipped')).toHaveCount(0)
    const { download, body } = await shareAndDownload(page)
    expect(download.suggestedFilename()).toBe('poker-hand-7700000000000001.txt')
    expect(body).toBe(await readFile(FIXTURE, 'utf8'))
  })

  test('12.3 H3 查看匯出文字：bottom sheet 以等寬字型顯示這手的 PokerStars 文字（與 fixture 相同），可捲動、有「複製」按鈕', async ({ page }) => {
    await seedHands(page)
    await openHands(page)
    await openHandDetail(page, H_79)
    await page.getByRole('button', { name: '查看匯出文字' }).click()
    const sheet = page.getByRole('dialog', { name: '匯出文字' })
    const text = sheet.getByTestId('export-text')
    await expect(text).toBeVisible()
    expect(await text.textContent()).toBe(await readFile(FIXTURE, 'utf8'))
    const style = await text.evaluate((el) => {
      const s = getComputedStyle(el)
      return { font: s.fontFamily, overflowX: s.overflowX, overflowY: s.overflowY, scrollable: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight }
    })
    expect(style.font).toMatch(/mono/i)
    expect(style.overflowX).toBe('auto')
    expect(style.overflowY).toBe('auto')
    expect(style.scrollable).toBe(true)
    const copy = sheet.getByRole('button', { name: '複製' })
    const box = (await copy.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    await sheet.getByRole('button', { name: '關閉' }).click()
    await expect(sheet).toHaveCount(0)
  })

  test('12.3 H3 簡易手牌的詳情沒有「匯出這手」「查看匯出文字」；GG 完整手牌有', async ({ page }) => {
    await seedHands(page)
    await openHands(page)
    await openHandDetail(page, H_MEMO)
    await expect(page.getByRole('button', { name: '匯出這手' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '查看匯出文字' })).toHaveCount(0)
    await page.goto(`./#/hands/${H_GG}`)
    await expect(page.getByRole('button', { name: '匯出這手' })).toBeVisible()
    await page.getByRole('button', { name: '查看匯出文字' }).click()
    // GG 手牌（分單位）：整手 2 位小數
    await expect(page.getByTestId('export-text')).toContainText("Hold'em No Limit ($1.00/$2.00) - 2026/09/20 22:05:13")
  })

  test('12.3 H3 三人邊池的詳情「匯出這手」顯示 GTO Wizard 提示，仍可匯出', async ({ page }) => {
    await seedHands(page)
    await page.goto(`./#/hands/${H_SIDE}`)
    await page.getByRole('button', { name: '匯出這手' }).click()
    await expect(exportSheet(page).getByTestId('export-gto-hint')).toContainText('其中 1 手的牌局格式')
    const { download, body } = await shareAndDownload(page)
    expect(download.suggestedFilename()).toBe('poker-hand-7700000000000005.txt')
    expect(body).toContain('Total pot $7000 Main pot $2700. Side pot $4000. | Rake $300')
  })

  test('HC16 設定頁儲存匯出名稱後，匯出與查看匯出文字使用新名稱', async ({ page }) => {
    await seedHands(page)
    await nav(page).getByRole('link', { name: '設定' }).click()
    await page.getByLabel('匯出名稱').fill('Din_0326')
    await page.getByRole('region', { name: '手牌' }).getByRole('button', { name: '儲存' }).click()
    await expect(page.getByTestId('global-toast-text')).toHaveText('已儲存匯出名稱')
    await openHands(page)
    await openHandDetail(page, H_79)
    await page.getByRole('button', { name: '查看匯出文字' }).click()
    await expect(page.getByTestId('export-text')).toContainText('Dealt to Din_0326 [As Ks]')
    await page.getByRole('dialog', { name: '匯出文字' }).getByRole('button', { name: '關閉' }).click()
    await page.getByRole('button', { name: '匯出這手' }).click()
    const { body } = await shareAndDownload(page)
    expect(body).toBe((await readFile(FIXTURE, 'utf8')).replaceAll('Hero', 'Din_0326'))
    await expect(heading(page)).toHaveText('手牌詳情')
  })
})
