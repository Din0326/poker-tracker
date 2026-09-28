import type { ReactNode } from 'react'

// 提示訊息固定在分頁列上方（9.2），不遮擋儲存鈕
export function ToastBar({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="anim-toast fixed inset-x-0 z-30 mx-auto max-w-(--page-max-width) px-4 bottom-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom)+8px)]"
    >
      <div className="flex min-h-(--touch-min) items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) py-1 pl-4 pr-1 shadow-lg">
        {children}
      </div>
    </div>
  )
}
