// Dexie（IndexedDB）schema，3.7。
//
// 【遷移規則（必須）】之後任何 schema 變更都必須新增 db.version(n).stores(...).upgrade(tx => ...)
// 遷移既有資料，不得刪除 version(1)、version(2) 的定義，也不得清除或重建資料庫。
//
// 【archived 索引注意】IndexedDB 的索引鍵不接受 boolean，archived 為 true/false 的資料
// 不會出現在 archived 索引中，where('archived') 查不到任何資料。
// 查詢未封存 / 已封存請先取出再以 filter 篩選（見 venueRepo、stakeRepo）。
// schema 字串仍保留 archived，以完全符合規格 3.7。
import { Dexie, type EntityTable, type Transaction } from 'dexie'
import type { Hand } from '../domain/hands/types'
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

/**
 * SPEC-v2-hands 3.12 的 version 3 stores：既有四張表定義不變，新增 hands 表。
 * - &exportSeq 唯一索引保證匯出編號不重複（7.4）；*tags 為 multiEntry
 * - 不得為任何布林欄位（例 Seat.mucked）建索引；kind、source、gameType、heroPosition 本版也不建索引（篩選在記憶體內）
 * - sessionId、sourceHandId 為 null 時不會進索引（IndexedDB 不索引 null），正好排除獨立手牌與手動手牌
 */
export const SCHEMA_V3 = {
  sessions: 'id, type, startAt, venueId, stakeId',
  venues: 'id, name, archived',
  stakes: 'id, archived',
  settings: 'key',
  hands: 'id, playedAt, sessionId, &exportSeq, sourceHandId, *tags',
} as const

/** v1.2 為 version 2；v2 手牌功能（SPEC-v2-hands 3.12）為 version 3 */
export const DB_VERSION = 3
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
  hands: EntityTable<Hand, 'id'>
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

/**
 * version 2 → 3 的遷移（SPEC-v2-hands 3.12）：hands 表由 Dexie 依 stores 定義自動建立為空表，
 * 不讀寫任何既有表（sessions、venues、stakes、settings 的每一筆資料，包含 updatedAt，升級前後逐欄相同）。
 * 刻意保留為空函式，讓測試可注入失敗（createDb 的 upgradeV3 選項）；失敗時 Dexie 回滾，資料維持 version 2。
 */
export function upgradeToV3(_tx: Transaction): void {
  void _tx
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
  /** 測試用：替換 version 3 的遷移函式（例如模擬遷移失敗） */
  upgradeV3?: (tx: Transaction) => void | PromiseLike<unknown>
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
  db.version(3)
    .stores(SCHEMA_V3)
    .upgrade(options.upgradeV3 ?? upgradeToV3)
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
