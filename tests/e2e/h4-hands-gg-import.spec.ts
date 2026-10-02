import { expect, test, type Page } from '@playwright/test'
import type { Hand } from '../../src/domain/hands'
import { ggExample, ggExampleFile, withHandId } from '../unit/helpers/ggText'
import {
  brokenZip,
  chooseImportFiles,
  fixtureZip,
  ggTxt,
  importSummary,
  openImportFromList,
  oversizedZip,
  tooManyEntriesZip,
  txtFile,
} from './helpers/ggImport'
import { handRows, handSummary, openHandDetail } from './helpers/handsList'
import { readSettings, readStore } from './helpers/idb'
import { freezeParsingAfterTwoBatches } from './helpers/screenStates'
import { fixture, hashPath, heading, nav, seed } from './helpers/sessions'

// SPEC-v2-hands 12.3 H4 GG 匯入（實驗功能）的 E2E：入口、.txt 單檔 / 多檔 / .zip、8.1 限制、進度與取消、
// 寫入失敗整批還原、關聯場次、HC21、實驗功能標示與原始文字。
// 所有 GG 原文都是非真實檔案（依 8.8 範例改編號產生），待以真實 PokerCraft 匯出驗證（14 節 HQ15）。
// 單元與元件測試見 tests/unit/hands-gg-parse.test.ts、hands-gg-import.test.ts、tests/component/hand-import.test.tsx；
// 10,000 手效能見 tests/e2e/gg-import-perf.spec.ts

const toast = (page: Page) => page.getByTestId('global-toast-text')

async function openImport(page: Page): Promise<void> {
  await seed(page)
  await openImportFromList(page)
}

async function importAndWait(page: Page, summary: string, count: number): Promise<void> {
  await expect(importSummary(page)).toHaveText(summary)
  await page.getByRole('button', { name: `匯入 ${count} 手` }).click()
  await expect(heading(page)).toHaveText('手牌')
}

const ggHands = async (page: Page) => (await readStore<Hand>(page, 'hands')).filter((h) => h.source === 'gg')

test.describe('12.3 H4 匯入入口與實驗功能標示', () => {
  test('12.3 H4 入口：手牌列表右上角「匯入」、空狀態「匯入 GG 手牌」、設定頁「匯入 GG 手牌（實驗功能）」；匯入頁顯示「實驗功能」標示', async ({ page }) => {
    await seed(page)
    await nav(page).getByRole('link', { name: '手牌' }).click()
    await expect(page.getByText('還沒有手牌紀錄')).toBeVisible()
    // 空狀態按鈕
    await page.getByRole('main').getByRole('link', { name: '匯入 GG 手牌' }).click()
    await expect(heading(page)).toHaveText('匯入 GG 手牌')
    expect(hashPath(page)).toBe('/hands/import')
    await expect(page.getByTestId('experimental-badge')).toHaveText('實驗功能')
    await expect(page.getByTestId('import-intro')).toHaveText('GG 手牌格式依公開資料撰寫，尚未以真實檔案驗證。不支援的手牌會略過並說明原因，匯入後請抽查結果。')
    // 「手牌」頁籤為作用中（5.1）
    await expect(nav(page).getByRole('link', { name: '手牌' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(heading(page)).toHaveText('手牌')

    // 右上角「匯入」：觸控區 ≥ 44×44（9.2）
    const headerImport = page.getByRole('banner').getByRole('link', { name: '匯入 GG 手牌' })
    await expect(headerImport).toHaveText('匯入')
    const box = (await headerImport.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await headerImport.click()
    expect(hashPath(page)).toBe('/hands/import')

    // 設定頁入口
    await nav(page).getByRole('link', { name: '設定' }).click()
    await page.getByRole('link', { name: '匯入 GG 手牌（實驗功能）' }).click()
    await expect(heading(page)).toHaveText('匯入 GG 手牌')
    // 375px 寬沒有橫向捲動
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test.describe('12.3 H4 匯入 .txt 單檔、多檔、.zip（8.1、8.2）', () => {
  test('12.3 H4 .txt 單檔：預覽 → 匯入 → 前往手牌列表（篩選來源 = GG），DB 內容符合 8.3', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [ggTxt('gg.txt', 3)])
    await importAndWait(page, '可匯入 3 手 · 重複略過 0 手 · 無法匯入 0 手', 3)
    await expect(toast(page)).toHaveText('已匯入 3 手')
    await expect(page.getByRole('combobox', { name: '來源', exact: true })).toHaveValue('gg')
    await expect(handSummary(page)).toHaveText('共 3 手（完整 3 手）')
    await expect(handRows(page).first().getByTestId('row-badge')).toHaveText(['GG'])
    const hands = await ggHands(page)
    expect(hands.map((h) => h.sourceHandId).sort()).toEqual(['RC1000000001', 'RC1000000002', 'RC1000000003'])
    for (const h of hands) {
      expect(h).toMatchObject({ source: 'gg', gameType: 'cash', amountUnit: 'cent', kind: 'complete', parserVersion: 1, sessionId: null, tags: [], note: null, playedAt: '2026-09-20T22:05:13', heroNet: 356 })
      expect(h.rawText).toBe(withHandId(ggExample().trimEnd(), h.sourceHandId!))
    }
    // exportSeq 與 lastHandSeq（7.4）
    expect(hands.map((h) => h.exportSeq).sort()).toEqual([1, 2, 3])
    expect((await readSettings(page)).lastHandSeq).toBe(3)
  })

  test('12.3 H4 .txt 多檔：一次選兩個檔案，兩個檔案的手牌都匯入', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [ggTxt('a.txt', 2, 1), ggTxt('b.txt', 2, 101)])
    await importAndWait(page, '可匯入 4 手 · 重複略過 0 手 · 無法匯入 0 手', 4)
    expect((await ggHands(page)).map((h) => h.sourceHandId).sort()).toEqual(['RC1', 'RC101', 'RC102', 'RC2'])
  })

  test('12.3 H4 .zip：fixture 內含 2 個 .txt、1 個 .csv、1 個 __MACOSX/ 項目，只處理 2 個 .txt', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [fixtureZip()])
    await importAndWait(page, '可匯入 5 手 · 重複略過 0 手 · 無法匯入 0 手', 5)
    expect((await ggHands(page)).map((h) => h.sourceHandId).sort()).toEqual(['RC1000000001', 'RC1000000002', 'RC1000000101', 'RC1000000102', 'RC1000000103'])
  })

  test('8.2 無法匯入：依原因分組計數，可展開前 20 筆明細（原站手牌編號與原因）；其他手牌照常匯入', async ({ page }) => {
    await openImport(page)
    const base = ggExample().trimEnd()
    const text = [
      withHandId(base, 'RC1'),
      withHandId(base.replace('Total pot $7.75', 'Total pot $7.8'), 'RC2'),
      withHandId(base, 'TM3'),
      withHandId(base.replace('*** FLOP ***', 'Hero: says hi\n*** FLOP ***'), 'RC4'),
    ].join('\n\n\n')
    await chooseImportFiles(page, [txtFile('mixed.txt', text)])
    await expect(importSummary(page)).toHaveText('可匯入 1 手 · 重複略過 0 手 · 無法匯入 3 手')
    await expect(page.getByTestId('import-reject-reason')).toHaveText(['底池金額對不上：1 手', '錦標賽手牌暫不支援匯入：1 手', '無法辨識的內容：1 手'])
    await page.getByText('查看前 1 筆明細').last().click()
    await expect(page.getByTestId('import-reject-sample').last()).toHaveText('RC4 · 無法辨識的內容：第 25 行')
    await importAndWait(page, '可匯入 1 手 · 重複略過 0 手 · 無法匯入 3 手', 1)
    expect((await ggHands(page)).map((h) => h.sourceHandId)).toEqual(['RC1'])
  })
})

test.describe('12.3 H4 8.1 的限制（50 MB、1,000 個項目、解壓失敗）', () => {
  test('12.3 H4 50 MB：zip 解壓後超過 50 MB → 「檔案太大，一次最多 50 MB，請分批匯入」並停止', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [oversizedZip()])
    await expect(page.getByTestId('import-error')).toHaveText('檔案太大，一次最多 50 MB，請分批匯入')
    await expect(page.getByRole('button', { name: '重新選擇檔案' })).toBeVisible()
    expect(await ggHands(page)).toEqual([])
  })

  test('12.3 H4 1,000 個項目：壓縮檔內項目數 > 1,000 →「壓縮檔內的檔案太多（最多 1,000 個）」', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [tooManyEntriesZip()])
    await expect(page.getByTestId('import-error')).toHaveText('壓縮檔內的檔案太多（最多 1,000 個）')
  })

  test('12.3 H4 解壓失敗：「無法解壓縮這個檔案」，重新選擇檔案後可正常匯入', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [brokenZip()])
    await expect(page.getByTestId('import-error')).toHaveText('無法解壓縮這個檔案')
    await chooseImportFiles(page, [ggTxt('gg.txt', 1)])
    await importAndWait(page, '可匯入 1 手 · 重複略過 0 手 · 無法匯入 0 手', 1)
  })
})

test.describe('12.3 H4 解析進度、取消、寫入失敗整批還原（8.2）', () => {
  test('12.3 H4 解析進度更新、可取消且取消後不寫入任何手牌', async ({ page }) => {
    // 讓解析在第 2 批之後停住（scheduler.yield 不再 resolve），確定在解析進行中按「取消」；
    // 真實讓出主執行緒時的進度更新頻率與畫面回應見 gg-import-perf.spec.ts（10,000 手）
    await freezeParsingAfterTwoBatches(page)
    await openImport(page)
    await page.evaluate(() => {
      const w = window as unknown as { __progress: string[] }
      w.__progress = []
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="import-progress"]')?.textContent
        if (text && text !== w.__progress[w.__progress.length - 1]) w.__progress.push(text)
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await chooseImportFiles(page, [ggTxt('gg.txt', 600)])
    const progress = page.getByTestId('import-progress')
    await expect(progress).toHaveText('解析中 400 / 600 手')
    // 每批 200 手後更新進度（8.2）
    expect(await page.evaluate(() => (window as unknown as { __progress: string[] }).__progress)).toEqual(['解析中 0 / 600 手', '解析中 200 / 600 手', '解析中 400 / 600 手'])
    const bar = page.getByRole('progressbar', { name: '解析進度' })
    await expect(bar).toHaveAttribute('aria-valuenow', '400')
    await expect(bar).toHaveAttribute('aria-valuemax', '600')
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByTestId('import-status')).toHaveText('已取消，沒有寫入任何手牌')
    await expect(progress).toHaveCount(0)
    await expect(importSummary(page)).toHaveCount(0)
    expect(await ggHands(page)).toEqual([])
    expect((await readSettings(page)).lastHandSeq).toBeUndefined()
  })

  test('12.3 H4 寫入失敗整批還原：寫入第 3 手時模擬 IndexedDB 錯誤 → 「匯入失敗，沒有任何手牌被寫入」，DB 沒有任何手牌', async ({ page }) => {
    // 匯入在 Web Worker 寫入（ggImport.worker）：替換 Worker 建構子，先在 Worker 內讓 hands 表的第 3 次 add / put 丟出錯誤，
    // 再載入原本的 Worker 模組（App 程式碼不含任何測試用分支）
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
    await openImport(page)
    await chooseImportFiles(page, [ggTxt('gg.txt', 5)])
    await expect(importSummary(page)).toHaveText('可匯入 5 手 · 重複略過 0 手 · 無法匯入 0 手')
    await page.getByRole('button', { name: '匯入 5 手' }).click()
    await expect(page.getByRole('alert')).toHaveText('匯入失敗，沒有任何手牌被寫入')
    await expect(heading(page)).toHaveText('匯入 GG 手牌')
    expect(await ggHands(page)).toEqual([])
    expect((await readSettings(page)).lastHandSeq).toBeUndefined()
  })
})

test.describe('12.3 H4 匯入時選擇關聯場次（8.2、HQ20）', () => {
  test('12.3 H4 關聯場次只列現金桌場次；選一個現金桌場次後所有匯入手牌的 sessionId 都是該場', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [ggTxt('gg.txt', 3)])
    await expect(importSummary(page)).toHaveText('可匯入 3 手 · 重複略過 0 手 · 無法匯入 0 手')
    const select = page.getByLabel('關聯場次')
    await expect(select).toHaveValue('')
    const values = await select.locator('option').evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value))
    const cashIds = Object.values(fixture).filter((s) => s.type === 'cash').map((s) => s.id)
    const otherIds = Object.values(fixture).filter((s) => s.type !== 'cash').map((s) => s.id)
    for (const id of cashIds) expect(values).toContain(id)
    for (const id of otherIds) expect(values).not.toContain(id)
    await select.selectOption(fixture.c1.id)
    await importAndWait(page, '可匯入 3 手 · 重複略過 0 手 · 無法匯入 0 手', 3)
    const hands = await ggHands(page)
    expect(hands).toHaveLength(3)
    expect(hands.every((h) => h.sessionId === fixture.c1.id)).toBe(true)
  })
})

test.describe('HC21 重複匯入（8.6）', () => {
  test('HC21 同一檔案匯入兩次：第二次「可匯入 0 手 · 重複略過 N 手」，只顯示返回；同一次選兩個相同檔案：第二份全數計為重複', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [ggTxt('a.txt', 3), ggTxt('a-copy.txt', 3)])
    await importAndWait(page, '可匯入 3 手 · 重複略過 3 手 · 無法匯入 0 手', 3)
    await openImportFromList(page)
    await chooseImportFiles(page, [ggTxt('a.txt', 3)])
    await expect(importSummary(page)).toHaveText('可匯入 0 手 · 重複略過 3 手 · 無法匯入 0 手')
    await expect(page.getByRole('button', { name: /^匯入 \d/ })).toHaveCount(0)
    await page.getByRole('main').getByRole('button', { name: '返回' }).click()
    await expect(heading(page)).toHaveText('手牌')
    expect(await ggHands(page)).toHaveLength(3)
  })
})

test.describe('12.3 H4 匯入手牌詳情（6.2）', () => {
  test('12.3 H4 匯入手牌詳情顯示「實驗」標示與原站手牌編號；「原始文字」顯示 rawText（等寬字型、可複製）', async ({ page }) => {
    await openImport(page)
    await chooseImportFiles(page, [txtFile('gg.txt', ggExampleFile(1))])
    await importAndWait(page, '可匯入 1 手 · 重複略過 0 手 · 無法匯入 0 手', 1)
    const [hand] = await ggHands(page)
    await openHandDetail(page, hand!.id)
    await expect(page.getByTestId('detail-badge')).toHaveText(['GG', '實驗'])
    await expect(page.getByTestId('detail-source-hand-id')).toHaveText('原站手牌編號 RC1000000001')
    await expect(page.getByTestId('detail-result')).toHaveText('+14.2 bb')
    await page.getByRole('button', { name: '原始文字' }).click()
    const dialog = page.getByRole('dialog', { name: '原始文字' })
    await expect(dialog.getByTestId('raw-text')).toHaveText(ggExample().trimEnd(), { useInnerText: true })
    expect(await dialog.getByTestId('raw-text').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i)
    await expect(dialog.getByRole('button', { name: '複製' })).toBeVisible()
    // 匯入的手牌編輯頁只能修改關聯場次、標籤、備註（5.8）
    await dialog.getByRole('button', { name: '關閉' }).click()
    await page.getByRole('link', { name: '編輯' }).click()
    await expect(page.getByText('匯入的手牌只能修改關聯場次、標籤與備註')).toBeVisible()
  })
})

test.describe('第 2 節、11.2 fflate 動態載入與離線快取', () => {
  // 封鎖 service worker，避免預先快取的請求混入量測（同 report.spec.ts 的 lazy chunk 測試）
  test.use({ serviceWorkers: 'block' })
  test('第 2 節 fflate 只在匯入頁選了 .zip 時才載入：首頁與主 chunk 不含 fflate；匯入頁與 fflate 的 chunk 都在 service worker 預先快取清單內', async ({ page }) => {
    // fflate 的錯誤訊息字串，用來辨識含 fflate 程式碼的 chunk
    const FFLATE_MARK = 'invalid zip data'
    const scripts: { path: string; hasFflate: boolean }[] = []
    page.on('response', async (r) => {
      if (r.request().resourceType() !== 'script') return
      const body = await r.text().catch(() => '')
      scripts.push({ path: new URL(r.url()).pathname, hasFflate: body.includes(FFLATE_MARK) })
    })
    await seed(page)
    await expect(heading(page)).toHaveText('新增場次')
    expect(scripts.length).toBeGreaterThan(0)
    expect(scripts.filter((s) => s.hasFflate)).toEqual([])
    expect(scripts.some((s) => /HandImportPage/.test(s.path))).toBe(false)

    await openImportFromList(page)
    await expect.poll(() => scripts.some((s) => /HandImportPage/.test(s.path))).toBe(true)
    expect(scripts.filter((s) => s.hasFflate)).toEqual([])

    await chooseImportFiles(page, [fixtureZip()])
    await expect(importSummary(page)).toHaveText('可匯入 5 手 · 重複略過 0 手 · 無法匯入 0 手')
    await expect.poll(() => scripts.filter((s) => s.hasFflate).length).toBe(1)
    const fflateChunk = scripts.find((s) => s.hasFflate)!.path.split('/').pop()!
    const importChunk = scripts.find((s) => /HandImportPage/.test(s.path))!.path.split('/').pop()!

    // 11.2：建置產物（含 fflate、匯入頁與寫入用的 Worker）由 service worker 預先快取，離線可用
    const sw = await page.evaluate(() => fetch('sw.js').then((r) => r.text()))
    expect(sw).toContain(fflateChunk)
    expect(sw).toContain(importChunk)
    expect(sw).toMatch(/ggImport\.worker-[\w-]+\.js/)
  })
})
