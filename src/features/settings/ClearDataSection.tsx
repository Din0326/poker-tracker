import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BottomSheet } from '../../components/BottomSheet'
import { dangerButtonClass, inputClass, secondaryButtonClass } from '../../components/controlStyles'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { strings } from '../../strings'
import { clearAllData, resetAppState } from './dataTransfer'
import { SUCCESS_TOAST_MS } from './manageShared'
import { SettingsSection } from './SettingsSection'

const t = strings.settings
const s = t.clearSheet

// 8.9 清除所有資料：設定頁最底部的紅色按鈕；要求輸入「刪除」兩字才能確認。
// 清除四張表（含設定）後回到首次啟動狀態：快取失效、盈虧顏色回預設、導到新增頁。
export function ClearDataSection() {
  const { db } = useAppData()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const matches = text.trim() === s.keyword

  const close = () => {
    if (busy) return
    setOpen(false)
    setText('')
    setFailed(false)
  }

  const confirm = async () => {
    if (!matches || busy) return
    setBusy(true)
    setFailed(false)
    try {
      await clearAllData(db)
      resetAppState()
      setOpen(false)
      setText('')
      showGlobalToast({ text: t.cleared, durationMs: SUCCESS_TOAST_MS })
      void navigate('/', { replace: true })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection id="settings-clear" title={t.clearSection}>
      <button type="button" onClick={() => setOpen(true)} className={`${dangerButtonClass} w-full`}>
        {t.clearAll}
      </button>
      <BottomSheet open={open} title={s.title} onClose={close}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void confirm()
          }}
        >
          <p className="text-sm">{s.warning}</p>
          <label htmlFor="clear-confirm-input" className="mt-3 mb-1 block text-sm text-(--color-text-muted)">
            {s.inputLabel}
          </label>
          <input
            id="clear-confirm-input"
            type="text"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={failed ? 'clear-confirm-error' : undefined}
            className={inputClass}
          />
          {failed && (
            <p id="clear-confirm-error" role="alert" className="mt-1 text-sm text-(--color-danger)">
              {t.clearFailed}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={close} className={secondaryButtonClass}>
              {strings.common.cancel}
            </button>
            <button type="submit" disabled={!matches || busy} className={dangerButtonClass}>
              {busy ? s.clearing : s.confirm}
            </button>
          </div>
        </form>
      </BottomSheet>
    </SettingsSection>
  )
}
