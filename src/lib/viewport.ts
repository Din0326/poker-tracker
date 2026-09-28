// iOS 鍵盤處理（9.2）：鍵盤彈出時正在輸入的欄位不得被按鈕列或鍵盤遮住。
// - useKeyboardInset：以 visualViewport 算出鍵盤遮住的高度，寫入 CSS 變數 --keyboard-inset
//   （bottom sheet 用它貼齊鍵盤上緣；頁面底部內距加上它，讓最後一個欄位也捲得上來）
// - useKeepFocusedVisible：欄位 focus 或可視區域改變時，把欄位捲到固定列與鍵盤之上
import { useEffect, type RefObject } from 'react'

/** 會遮住畫面底部的固定元素（新增頁的預覽 + 儲存列、分頁列）加上此屬性 */
export const OBSCURES_BOTTOM_ATTR = 'data-obscures-bottom'

const MARGIN = 12

function keyboardInset(): number {
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
}

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--keyboard-inset', `${keyboardInset()}px`)
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])
}

/** 把元素捲到「頂部標題列之下、底部固定列與鍵盤之上」的可見範圍 */
export function scrollIntoVisibleArea(el: Element): void {
  const vv = window.visualViewport
  const viewTop = vv ? vv.offsetTop : 0
  let bottomLimit = vv ? vv.offsetTop + vv.height : window.innerHeight
  for (const bar of document.querySelectorAll(`[${OBSCURES_BOTTOM_ATTR}]`)) {
    const r = bar.getBoundingClientRect()
    if (r.height > 0 && r.top < bottomLimit && r.bottom > viewTop) bottomLimit = Math.min(bottomLimit, r.top)
  }
  const header = document.querySelector('header')
  const topLimit = Math.max(viewTop, header ? header.getBoundingClientRect().bottom : 0)
  // 以欄位外框（含標籤與錯誤訊息）為準，沒有外框時用元素本身
  const target = el.closest('[data-field]') ?? el
  const r = target.getBoundingClientRect()
  if (r.bottom > bottomLimit - MARGIN) {
    window.scrollBy(0, Math.min(r.bottom - bottomLimit + MARGIN, r.top - topLimit - MARGIN))
  } else if (r.top < topLimit + MARGIN) {
    window.scrollBy(0, r.top - topLimit - MARGIN)
  }
}

function isEditable(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
}

export function useKeepFocusedVisible(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ensure = () => {
      const active = document.activeElement
      if (isEditable(active) && container.contains(active)) scrollIntoVisibleArea(active)
    }
    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return
      ensure()
      // 等 iOS 鍵盤動畫結束（約 300ms）再確認一次
      clearTimeout(timer)
      timer = setTimeout(ensure, 350)
    }
    container.addEventListener('focusin', onFocusIn)
    window.visualViewport?.addEventListener('resize', ensure)
    return () => {
      clearTimeout(timer)
      container.removeEventListener('focusin', onFocusIn)
      window.visualViewport?.removeEventListener('resize', ensure)
    }
  }, [containerRef])
}
