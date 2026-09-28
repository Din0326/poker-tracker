import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router'

// 每個頁面（以 pathname 區分）記住自己的捲動位置（9.1）；App 重啟後不保留
const positions = new Map<string, number>()

export function useScrollMemory() {
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    window.scrollTo(0, positions.get(pathname) ?? 0)
    const onScroll = () => positions.set(pathname, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pathname])
}
