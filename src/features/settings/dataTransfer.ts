// 第 8 節資料管理的 DB 操作：讀出全部資料（匯出）、完整取代（8.5 匯入）、清除所有資料（8.9），
// 以及匯入 / 清除後讓記憶體快取與模組層級記憶回到初始狀態。
import type { PokerDb, SettingRow } from '../../db'
import { lastHandSeqAfterImport, type BackupFile, type Session, type SettingKey, type Settings, type Stake, type Venue } from '../../domain'
import type { Hand } from '../../domain/hands'
import { DEFAULT_PROFIT_SCHEME, setProfitScheme } from '../../lib/profitScheme'
import { DEFAULT_REPORT_PERIOD, reportMemory } from '../report/reportMemory'
import { DEFAULT_FILTERS } from '../sessions/listFilters'
import { listMemory } from '../sessions/listMemory'
import { invalidateSessions } from '../sessions/sessionsStore'
import { invalidateHands } from '../hands/handsStore'
import { resetHandsListMemory } from '../hands/handsListMemory'

export interface AllData {
  sessions: Session[]
  venues: Venue[]
  stakes: Stake[]
  hands: Hand[]
  settings: Partial<Settings>
}

/**
 * 讀出五張表（不自行開 transaction）。供 Dexie liveQuery 使用：liveQuery 會在同一個唯讀 transaction 內執行，
 * 並在任一張表變更後重新執行，讓設定頁隨時持有最新的匯出資料。
 */
export async function queryAllData(db: PokerDb): Promise<AllData> {
  const [sessions, venues, stakes, hands, rows] = await Promise.all([
    db.sessions.toArray(),
    db.venues.toArray(),
    db.stakes.toArray(),
    db.hands.toArray(),
    db.settings.toArray(),
  ])
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Settings>
  return { sessions, venues, stakes, hands, settings }
}

const allTables = (db: PokerDb) => [db.sessions, db.venues, db.stakes, db.hands, db.settings]

/** 在同一個唯讀 transaction 內讀出五張表，確保內容一致 */
export async function loadAllData(db: PokerDb): Promise<AllData> {
  return db.transaction('r', allTables(db), () => queryAllData(db))
}

/**
 * 8.5 完整取代：清除五張表（含 v2 的 hands）並寫入備份內容，全部在同一個 rw transaction 內，
 * 任何錯誤整個還原，不留下半套資料。
 * 設定寫入後 recordDraft、handDraft 不存在（已清除），lastBackupAt 設為備份檔的 exportedAt；
 * lastHandSeq 設為 max(檔案中的 lastHandSeq（沒有時為 0）, 檔案 hands 的最大 exportSeq)（SPEC-v2-hands 10.2）。
 */
export async function replaceAllData(db: PokerDb, backup: BackupFile): Promise<void> {
  await db.transaction('rw', allTables(db), async () => {
    await Promise.all(allTables(db).map((t) => t.clear()))
    await db.venues.bulkAdd(backup.venues)
    await db.stakes.bulkAdd(backup.stakes)
    await db.sessions.bulkAdd(backup.sessions)
    await db.hands.bulkAdd(backup.hands)
    const rows: SettingRow[] = (Object.entries(backup.settings) as [SettingKey, unknown][])
      .filter(([key]) => key !== 'lastHandSeq')
      .map(([key, value]) => ({ key, value }))
    rows.push({ key: 'lastHandSeq', value: lastHandSeqAfterImport(backup) })
    rows.push({ key: 'lastBackupAt', value: backup.exportedAt })
    await db.settings.bulkAdd(rows)
  })
}

/** 8.9 清除所有表（含設定、v2 的 hands 與 handDraft，SPEC-v2-hands 10.6），在同一個 transaction 內 */
export async function clearAllData(db: PokerDb): Promise<void> {
  await db.transaction('rw', allTables(db), async () => {
    await Promise.all(allTables(db).map((t) => t.clear()))
  })
}

/**
 * 匯入或清除後：紀錄列表、手牌列表 / 報表的記憶體快取失效，篩選與報表選擇回到預設
 * （避免仍套用指向舊資料的場地、盲注篩選），盈虧顏色依新設定套用。
 */
export function resetAppState(profitScheme: Settings['profitColorScheme'] = DEFAULT_PROFIT_SCHEME): void {
  invalidateSessions()
  // v2：手牌列表的快取與篩選記憶同樣回到預設（SPEC-v2-hands 6.1）
  invalidateHands()
  resetHandsListMemory()
  listMemory.filters = DEFAULT_FILTERS
  listMemory.visible = null
  listMemory.search = ''
  reportMemory.tab = 'all'
  reportMemory.period = DEFAULT_REPORT_PERIOD
  reportMemory.groupBy = null
  setProfitScheme(profitScheme)
}
