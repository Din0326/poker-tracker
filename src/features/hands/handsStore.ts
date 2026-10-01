// 手牌列表的記憶體快取（SPEC-v2-hands 6.1 效能、11.1）：全部手牌讀出後轉成不含 detail、rawText 的輕量物件
// （HandListItem）保存在記憶體，篩選、排序與分組都在記憶體內計算（同 v1 7.1 的 sessionsStore 做法）。
// App 開啟期間保留；每次進入列表在背景重新讀取（先顯示快取，讀完再替換），讓從詳情返回時可以同步渲染
// 原本的內容，捲動位置才還原得回去（5.1）。新增、編輯、刪除、復原與刪除場次會直接更新快取。
// version 在快取內容每次改變時遞增：場次詳情的手牌區塊（6.3）以此得知需要重新查詢該場的手牌。
import { useSyncExternalStore } from 'react'
import type { Repositories } from '../../db'
import type { Hand } from '../../domain/hands'
import { sortHandsNewestFirst, toHandListItem, type HandListItem } from './handListModel'

export type HandsState =
  | { status: 'loading' }
  | { status: 'error' }
  /** hands 已依 6.1 排序（playedAt、createdAt 由新到舊） */
  | { status: 'ready'; hands: HandListItem[] }

let state: HandsState = { status: 'loading' }
let owner: Repositories | null = null
let requestSeq = 0
let version = 0
const listeners = new Set<() => void>()
const versionListeners = new Set<() => void>()

function setState(next: HandsState): void {
  state = next
  for (const l of listeners) l()
}

function bumpVersion(): void {
  version++
  for (const l of versionListeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function subscribeVersion(listener: () => void): () => void {
  versionListeners.add(listener)
  return () => versionListeners.delete(listener)
}

const getSnapshot = () => state
const getVersion = () => version

export function useHandsState(): HandsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 手牌資料（新增、編輯、刪除、復原、刪除場次轉為獨立）每次改變時遞增 */
export function useHandsVersion(): number {
  return useSyncExternalStore(subscribeVersion, getVersion, getVersion)
}

/** 從 DB 重新讀取；已有資料時失敗保留舊資料，沒有資料時顯示錯誤狀態 */
export async function refreshHands(repos: Repositories): Promise<void> {
  if (owner !== repos) {
    owner = repos
    setState({ status: 'loading' })
  }
  const seq = ++requestSeq
  try {
    const all = await repos.hands.list()
    if (seq !== requestSeq || owner !== repos) return
    setState({ status: 'ready', hands: sortHandsNewestFirst(all.map(toHandListItem)) })
  } catch {
    if (seq !== requestSeq || owner !== repos) return
    if (state.status !== 'ready') setState({ status: 'error' })
  }
}

/** 錯誤狀態後的重試：先回到載入中 */
export function retryHands(repos: Repositories): void {
  setState({ status: 'loading' })
  void refreshHands(repos)
}

/** 丟棄快取（備份匯入、清除所有資料後）：回到載入中，作廢進行中的讀取 */
export function invalidateHands(): void {
  requestSeq++
  owner = null
  setState({ status: 'loading' })
  bumpVersion()
}

function patch(fn: (hands: HandListItem[]) => HandListItem[]): void {
  bumpVersion()
  if (state.status !== 'ready') return
  // 進行中的讀取結果可能是改動前的資料，作廢它
  requestSeq++
  setState({ status: 'ready', hands: fn(state.hands) })
}

/** 新增或取代一筆（新增、編輯儲存、復原） */
export function upsertCachedHand(hand: Hand): void {
  const item = toHandListItem(hand)
  patch((list) => sortHandsNewestFirst([...list.filter((h) => h.id !== hand.id), item]))
}

export function removeCachedHand(id: string): void {
  patch((list) => list.filter((h) => h.id !== id))
}

/** 6.5 刪除場次：這些手牌轉為獨立（sessionId = null，updatedAt 不變） */
export function detachCachedHands(ids: readonly string[]): void {
  const set = new Set(ids)
  patch((list) => list.map((h) => (set.has(h.id) ? { ...h, sessionId: null } : h)))
}

/** 6.5 復原場次：這次刪除時被轉為獨立、且目前仍為獨立的手牌重新掛回 */
export function attachCachedHands(ids: readonly string[], sessionId: string): void {
  const set = new Set(ids)
  patch((list) => list.map((h) => (set.has(h.id) && h.sessionId === null ? { ...h, sessionId } : h)))
}
