import { useState, useSyncExternalStore } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { hasDbVersionChanged, onDbVersionChange } from '../db'
import { flushPendingDrafts } from '../lib/draftFlush'
import { strings } from '../strings'
import { ToastBar } from './Toast'

const subscribeVersionChange = (listener: () => void) => onDbVersionChange(listener)

// 8.10：prompt 模式。偵測到新版時在分頁列上方顯示提示（ToastBar 依 --record-bar-offset 避開新增頁儲存鈕），
// 使用者按下「重新載入」才更新。更新前先把新增頁尚未寫入的草稿立即寫入（5.6），重整後由草稿還原。
// 不另外定時檢查更新：App 每次開啟（導覽）時瀏覽器會自行檢查 service worker 更新。
// 3.7：其他分頁的新版本要升級資料庫（versionchange）時，本頁已關閉資料庫連線，同樣顯示這個提示條，
// 按下後重新載入頁面（此時連線已關閉，草稿無法再寫入；草稿平常在輸入停止 500ms 後就已寫入）。
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const dbReplaced = useSyncExternalStore(subscribeVersionChange, hasDbVersionChanged, hasDbVersionChanged)
  const [reloading, setReloading] = useState(false)

  if (!needRefresh && !dbReplaced) return null

  const reload = async () => {
    if (reloading) return
    setReloading(true)
    if (needRefresh) {
      await flushPendingDrafts()
      await updateServiceWorker(true)
    } else {
      window.location.reload()
    }
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
