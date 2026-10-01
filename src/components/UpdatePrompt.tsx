import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { flushPendingDrafts } from '../lib/draftFlush'
import { strings } from '../strings'
import { ToastBar } from './Toast'

// 8.10：prompt 模式。偵測到新版時在分頁列上方顯示提示（ToastBar 依 --record-bar-offset 避開新增頁儲存鈕），
// 使用者按下「重新載入」才更新。更新前先把新增頁尚未寫入的草稿立即寫入（5.6），重整後由草稿還原。
// 不另外定時檢查更新：App 每次開啟（導覽）時瀏覽器會自行檢查 service worker 更新。
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const [reloading, setReloading] = useState(false)

  if (!needRefresh) return null

  const reload = async () => {
    if (reloading) return
    setReloading(true)
    await flushPendingDrafts()
    await updateServiceWorker(true)
  }

  return (
    <ToastBar>
      <span>{strings.update.available}</span>
      <button
        type="button"
        disabled={reloading}
        onClick={() => void reload()}
        className="min-h-(--touch-min) rounded-(--radius-control) px-3 font-semibold text-(--color-accent) disabled:opacity-60"
      >
        {strings.update.reload}
      </button>
    </ToastBar>
  )
}
