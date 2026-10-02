// 8.7 備份提醒的觸發條件（純函式，now 由呼叫端注入）；v2 依 SPEC-v2-hands 10.5 納入手牌；
// v1.6（v2.4）改為「14 天或累積 20 筆」三個條件
import type { Hand } from './hands/types'
import type { Session } from './types'

/** 條件 1：從未備份時，「場次數 + 手牌數」達到此值才提醒 */
export const BACKUP_REMINDER_MIN_SESSIONS = 10
/** 條件 2：距上次備份超過此時間（嚴格大於）才提醒：14 × 24 小時（v1.6 由 30 天改為 14 天） */
export const BACKUP_REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000
/** 條件 3（v1.6）：備份後新增或修改的「場次數 + 手牌數」達到此值即提醒，不論天數 */
export const BACKUP_REMINDER_MAX_CHANGES = 20

/**
 * 符合任一條件時提醒（v1 8.7、v2 10.5）：
 * 1. 從未備份（lastBackupAt 不存在）且「場次數 + 手牌數」≥ 10
 * 2. 距上次備份超過 14 天，且任一場次或手牌 updatedAt > lastBackupAt（備份後有新增或修改）
 * 3. 備份後新增或修改的筆數（updatedAt > lastBackupAt 的場次數 + 手牌數）≥ 20，不論天數
 * 條件 2、3 只在曾備份過時適用。時間戳含時區偏移，一律轉成時間值比較。刪除場次、刪除手牌、
 * 刪除場次造成的手牌轉為獨立（不更新 updatedAt）都不觸發，屬規格 12.3 已知限制。
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
  // lastBackupAt 寫入時已驗證格式；萬一無法解析，視同從未備份（只看條件 1）
  if (Number.isNaN(last)) return sessions.length + hands.length >= BACKUP_REMINDER_MIN_SESSIONS
  let changed = 0
  for (const list of [sessions, hands]) {
    for (const r of list) if (Date.parse(r.updatedAt) > last) changed++
  }
  if (changed === 0) return false
  // 條件 3：累積 20 筆（同一筆多次修改只算 1 筆，因為只記最後一次 updatedAt）
  if (changed >= BACKUP_REMINDER_MAX_CHANGES) return true
  // 條件 2：超過 14 天（恰 14 天不提醒）且有任何新增或修改
  return now.getTime() - last > BACKUP_REMINDER_INTERVAL_MS
}
