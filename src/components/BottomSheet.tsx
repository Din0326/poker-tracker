import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// 底部彈出面板（9.2）：確認視窗與小視窗共用
// - role="dialog" + aria-modal，標題以 aria-labelledby 關聯
// - Esc 或點背景關閉；開啟時 focus 移入面板（Tab 只在面板內循環），關閉後還原到原本的元素
// - 開啟期間 #root 設為 inert，螢幕閱讀器與鍵盤不會操作到底下的頁面
// - 貼齊 iOS 鍵盤上緣（--keyboard-inset），面板內的輸入框不會被鍵盤遮住
// - 動效 ≤ 250ms，reduced-motion 時關閉（index.css）

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** 開啟時優先 focus 的元素；未指定時 focus 面板內第一個可操作元素 */
  initialFocusRef?: RefObject<HTMLElement | null>
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function BottomSheet({ open, title, onClose, children, initialFocusRef }: Props) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    const rootWasInert = root?.hasAttribute('inert') ?? false
    root?.setAttribute('inert', '')

    const panel = panelRef.current
    const first = initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel
    first?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (!firstItem || !lastItem) return
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (!rootWasInert) root?.removeAttribute('inert')
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [open, initialFocusRef])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-40">
      <div aria-hidden="true" onClick={onClose} className="anim-fade absolute inset-0 bg-(--color-backdrop)" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet absolute inset-x-0 bottom-(--keyboard-inset) mx-auto max-h-[85dvh] max-w-(--page-max-width) overflow-y-auto rounded-t-(--radius-card) border-t border-(--color-border) bg-(--color-surface) pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] outline-none"
      >
        <h2 id={titleId} className="mb-3 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
