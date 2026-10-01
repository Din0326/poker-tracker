// 8.7 備份提醒的觸發條件（純函式，now 由呼叫端注入）；v2 依 SPEC-v2-hands 10.5 納入手牌
import type { Hand } from './hands/types'
import type { Session } from './types'

/** 從未備份時，「場次數 + 手牌數」達到此值才提醒 */
export const BACKUP_REMINDER_MIN_SESSIONS = 10
/** 距上次備份超過此時間（嚴格大於）才提醒：30 × 24 小時 */
export const BACKUP_REMINDER_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 符合任一條件時提醒（v2 10.5）：
 * - 從未備份（lastBackupAt 不存在）且「場次數 + 手牌數」≥ 10
 * - 距上次備份超過 30 天，且任一場次或手牌 updatedAt > lastBackupAt（備份後有新增或修改）
 * 時間戳含時區偏移，一律轉成時間值比較。刪除場次、刪除手牌、刪除場次造成的手牌轉為獨立
 * （不更新 updatedAt）都不觸發，屬規格 12.3 已知限制。
 */
export function shouldShowBackupReminder(input: {
  sessions: readonly Pick<Session, 'updatedAt'>[]
  /** v2 手牌；省略視為沒有手牌 */
  hands?: readonly Pick<Hand, 'updatedAt'>[]
  lastBackupAt: string | undefined
  now: Date
}): boolean {
  const { sessions, hands = [], lastBackupAt, now } = input
  const last = lastBackupAt === undefined ? Number.NaN : Date.parse(lastBackupAt)
  // lastBackupAt 寫入時已驗證格式；萬一無法解析，視同從未備份
  if (Number.isNaN(last)) return sessions.length + hands.length >= BACKUP_REMINDER_MIN_SESSIONS
  if (now.getTime() - last <= BACKUP_REMINDER_INTERVAL_MS) return false
  const updatedAfter = (r: { updatedAt: string }) => Date.parse(r.updatedAt) > last
  return sessions.some(updatedAfter) || hands.some(updatedAfter)
}
