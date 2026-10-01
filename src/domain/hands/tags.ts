// 3.1 標籤規則與 5.6 標籤建議清單（純函式）
import type { Hand } from './types'

/** 5.6 建議清單最多顯示筆數（同 v1 5.3 出資者名稱建議） */
export const MAX_TAG_SUGGESTIONS = 8

/** 標籤比較用的 key：去除前後空白、不分大小寫（3.1） */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase()
}

type TagSource = Pick<Hand, 'tags' | 'playedAt' | 'createdAt'>

/** 由新到舊：playedAt（固定格式字串可直接比較），同時間依 createdAt（含時區偏移，轉成時間值比較） */
function compareNewestFirst(a: TagSource, b: TagSource): number {
  if (a.playedAt !== b.playedAt) return a.playedAt < b.playedAt ? 1 : -1
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
}

/**
 * 5.6 標籤歷史：來源為所有手牌的 tags；去重不分大小寫、保留最近一次使用時的寫法；
 * 依最近使用排序（該標籤出現過的手牌中最新的 playedAt，同時間依 createdAt）。
 */
export function handTagHistory(hands: readonly TagSource[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const hand of [...hands].filter((x) => x.tags.length > 0).sort(compareNewestFirst)) {
    for (const raw of hand.tags) {
      const tag = raw.trim()
      const key = tagKey(tag)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      result.push(tag)
    }
  }
  return result
}

/**
 * 5.6 建議清單：輸入框有文字時只列出包含該文字的標籤（部分符合、不分大小寫），空白時列出全部；
 * 排除本手已加的標籤；最多 8 筆。
 */
export function filterTagSuggestions(
  history: readonly string[],
  query: string,
  existing: readonly string[],
  limit: number = MAX_TAG_SUGGESTIONS,
): string[] {
  const q = tagKey(query)
  const excluded = new Set(existing.map(tagKey))
  const result: string[] = []
  for (const tag of history) {
    const key = tagKey(tag)
    if (excluded.has(key)) continue
    if (q !== '' && !key.includes(q)) continue
    result.push(tag)
    if (result.length >= limit) break
  }
  return result
}
