import { useEffect } from 'react'
import { hideGlobalToast, useGlobalToast } from '../lib/globalToast'
import { ToastBar } from './Toast'

// 全域提示（Q5）：放在 AppLayout，切換頁面不會卸載；時間到自動消失
export function GlobalToast() {
  const toast = useGlobalToast()

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => hideGlobalToast(toast.id), toast.durationMs)
    return () => clearTimeout(timer)
  }, [toast])

  if (!toast) return null
  const { action } = toast

  return (
    <ToastBar key={toast.id}>
      <span className="num" data-testid="global-toast-text">
        {toast.text}
      </span>
      {action && (
        <button
          type="button"
          onClick={action.onPress}
          className="min-h-(--touch-min) min-w-(--touch-min) shrink-0 rounded-(--radius-control) px-3 font-semibold text-(--color-accent)"
        >
          {action.label}
        </button>
      )}
    </ToastBar>
  )
}
