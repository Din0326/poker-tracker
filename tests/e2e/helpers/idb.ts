import type { Page } from '@playwright/test'

// 以原生 IndexedDB API 直接讀寫 App 的資料庫（poker-tracker），用來驗證 DB 內容或預先放入資料。
// 須在 App 已開啟過資料庫（進過新增頁）之後呼叫。

export const DB_NAME = 'poker-tracker'

export type StoreName = 'sessions' | 'venues' | 'stakes' | 'settings'

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

export async function putRecords(page: Page, store: StoreName, records: unknown[]): Promise<void> {
  await page.evaluate(
    async ({ dbName, store, records }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, 'readwrite')
          for (const r of records) tx.objectStore(store).put(r)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { dbName: DB_NAME, store, records },
  )
}
