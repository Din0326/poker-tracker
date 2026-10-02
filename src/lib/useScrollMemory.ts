import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router'

// 每個頁面（以 pathname 區分）記住自己的捲動位置（9.1）；App 重啟後不保留
const positions = new Map<string, number>()

/**
 * 同一個 pathname 但要分開記憶的頁面：pathname → 區分用的 query 參數。
 * SPEC-v2-hands 6.1：從場次詳情「查看全部」進入的 `#/hands?sessionId=<id>` 是推入式子頁，
 * 它的捲動不寫入「手牌」頁籤（`#/hands`）記住的位置。
 */
const SCOPED_PARAMS: Readonly<Record<string, string>> = { '/hands': 'sessionId' }

/** 捲動位置的記憶鍵 */
export function scrollMemoryKey(pathname: string, search: string): string {
  const param = SCOPED_PARAMS[pathname]
  if (param === undefined) return pathname
  const value = new URLSearchParams(search).get(param)
  return value === null || value === '' ? pathname : `${pathname}?${param}=${value}`
}

export function useScrollMemory() {
  const { pathname, search } = useLocation()
  const key = scrollMemoryKey(pathname, search)

  useLayoutEffect(() => {
    window.scrollTo(0, positions.get(key) ?? 0)
    const onScroll = () => positions.set(key, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [key])
}
