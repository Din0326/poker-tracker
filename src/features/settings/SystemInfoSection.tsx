import { useEffect, useState } from 'react'
import { formatTimestamp } from '../../domain'
import { getRunMode, requestPersistentStorage } from '../../lib/platform'
import { strings } from '../../strings'
import { SettingsSection, cardClass } from './SettingsSection'

const t = strings.settings

// 8.8 資料與系統資訊：執行模式（第 2 節）、持久儲存結果、資料量、上次備份時間、App 版本號
export function SystemInfoSection({
  sessionCount,
  venueCount,
  stakeCount,
  lastBackupAt,
}: {
  sessionCount: number
  venueCount: number
  stakeCount: number
  lastBackupAt: string | undefined
}) {
  // 啟動時已申請（main.tsx），這裡取同一個結果；取得前顯示 —
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void requestPersistentStorage().then((v) => !cancelled && setPersisted(v))
    return () => {
      cancelled = true
    }
  }, [])

  const rows: { key: string; label: string; value: string }[] = [
    { key: 'run-mode', label: t.runMode, value: t.runModes[getRunMode()] },
    {
      key: 'persisted',
      label: t.persistentStorage,
      value: persisted === null ? strings.format.empty : persisted ? t.persisted : t.notPersisted,
    },
    { key: 'data-count', label: t.dataCount, value: t.dataCountValue(sessionCount, venueCount, stakeCount) },
    { key: 'last-backup', label: t.lastBackup, value: lastBackupAt ? formatTimestamp(lastBackupAt) : t.neverBackedUp },
    { key: 'version', label: t.appVersion, value: __APP_VERSION__ },
  ]

  return (
    <SettingsSection id="settings-system" title={t.systemSection}>
      <dl className={`${cardClass} px-4`}>
        {rows.map((r) => (
          <div
            key={r.key}
            data-testid={`info-${r.key}`}
            className="flex min-h-12 items-center justify-between gap-3 border-b border-(--color-border) py-2 last:border-b-0"
          >
            <dt className="shrink-0 text-(--color-text-muted)">{r.label}</dt>
            <dd className="num min-w-0 text-right break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  )
}
