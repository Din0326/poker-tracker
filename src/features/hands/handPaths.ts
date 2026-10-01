// 手牌畫面的路由（SPEC-v2-hands 5.1）。手牌列表（#/hands）與詳情（#/hands/:id）於 H2 實作。
export const HANDS_PATH = '/hands'
export const HAND_NEW_PATH = `${HANDS_PATH}/new`

/** 新增手牌；帶 sessionId 時預先關聯該場（5.1、6.3） */
export function handNewPath(sessionId?: string): string {
  return sessionId === undefined ? HAND_NEW_PATH : `${HAND_NEW_PATH}?sessionId=${encodeURIComponent(sessionId)}`
}

export function handEditPath(id: string): string {
  return `${HANDS_PATH}/${encodeURIComponent(id)}/edit`
}
