import { X } from 'lucide-react'
import { useState } from 'react'
import { getRunMode } from '../lib/platform'
import { strings } from '../strings'

// 關閉後維持到下次開啟 App（只存在記憶體）
let dismissedThisLaunch = false

// 瀏覽器分頁模式下，首頁提示加入主畫面（第 2 節）
export function InstallBanner() {
  const [dismissed, setDismissed] = useState(dismissedThisLaunch)

  if (dismissed || getRunMode() === 'standalone') return null

  const dismiss = () => {
    dismissedThisLaunch = true
    setDismissed(true)
  }

  return (
    <div
      role="note"
      className="mt-2 flex items-center gap-2 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) py-1 pl-4 pr-1 text-sm"
    >
      <p className="flex-1">{strings.installBanner.message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={strings.common.close}
        className="flex size-(--touch-min) shrink-0 items-center justify-center text-(--color-text-muted)"
      >
        <X aria-hidden="true" size={20} />
      </button>
    </div>
  )
}
