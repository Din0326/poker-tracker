// 手牌畫面的路由（SPEC-v2-hands 5.1）
export const HANDS_PATH = '/hands'
export const HAND_NEW_PATH = `${HANDS_PATH}/new`
/** 匯入 GG 手牌 `#/hands/import`（8.2） */
export const HAND_IMPORT_PATH = `${HANDS_PATH}/import`

/** 新增手牌；帶 sessionId 時預先關聯該場（5.1、6.3） */
export function handNewPath(sessionId?: string): string {
  return sessionId === undefined ? HAND_NEW_PATH : `${HAND_NEW_PATH}?sessionId=${encodeURIComponent(sessionId)}`
}

/** 手牌詳情 `#/hands/:id`（6.2） */
export function handDetailPath(id: string): string {
  return `${HANDS_PATH}/${encodeURIComponent(id)}`
}

/** 編輯手牌 `#/hands/:id/edit`（5.8） */
export function handEditPath(id: string): string {
  return `${handDetailPath(id)}/edit`
}

/** 編輯頁的 query：從詳情「補齊為完整手牌」進入時直接開啟完整模式步驟 1（5.8） */
export const COMPLETE_PARAM = 'complete'

/** 補齊為完整手牌（5.8）：編輯頁開啟完整模式步驟 1 並預填備忘內容 */
export function handCompletePath(id: string): string {
  return `${handEditPath(id)}?${COMPLETE_PARAM}=1`
}

/** 手牌列表；帶 sessionId 時只列該場的手牌（6.1、6.3「查看全部」） */
export function handsListPath(sessionId?: string): string {
  return sessionId === undefined ? HANDS_PATH : `${HANDS_PATH}?sessionId=${encodeURIComponent(sessionId)}`
}

/** 從網址的 search 取出場次篩選（6.1）；沒有或空字串時為 null */
export function sessionIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('sessionId')
  return id === null || id === '' ? null : id
}
