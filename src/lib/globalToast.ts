// 全域提示（Q5）：不隨頁面卸載，切換分頁時仍顯示，時間到自動消失。
// 目前用於「已刪除 · 復原」（7.5）。畫面由 components/GlobalToast 渲染於 AppLayout。
import { useSyncExternalStore } from 'react'

export interface GlobalToastAction {
  label: string
  onPress: () => void
}

export interface GlobalToastData {
  id: number
  text: string
  action?: GlobalToastAction
  durationMs: number
}

let current: GlobalToastData | null = null
let seq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => current

export function useGlobalToast(): GlobalToastData | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 顯示提示（取代目前的提示），回傳 id 供 hideGlobalToast 使用 */
export function showGlobalToast(toast: Omit<GlobalToastData, 'id'>): number {
  current = { ...toast, id: ++seq }
  emit()
  return current.id
}

/** 關閉提示；傳入 id 時只在目前顯示的是該提示才關閉 */
export function hideGlobalToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return
  current = null
  emit()
}
