// Dexie（IndexedDB）schema，3.7。
//
// 【遷移規則（必須）】之後任何 schema 變更都必須新增 db.version(n).stores(...).upgrade(tx => ...)
// 遷移既有資料，不得刪除 version(1) 的定義，也不得清除或重建資料庫。
//
// 【archived 索引注意】IndexedDB 的索引鍵不接受 boolean，archived 為 true/false 的資料
// 不會出現在 archived 索引中，where('archived') 查不到任何資料。
// 查詢未封存 / 已封存請先取出再以 filter 篩選（見 venueRepo、stakeRepo）。
// schema 字串仍保留 archived，以完全符合規格 3.7。
import { Dexie, type EntityTable } from 'dexie'
import type { Session, SettingKey, Stake, Venue } from '../domain/types'

/** 規格 3.7 的 v1 stores 定義，不得修改（變更請新增版本） */
export const SCHEMA_V1 = {
  sessions: 'id, type, startAt, venueId, stakeId',
  venues: 'id, name, archived',
  stakes: 'id, archived',
  settings: 'key',
} as const

export const DB_VERSION = 1
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

/** 建立 DB 實例；測試可傳入不同名稱以取得獨立資料庫 */
export function createDb(name: string = DEFAULT_DB_NAME): PokerDb {
  const db = new Dexie(name) as PokerDb
  db.version(1).stores(SCHEMA_V1)
  return db
}

/** App 預設使用的單例（建構時不會開啟連線，第一次存取時才開啟） */
export const db: PokerDb = createDb()
