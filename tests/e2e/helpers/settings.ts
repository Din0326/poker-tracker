import { readFile } from 'node:fs/promises'
import { expect, type Download, type Page } from '@playwright/test'
import { nav } from './sessions'

// P5 設定頁的操作捷徑

/** 以分頁列進入設定頁並等內容載入 */
export async function openSettings(page: Page): Promise<void> {
  await nav(page).getByRole('link', { name: '設定' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('設定')
  await expect(page.getByRole('heading', { level: 2, name: '資料備份' })).toBeVisible()
}

/**
 * 讓匯出走 Blob 下載路徑：移除 navigator.canShare（WebKit headless 的分享行為不固定）。
 * 必須在 page.goto 之前呼叫。
 */
export async function disableShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true })
  })
}

/** 點按鈕並取得下載的檔案 */
export async function clickAndDownload(page: Page, buttonName: string): Promise<{ download: Download; body: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: buttonName, exact: true }).click(),
  ])
  const path = await download.path()
  return { download, body: await readFile(path) }
}

/** 以設定頁的檔案選擇器選取檔案（隱藏的 input[type=file]） */
export async function chooseImportFile(page: Page, content: string | Buffer, name = 'backup.json'): Promise<void> {
  await page.getByTestId('import-file').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
  })
}

/** 清除所有資料：開啟面板、輸入「刪除」、確認 */
export async function clearAllData(page: Page): Promise<void> {
  await page.getByRole('button', { name: '清除所有資料', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '清除所有資料？' })
  await sheet.getByLabel('請輸入「刪除」以確認').fill('刪除')
  await sheet.getByRole('button', { name: '清除所有資料' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增場次')
}

/** 管理頁的列（依畫面順序的名稱） */
export const manageLabels = (page: Page, scope: 'active' | 'archived' = 'active') =>
  page.getByTestId(scope === 'archived' ? 'archived-list' : 'active-list').getByTestId('manage-label').allTextContents()

export const moreButton = (page: Page, label: string) => page.getByRole('button', { name: `更多操作：${label}`, exact: true })

/** 開啟某一列的操作面板 */
export async function openActions(page: Page, label: string) {
  await moreButton(page, label).click()
  const sheet = page.getByRole('dialog', { name: label })
  await expect(sheet).toBeVisible()
  return sheet
}

/** 簡易 RFC 4180 parser（引號內可含逗號、引號與換行；列以 CRLF 分隔） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
