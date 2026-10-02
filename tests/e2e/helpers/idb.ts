import type { Page } from '@playwright/test'

// 以原生 IndexedDB API 直接讀寫 App 的資料庫（poker-tracker），用來驗證 DB 內容或預先放入資料。
// 須在 App 已開啟過資料庫（進過新增頁）之後呼叫。

export const DB_NAME = 'poker-tracker'

export type StoreName = 'sessions' | 'venues' | 'stakes' | 'settings' | 'hands'

export async function readStore<T = Record<string, unknown>>(page: Page, store: StoreName): Promise<T[]> {
  return page.evaluate(
    async ({ dbName, store }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        return await new Promise<T[]>((resolve, reject) => {
          const req = db.transaction(store).objectStore(store).getAll()
          req.onsuccess = () => resolve(req.result as T[])
          req.onerror = () => reject(req.error)
        })
      } finally {
        db.close()
      }
    },
    { dbName: DB_NAME, store },
  )
}

/** settings 表轉成 key → value */
export async function readSettings(page: Page): Promise<Record<string, unknown>> {
  const rows = await readStore<{ key: string; value: unknown }>(page, 'settings')
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/**
 * 在單一 transaction 中批次 put。
 *
 * 寫入在頁面內的 Web Worker 執行：實測 headless WebKit（Windows）主執行緒上每個 IndexedDB request
 * 都要等約 15ms（與 setTimeout(1) 相同，是主執行緒 run loop 的計時器解析度；與資料大小、索引、
 * 是否同一 transaction、durability 都無關），1,000 筆就要 15 秒；同樣的寫入在 Worker 中 1,000 筆只要數十 ms。
 * Worker 與頁面同源，寫入的是同一個資料庫，App 端行為不受影響。
 * 若環境不能建立 Worker（例如 CSP 禁止 blob:），退回主執行緒寫入。
 */
export async function putRecords(page: Page, store: StoreName, records: unknown[]): Promise<void> {
  await page.evaluate(
    async ({ dbName, store, records }) => {
      // 與 Worker 內相同的寫入邏輯（Worker 版本以字串送入，見下方）
      const writeAll = async (dbName: string, store: string, records: unknown[]) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(dbName)
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            const os = tx.objectStore(store)
            for (const r of records) os.put(r)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error)
          })
        } finally {
          db.close()
        }
      }

      let worker: Worker
      let url: string
      try {
        const src = `const writeAll = ${writeAll.toString()};
          onmessage = async (e) => {
            try { await writeAll(e.data.dbName, e.data.store, e.data.records); postMessage({ ok: true }) }
            catch (err) { postMessage({ ok: false, error: String(err) }) }
          }`
        url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
        worker = new Worker(url)
      } catch {
        await writeAll(dbName, store, records)
        return
      }
      try {
        await new Promise<void>((resolve, reject) => {
          worker.onmessage = (e: MessageEvent<{ ok: boolean; error?: string }>) =>
            e.data.ok ? resolve() : reject(new Error(e.data.error))
          // Worker 腳本無法載入（例如 CSP）時才會走到這裡（寫入錯誤已在 Worker 內以訊息回傳），退回主執行緒
          worker.onerror = () => writeAll(dbName, store, records).then(resolve, reject)
          worker.postMessage({ dbName, store, records })
        })
      } finally {
        worker.terminate()
        URL.revokeObjectURL(url)
      }
    },
    { dbName: DB_NAME, store, records },
  )
}
