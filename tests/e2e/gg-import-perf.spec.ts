import { expect, test, type Page } from '@playwright/test'
import { chooseImportFiles, ggTxt, importSummary, openImportFromList } from './helpers/ggImport'
import { DB_NAME } from './helpers/idb'
import { heading, seed } from './helpers/sessions'

// SPEC-v2-hands 11.1、12.3 H4：GG 匯入 10,000 手——解析 ≤ 20 秒（期間進度持續更新、畫面可回應）、寫入 ≤ 10 秒。
// fixture 由 8.8 範例複製並改變編號產生（非真實檔案，待以真實 PokerCraft 匯出驗證，HQ15）。
// 規格的量測環境為桌機 Chrome；本專案 E2E 只安裝 WebKit（iPhone 14 viewport），在同一環境以規格的絕對門檻量測。
// 這個 spec 在 playwright.config.ts 的效能 project，其他測試全部跑完才執行（避免平行測試搶 CPU）。
const HAND_COUNT = 10_000
const PARSE_LIMIT_MS = 20_000
const WRITE_LIMIT_MS = 10_000
/** 進度更新的最大間隔：每批 200 手後讓出主執行緒並更新進度（8.2），任兩次更新間隔不超過此值 */
const PROGRESS_GAP_LIMIT_MS = 2_000
/** 解析期間主執行緒最長的一段不回應時間（requestAnimationFrame 間隔），超過即視為畫面凍結 */
const FRAME_GAP_LIMIT_MS = 1_000

test.describe.configure({ mode: 'serial' })
test.use({ trace: 'off' })

async function countHands(page: Page): Promise<number> {
  return page.evaluate(
    (dbName) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const c = db.transaction('hands').objectStore('hands').count()
          c.onsuccess = () => {
            db.close()
            resolve(c.result)
          }
          c.onerror = () => reject(c.error)
        }
      }),
    DB_NAME,
  )
}

test(`11.1 GG 匯入 ${HAND_COUNT.toLocaleString('en-US')} 手：解析 ≤ 20 秒且進度持續更新、畫面可回應；寫入 ≤ 10 秒`, async ({ page }) => {
  test.setTimeout(180_000)
  await seed(page)
  await openImportFromList(page)
  const file = ggTxt('gg-10000.txt', HAND_COUNT)

  // 記錄進度文字每次變化的時間與 requestAnimationFrame 間隔（畫面是否持續回應）
  await page.evaluate(() => {
    const w = window as unknown as { __perf: { updates: number[]; texts: string[]; maxFrameGap: number; running: boolean } }
    w.__perf = { updates: [], texts: [], maxFrameGap: 0, running: true }
    const observer = new MutationObserver(() => {
      const el = document.querySelector('[data-testid="import-progress"]')
      const text = el?.textContent ?? ''
      if (text && text !== w.__perf.texts[w.__perf.texts.length - 1]) {
        w.__perf.texts.push(text)
        w.__perf.updates.push(performance.now())
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    let last = performance.now()
    const tick = (now: number) => {
      if (w.__perf.texts.length > 0) w.__perf.maxFrameGap = Math.max(w.__perf.maxFrameGap, now - last)
      last = now
      if (w.__perf.running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const parseStart = Date.now()
  await chooseImportFiles(page, [file])
  await expect(importSummary(page)).toHaveText('可匯入 10,000 手 · 重複略過 0 手 · 無法匯入 0 手', { timeout: 60_000 })
  const parseMs = Date.now() - parseStart
  const perf = await page.evaluate(() => {
    const w = window as unknown as { __perf: { updates: number[]; texts: string[]; maxFrameGap: number; running: boolean } }
    w.__perf.running = false
    const gaps = w.__perf.updates.slice(1).map((t, i) => t - w.__perf.updates[i]!)
    return { updates: w.__perf.texts.length, first: w.__perf.texts[0], last: w.__perf.texts[w.__perf.texts.length - 1], maxGap: Math.max(0, ...gaps), maxFrameGap: w.__perf.maxFrameGap }
  })

  const writeStart = Date.now()
  await page.getByRole('button', { name: '匯入 10,000 手' }).click()
  await expect(page.getByTestId('global-toast-text')).toHaveText('已匯入 10,000 手', { timeout: 60_000 })
  const writeMs = Date.now() - writeStart
  await expect(heading(page)).toHaveText('手牌')
  expect(await countHands(page)).toBe(HAND_COUNT)

  test.info().annotations.push({
    type: 'GG 匯入效能',
    description: `解析 ${parseMs}ms（門檻 ${PARSE_LIMIT_MS}）、寫入 ${writeMs}ms（門檻 ${WRITE_LIMIT_MS}）；進度更新 ${perf.updates} 次（${perf.first} → ${perf.last}），最大間隔 ${Math.round(perf.maxGap)}ms；解析期間最長 frame 間隔 ${Math.round(perf.maxFrameGap)}ms`,
  })
  console.log(`[gg-import-perf] parse=${parseMs}ms write=${writeMs}ms updates=${perf.updates} maxProgressGap=${Math.round(perf.maxGap)}ms maxFrameGap=${Math.round(perf.maxFrameGap)}ms`)

  expect(parseMs).toBeLessThanOrEqual(PARSE_LIMIT_MS)
  expect(writeMs).toBeLessThanOrEqual(WRITE_LIMIT_MS)
  // 10,000 手 / 每批 200 手 = 50 批：進度至少更新 25 次，且間隔不過長
  expect(perf.updates).toBeGreaterThanOrEqual(25)
  expect(perf.last).toBe('解析中 10,000 / 10,000 手')
  expect(perf.maxGap).toBeLessThanOrEqual(PROGRESS_GAP_LIMIT_MS)
  expect(perf.maxFrameGap).toBeLessThanOrEqual(FRAME_GAP_LIMIT_MS)
})
