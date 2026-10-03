// 3.7「升級前的備份提示」（v1.6）：在 Dexie 開啟資料庫（執行任何 upgrade）之前，以原生 IndexedDB 判斷
// 裝置上是否有「舊版且有資料」的資料庫，並讀出升級前的原始資料供使用者先匯出備份。
//
// 【不得觸發升級（必須）】
// - 先以 indexedDB.databases() 查版本，不開啟資料庫
// - 需要讀資料時以「不指定版本」的 indexedDB.open(name) 開啟：瀏覽器以既有版本開啟，不會觸發 upgradeneeded
// - 不支援 databases() 時同樣以不指定版本開啟；若觸發 upgradeneeded，代表資料庫不存在（瀏覽器準備建立版本 1），
//   立即中止該交易，不建立任何資料庫
// - 讀完立即關閉連線，之後才讓 Dexie 開啟（連線未關閉會擋住 Dexie 的升級）
// Dexie 的原生版本號 = Dexie 版本 × 10（Dexie version 2 為原生 20）。

/** Dexie 版本 → 原生 IndexedDB 版本的倍數 */
export const DEXIE_NATIVE_VERSION_MULTIPLIER = 10

/** 舊資料庫可能有的表；hands 只在 version 3 起存在 */
const LEGACY_STORES = ['sessions', 'venues', 'stakes', 'hands', 'settings'] as const
/** 判斷「有資料」的表（只有 settings 不算有資料） */
const DATA_STORES = ['sessions', 'venues', 'stakes', 'hands'] as const

export type LegacyRecord = Record<string, unknown>

/** 升級前舊資料庫的原始資料（原樣，不做任何轉換） */
export interface LegacyData {
  sessions: LegacyRecord[]
  venues: LegacyRecord[]
  stakes: LegacyRecord[]
  hands: LegacyRecord[]
  /** settings 表轉成 key → value */
  settings: Record<string, unknown>
}

export type PreUpgradeInspection =
  /** 沒有資料庫（全新安裝） */
  | { kind: 'none' }
  /** 已是最新版本（或更新） */
  | { kind: 'current'; nativeVersion: number }
  /** 舊版，但場次、手牌、場地、盲注都是 0 筆 */
  | { kind: 'oldEmpty'; nativeVersion: number; dexieVersion: number }
  /** 舊版且有資料：需要顯示提示 */
  | { kind: 'oldWithData'; nativeVersion: number; dexieVersion: number; data: LegacyData }
  /** 讀取失敗：不提示，照常開啟（3.7 第 8 步） */
  | { kind: 'error' }

/** 原生版本換算成 Dexie 版本 */
export function dexieVersionOf(nativeVersion: number): number {
  return Math.floor(nativeVersion / DEXIE_NATIVE_VERSION_MULTIPLIER)
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * 以不指定版本開啟。資料庫不存在時（觸發 upgradeneeded）中止交易並回傳 null，不建立資料庫。
 */
function openExistingWithoutVersion(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let missing = false
    const req = factory.open(name)
    req.onupgradeneeded = () => {
      missing = true
      req.transaction?.abort()
    }
    req.onsuccess = () => {
      // 理論上中止後不會成功；保險起見關閉連線
      if (missing) {
        req.result.close()
        resolve(null)
      } else resolve(req.result)
    }
    req.onerror = (e) => {
      // 中止交易造成的 AbortError 是預期的，不往外傳
      e.preventDefault()
      if (missing) resolve(null)
      else reject(req.error)
    }
  })
}

/** 在一個唯讀交易內讀出舊資料庫既有的表 */
async function readLegacyData(db: IDBDatabase): Promise<LegacyData> {
  const stores = LEGACY_STORES.filter((s) => db.objectStoreNames.contains(s))
  const data: LegacyData = { sessions: [], venues: [], stakes: [], hands: [], settings: {} }
  if (stores.length === 0) return data
  const tx = db.transaction(stores, 'readonly')
  const results = await Promise.all(stores.map((s) => requestResult(tx.objectStore(s).getAll() as IDBRequest<LegacyRecord[]>)))
  stores.forEach((store, i) => {
    const rows = results[i]!
    if (store === 'settings') {
      data.settings = Object.fromEntries(rows.map((r) => [String(r.key), r.value]))
    } else {
      data[store] = rows
    }
  })
  return data
}

/**
 * 3.7 第 1–4 步：判斷是否需要升級前的備份提示，需要時一併讀出舊資料。
 * 任何錯誤都回傳 { kind: 'error' }（不提示、照常開啟），不丟出例外。
 */
export async function inspectBeforeUpgrade(
  name: string,
  targetDexieVersion: number,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<PreUpgradeInspection> {
  if (!factory) return { kind: 'error' }
  const target = targetDexieVersion * DEXIE_NATIVE_VERSION_MULTIPLIER
  try {
    // 1. 優先以 databases() 查版本（不開啟資料庫）
    if (typeof factory.databases === 'function') {
      const list = await factory.databases()
      const info = list.find((d) => d.name === name)
      if (!info) return { kind: 'none' }
      if (info.version !== undefined && info.version >= target) return { kind: 'current', nativeVersion: info.version }
    }
    // 不支援 databases()，或確認為舊版：以不指定版本開啟（不會觸發升級）
    const db = await openExistingWithoutVersion(factory, name)
    if (!db) return { kind: 'none' }
    // 其他分頁要升級時讓路（不擋住升級）
    db.onversionchange = () => db.close()
    try {
      const nativeVersion = db.version
      if (nativeVersion >= target) return { kind: 'current', nativeVersion }
      const dexieVersion = dexieVersionOf(nativeVersion)
      const data = await readLegacyData(db)
      const hasData = DATA_STORES.some((s) => data[s].length > 0)
      return hasData ? { kind: 'oldWithData', nativeVersion, dexieVersion, data } : { kind: 'oldEmpty', nativeVersion, dexieVersion }
    } finally {
      // 讀完立即關閉，之後 Dexie 才能升級
      db.close()
    }
  } catch {
    return { kind: 'error' }
  }
}
