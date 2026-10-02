// 手牌列表在 App 開啟期間的記憶（模組層級記憶體，App 重啟後回到預設；SPEC-v2-hands 5.1）：
// - 「手牌」頁籤（#/hands）的篩選條件與已載入筆數：切到其他頁籤再切回、或從詳情返回時不重置，捲動位置才能還原
// - 從場次詳情「查看全部」進入的子頁（#/hands?sessionId=）另存一份，不寫入頁籤的記憶（6.1）
import { DEFAULT_HAND_FILTERS, type HandListFilters } from './handListModel'

export const HAND_BATCH_SIZE = 100

export interface HandListMemory {
  filters: HandListFilters
  visible: { key: string; count: number } | null
}

/** 「手牌」頁籤的列表 */
export const handsTabMemory: HandListMemory = { filters: DEFAULT_HAND_FILTERS, visible: null }

/** 場次子頁的列表：只保留最後一個場次的狀態（從手牌詳情返回時還原） */
export const sessionScopedMemory: HandListMemory & { sessionId: string | null } = {
  sessionId: null,
  filters: DEFAULT_HAND_FILTERS,
  visible: null,
}

/** 取得某個列表的記憶；場次不同時重設為預設 */
export function memoryFor(sessionId: string | null): HandListMemory {
  if (sessionId === null) return handsTabMemory
  if (sessionScopedMemory.sessionId !== sessionId) {
    sessionScopedMemory.sessionId = sessionId
    sessionScopedMemory.filters = DEFAULT_HAND_FILTERS
    sessionScopedMemory.visible = null
  }
  return sessionScopedMemory
}

/** 記下某個列表目前的篩選條件 */
export function rememberFilters(sessionId: string | null, filters: HandListFilters): void {
  memoryFor(sessionId).filters = filters
}

/** 記下某個列表已載入的筆數 */
export function rememberVisible(sessionId: string | null, visible: { key: string; count: number }): void {
  memoryFor(sessionId).visible = visible
}

/** 備份匯入、清除所有資料後回到預設 */
export function resetHandsListMemory(): void {
  handsTabMemory.filters = DEFAULT_HAND_FILTERS
  handsTabMemory.visible = null
  sessionScopedMemory.sessionId = null
  sessionScopedMemory.filters = DEFAULT_HAND_FILTERS
  sessionScopedMemory.visible = null
}

/** 8.2 GG 匯入成功後前往手牌列表並篩選來源 = GG（其餘篩選回到預設、從頂端開始） */
export function showGgHandsInList(): void {
  handsTabMemory.filters = { ...DEFAULT_HAND_FILTERS, source: 'gg' }
  handsTabMemory.visible = null
}
