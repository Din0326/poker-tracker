// 紀錄列表的記憶體快取（7.1 效能）：全部場次、場地、盲注一次讀進記憶體，篩選與分組都在記憶體內計算。
// App 開啟期間保留；每次進入列表在背景重新讀取（先顯示快取，讀完再替換），
// 讓從詳情返回時可以同步渲染出原本的內容，捲動位置才還原得回去（9.1）。
// 詳情頁的刪除、復原與編輯儲存會直接更新快取，避免返回列表時短暫看到舊資料。
import { useSyncExternalStore } from 'react'
import type { Repositories } from '../../db'
import type { Session, Stake, Venue } from '../../domain'

export interface SessionsData {
  sessions: Session[]
  venues: Venue[]
  stakes: Stake[]
}

export type SessionsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: SessionsData }

let state: SessionsState = { status: 'loading' }
let owner: Repositories | null = null
let requestSeq = 0
const listeners = new Set<() => void>()

function setState(next: SessionsState): void {
  state = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => state

export function useSessionsState(): SessionsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 從 DB 重新讀取；已有資料時失敗保留舊資料，沒有資料時顯示錯誤狀態 */
export async function refreshSessions(repos: Repositories): Promise<void> {
  if (owner !== repos) {
    owner = repos
    setState({ status: 'loading' })
  }
  const seq = ++requestSeq
  try {
    const [sessions, venues, stakes] = await Promise.all([
      repos.sessions.list(),
      repos.venues.list(),
      repos.stakes.list(),
    ])
    if (seq !== requestSeq || owner !== repos) return
    setState({ status: 'ready', data: { sessions, venues, stakes } })
  } catch {
    if (seq !== requestSeq || owner !== repos) return
    if (state.status !== 'ready') setState({ status: 'error' })
  }
}

/** 重新進入錯誤狀態後的重試：先回到載入中 */
export function retrySessions(repos: Repositories): void {
  setState({ status: 'loading' })
  void refreshSessions(repos)
}

function patch(fn: (sessions: Session[]) => Session[]): void {
  if (state.status !== 'ready') return
  // 進行中的讀取結果可能是改動前的資料，作廢它
  requestSeq++
  setState({ status: 'ready', data: { ...state.data, sessions: fn(state.data.sessions) } })
}

/** 新增或取代一筆（編輯儲存、復原） */
export function upsertCachedSession(session: Session): void {
  patch((list) => [...list.filter((s) => s.id !== session.id), session])
}

export function removeCachedSession(id: string): void {
  patch((list) => list.filter((s) => s.id !== id))
}
