import { useRegisterSW } from 'virtual:pwa-register/react'
import { strings } from '../strings'
import { ToastBar } from './Toast'

// 8.10：偵測到新版時顯示提示，使用者按下才更新（完整行為於 P5 補齊）
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <ToastBar>
      <span>{strings.update.available}</span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="min-h-(--touch-min) rounded-(--radius-control) px-3 font-semibold text-(--color-accent)"
      >
        {strings.update.reload}
      </button>
    </ToastBar>
  )
}
