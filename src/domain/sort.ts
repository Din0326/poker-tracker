// 場次排序：6.3 由舊到新（startAt，同時間依 createdAt）；7.1 由新到舊（兩者皆反向）
import type { Session } from './types'

type Sortable = Pick<Session, 'startAt' | 'createdAt'>

/**
 * 由舊到新的比較函式。
 * startAt 為固定格式的本地時間字串，可直接字串比較；
 * createdAt 含時區偏移，偏移可能不同，所以轉成時間值再比較。
 */
export function compareChronological(a: Sortable, b: Sortable): number {
  if (a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1
  return Date.parse(a.createdAt) - Date.parse(b.createdAt)
}

/** 由舊到新（回傳新陣列，不改動輸入） */
export function sortChronological<T extends Sortable>(sessions: readonly T[]): T[] {
  return [...sessions].sort(compareChronological)
}

/** 由新到舊（回傳新陣列，不改動輸入） */
export function sortReverseChronological<T extends Sortable>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => compareChronological(b, a))
}
