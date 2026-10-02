import { expect, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { ggExampleFile } from '../../unit/helpers/ggText'
import { heading } from './sessions'

// H4 GG 匯入 E2E 的操作捷徑與測試檔案。所有 GG 原文都是非真實檔案（依規格 8.8 範例改編號產生），
// 待以真實 PokerCraft 匯出驗證（14 節 HQ15）；zip 在測試中以 fflate 動態產生。

export type UploadFile = { name: string; mimeType: string; buffer: Buffer }

export const txtFile = (name: string, text: string): UploadFile => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') })
export const zipFile = (name: string, data: Uint8Array): UploadFile => ({ name, mimeType: 'application/zip', buffer: Buffer.from(data) })

/** n 手 8.8 範例（編號 RC<start>…）的 .txt */
export const ggTxt = (name: string, n: number, start = 1_000_000_001) => txtFile(name, ggExampleFile(n, start))

/** 8.1 zip fixture：2 個 .txt（2 手 + 3 手）、1 個 .csv、1 個 __MACOSX/ 項目，只處理 2 個 .txt */
export function fixtureZip(): UploadFile {
  return zipFile(
    'PokerCraft.zip',
    zipSync({
      'hands-1.txt': strToU8(ggExampleFile(2, 1_000_000_001)),
      'folder/hands-2.txt': strToU8(ggExampleFile(3, 1_000_000_101)),
      'summary.csv': strToU8(ggExampleFile(1, 1_000_000_201)),
      '__MACOSX/._hands-1.txt': strToU8(ggExampleFile(1, 1_000_000_301)),
    }),
  )
}

/** 解壓後超過 50 MB 的 zip（內容可高度壓縮，檔案本身很小） */
export function oversizedZip(): UploadFile {
  return zipFile('big.zip', zipSync({ 'big.txt': new Uint8Array(50 * 1024 * 1024 + 1) }, { level: 1 }))
}

/** 項目數 1,001 個的 zip */
export function tooManyEntriesZip(): UploadFile {
  return zipFile('many.zip', zipSync(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`f${i}.csv`, strToU8('x')]))))
}

export const brokenZip = (): UploadFile => txtFileAs('broken.zip', 'application/zip', 'this is not a zip file')
const txtFileAs = (name: string, mimeType: string, text: string): UploadFile => ({ name, mimeType, buffer: Buffer.from(text, 'utf8') })

export const importInput = (page: Page) => page.getByTestId('import-file-input')
export const importSummary = (page: Page) => page.getByTestId('import-summary')

/** 從分頁列「手牌」→ 右上角「匯入」進入匯入頁 */
export async function openImportFromList(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: '主要分頁' }).getByRole('link', { name: '手牌' }).click()
  await expect(heading(page)).toHaveText('手牌')
  await page.getByRole('link', { name: '匯入 GG 手牌' }).first().click()
  await expect(heading(page)).toHaveText('匯入 GG 手牌')
  // 匯入頁為獨立 chunk：等載入完成（「選擇檔案」出現）
  await expect(page.getByRole('button', { name: '選擇檔案' })).toBeVisible()
}

export async function chooseImportFiles(page: Page, files: UploadFile[]): Promise<void> {
  await importInput(page).setInputFiles(files)
}

/**
 * 模擬匯入寫入失敗：匯入在 Web Worker 寫入（ggImport.worker），替換 Worker 建構子，先在 Worker 內讓 hands 表的
 * 第 3 次 add / put 丟出錯誤，再載入原本的 Worker 模組（App 程式碼不含任何測試用分支）。須在 page.goto 之前呼叫。
 */
export async function failThirdHandWrite(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Original = window.Worker
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        const href = new URL(String(url), location.href).href
        if (!href.includes('ggImport.worker')) {
          super(url, options)
          return
        }
        const src = `
          const queue = []
          self.onmessage = (e) => queue.push(e)
          let n = 0
          for (const m of ['add', 'put']) {
            const orig = IDBObjectStore.prototype[m]
            IDBObjectStore.prototype[m] = function (...args) {
              if (this.name === 'hands' && ++n === 3) throw new DOMException('injected', 'QuotaExceededError')
              return orig.apply(this, args)
            }
          }
          await import(${JSON.stringify(href)})
          for (const e of queue) self.onmessage(e)
        `
        super(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' })
      }
    }
  })
}
