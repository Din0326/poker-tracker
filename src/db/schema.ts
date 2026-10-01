// Dexie（IndexedDB）schema，3.7。
//
// 【遷移規則（必須）】之後任何 schema 變更都必須新增 db.version(n).stores(...).upgrade(tx => ...)
// 遷移既有資料，不得刪除 version(1) 的定義，也不得清除或重建資料庫。
//
// 【archived 索引注意】IndexedDB 的索引鍵不接受 boolean，archived 為 true/false 的資料
// 不會出現在 archived 索引中，where('archived') 查不到任何資料。
// 查詢未封存 / 已封存請先取出再以 filter 篩選（見 venueRepo、stakeRepo）。
// schema 字串仍保留 archived，以完全符合規格 3.7。
import { Dexie, type EntityTable, type Transaction } from 'dexie'
import type { Session, SettingKey, Stake, Venue } from '../domain/types'

/** 規格 3.7 的 v1 stores 定義，不得修改（變更請新增版本） */
export const SCHEMA_V1 = {
  sessions: 'id, type, startAt, venueId, stakeId',
  venues: 'id, name, archived',
  stakes: 'id, archived',
  settings: 'key',
} as const

/**
 * 規格 3.7 的 v2 stores 定義（v1.2 賣股份）：backers 不需要索引，所以與 v1 完全相同，只新增遷移函式。
 * 獨立寫出而不引用 SCHEMA_V1，避免之後誤改其中一個。
 */
export const SCHEMA_V2 = {
  sessions: 'id, type, startAt, venueId, stakeId',
  venues: 'id, name, archived',
  stakes: 'id, archived',
  settings: 'key',
} as const

/** v2 手牌功能使用 version 3（11.2） */
export const DB_VERSION = 2
export const DEFAULT_DB_NAME = 'poker-tracker'

/** settings 表的一列：key-value */
export interface SettingRow {
  key: SettingKey
  value: unknown
}

export type PokerDb = Dexie & {
  sessions: EntityTable<Session, 'id'>
  venues: EntityTable<Venue, 'id'>
  stakes: EntityTable<Stake, 'id'>
  settings: EntityTable<SettingRow, 'key'>
}

/**
 * version 1 → 2 的遷移（3.7）：只補 `backers: []`，不改動任何其他欄位（包含 updatedAt，
 * 遷移不算使用者修改，不得觸發 8.7 備份提醒）。失敗時 Dexie 回滾整個升級交易，資料維持 version 1。
 */
export function upgradeToV2(tx: Transaction): PromiseLike<unknown> {
  return tx
    .table('sessions')
    .toCollection()
    .modify((s: Record<string, unknown>) => {
      if (!Array.isArray(s.backers)) s.backers = []
    })
}

// ---- 3.7 versionchange：其他分頁要升級（或刪除）資料庫時，關閉本頁連線並提示重新載入 ----
const versionChangeListeners = new Set<() => void>()
let versionChanged = false

/** 訂閱「資料庫已被新版本接手」事件；回傳取消訂閱函式。已發生過時立即通知 */
export function onDbVersionChange(listener: () => void): () => void {
  versionChangeListeners.add(listener)
  if (versionChanged) listener()
  return () => versionChangeListeners.delete(listener)
}

/** 是否已收到 versionchange（本頁連線已關閉） */
export function hasDbVersionChanged(): boolean {
  return versionChanged
}

function notifyVersionChange(): void {
  versionChanged = true
  for (const l of versionChangeListeners) l()
}

export interface CreateDbOptions {
  /** 測試用：替換 version 2 的遷移函式（例如模擬遷移失敗） */
  upgradeV2?: (tx: Transaction) => void | PromiseLike<unknown>
  /** 收到 versionchange 並關閉連線後呼叫；預設通知 onDbVersionChange 的訂閱者 */
  onVersionChange?: () => void
}

/** 建立 DB 實例；測試可傳入不同名稱以取得獨立資料庫 */
export function createDb(name: string = DEFAULT_DB_NAME, options: CreateDbOptions = {}): PokerDb {
  const db = new Dexie(name) as PokerDb
  // version 1 定義保留，不得刪除（3.7）
  db.version(1).stores(SCHEMA_V1)
  db.version(2)
    .stores(SCHEMA_V2)
    .upgrade(options.upgradeV2 ?? upgradeToV2)
  // 新版頁面要升級時，舊連線若不關閉會擋住升級：立即關閉（且不再自動重開，避免舊程式繼續寫入），
  // 再由畫面顯示「有新版本 · 重新載入」（8.10 的提示條）
  db.on('versionchange', () => {
    db.close({ disableAutoOpen: true })
    ;(options.onVersionChange ?? notifyVersionChange)()
    return false
  })
  return db
}

/** App 預設使用的單例（建構時不會開啟連線，第一次存取時才開啟） */
export const db: PokerDb = createDb()
