import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { shouldShowBackupReminder, type Session } from '../../domain'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'
import { refreshHands, useHandsState } from '../hands/handsStore'
import type { SettingsLocationState } from '../settings/SettingsPage'

const t = strings.backupReminder

// 按 ✕ 後關閉到下次開啟 App（只存在記憶體）
let dismissedThisLaunch = false

const settingsState: SettingsLocationState = { focus: 'backup' }

// 8.7 報表頁頂端的備份提醒條「建議備份資料 · 前往備份」；「前往備份」導到設定頁並捲到資料備份區塊
export function BackupReminder({ sessions }: { sessions: readonly Pick<Session, 'updatedAt'>[] }) {
  const { repos } = useAppData()
  const [dismissed, setDismissed] = useState(dismissedThisLaunch)
  // undefined 代表從未備份；讀取完成前（loaded 為 false）不顯示
  const [lastBackup, setLastBackup] = useState<{ loaded: boolean; value: string | undefined }>({ loaded: false, value: undefined })
  // v2 10.5：觸發條件納入手牌，只需要每手的 updatedAt。改讀手牌列表的輕量快取（不含 detail、rawText，
  // 同時供手牌列表使用），不另外把全部手牌的完整資料讀進記憶體；快取讀取完成前不顯示
  const handsState = useHandsState()

  useEffect(() => {
    let cancelled = false
    repos.settings.get('lastBackupAt').then(
      (value) => !cancelled && setLastBackup({ loaded: true, value }),
      () => undefined,
    )
    void refreshHands(repos)
    return () => {
      cancelled = true
    }
  }, [repos])

  if (dismissed || !lastBackup.loaded || handsState.status !== 'ready') return null
  if (!shouldShowBackupReminder({ sessions, hands: handsState.hands, lastBackupAt: lastBackup.value, now: new Date() })) {
    return null
  }

  const dismiss = () => {
    dismissedThisLaunch = true
    setDismissed(true)
  }

  return (
    <div
      role="note"
      aria-label={t.label}
      data-testid="backup-reminder"
      className="mt-2 flex items-center gap-1 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) py-1 pl-4 pr-1 text-sm"
    >
      <p className="flex-1">{t.message}</p>
      <Link
        to="/settings"
        state={settingsState}
        className="flex min-h-(--touch-min) shrink-0 items-center rounded-(--radius-control) px-2 font-semibold text-(--color-accent)"
      >
        {t.action}
      </Link>
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
