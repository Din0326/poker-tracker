import { useRef, useState, type ChangeEvent } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import {
  backupFileName,
  buildBackup,
  buildSessionsCsv,
  csvFileName,
  formatTimestamp,
  parseBackupText,
  serializeBackup,
  type BackupError,
  type BackupFile,
} from '../../domain'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { DEFAULT_PROFIT_SCHEME } from '../../lib/profitScheme'
import { exportFile } from '../../lib/shareFile'
import { strings } from '../../strings'
import { describeBackupError } from './backupErrorText'
import { loadAllData, replaceAllData, resetAppState } from './dataTransfer'
import { ERROR_TOAST_MS, SUCCESS_TOAST_MS } from './manageShared'
import { SettingsSection, cardClass } from './SettingsSection'

const t = strings.settings

export const BACKUP_SECTION_ID = 'settings-backup'

type Busy = 'json' | 'csv' | 'import' | null
type PendingImport = { backup: BackupFile; currentCount: number }

const toast = (text: string, ok: boolean) =>
  showGlobalToast({ text, durationMs: ok ? SUCCESS_TOAST_MS : ERROR_TOAST_MS })

// 8.4 匯出 JSON、8.5 匯入 JSON、8.6 匯出 CSV，並顯示上次備份時間
export function BackupSection({ lastBackupAt, onChanged }: { lastBackupAt: string | undefined; onChanged: () => void }) {
  const { db, repos } = useAppData()
  const [busy, setBusy] = useState<Busy>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [importError, setImportError] = useState<BackupError | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // ---- 8.4 匯出 JSON：分享完成或下載觸發後更新 lastBackupAt（= exportedAt）；分享取消不更新、不提示 ----
  const exportJson = async () => {
    if (busy) return
    setBusy('json')
    try {
      const now = new Date()
      const backup = buildBackup(await loadAllData(db), now)
      const file = new File([serializeBackup(backup)], backupFileName(now), { type: 'application/json' })
      const outcome = await exportFile(file)
      if (outcome === 'cancelled') return
      await repos.settings.set('lastBackupAt', backup.exportedAt)
      toast(t.exported, true)
      onChanged()
    } catch {
      toast(t.exportFailed, false)
    } finally {
      setBusy(null)
    }
  }

  // ---- 8.6 匯出 CSV：匯出方式同 JSON；不更新 lastBackupAt ----
  const exportCsv = async () => {
    if (busy) return
    setBusy('csv')
    try {
      const now = new Date()
      const data = await loadAllData(db)
      const file = new File([buildSessionsCsv(data.sessions, data.venues, data.stakes)], csvFileName(now), {
        type: 'text/csv',
      })
      const outcome = await exportFile(file)
      if (outcome !== 'cancelled') toast(t.exportedCsv, true)
    } catch {
      toast(t.exportFailed, false)
    } finally {
      setBusy(null)
    }
  }

  // ---- 8.5 匯入：選檔 → 驗證 → 確認 → 完整取代 ----
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 清空選取，同一個檔案再次選取時仍會觸發 change
    e.target.value = ''
    if (!file || busy) return
    setBusy('import')
    try {
      let text: string
      try {
        text = await file.text()
      } catch {
        toast(t.importReadFailed, false)
        return
      }
      const result = parseBackupText(text)
      if (!result.ok) {
        setImportError(result.error)
        return
      }
      setPending({ backup: result.backup, currentCount: await db.sessions.count() })
    } catch {
      toast(t.importFailed, false)
    } finally {
      setBusy(null)
    }
  }

  const confirmImport = async () => {
    if (!pending || busy) return
    setBusy('import')
    const { backup } = pending
    try {
      await replaceAllData(db, backup)
      resetAppState(backup.settings.profitColorScheme ?? DEFAULT_PROFIT_SCHEME)
      setPending(null)
      toast(t.imported(backup.sessions.length), true)
      onChanged()
    } catch {
      setPending(null)
      toast(t.importFailed, false)
    } finally {
      setBusy(null)
    }
  }

  const errorText = importError ? describeBackupError(importError) : null
  const s = t.importSheet

  return (
    <SettingsSection id={BACKUP_SECTION_ID} title={t.backupSection}>
      <div className={`${cardClass} px-4 py-3`}>
        <p className="text-sm text-(--color-text-muted)">{t.backupHint}</p>
        <p className="mt-2 flex justify-between gap-3 text-sm">
          <span className="text-(--color-text-muted)">{t.lastBackup}</span>
          <span className="num" data-testid="last-backup">
            {lastBackupAt ? formatTimestamp(lastBackupAt) : t.neverBackedUp}
          </span>
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void exportJson()} className={primaryButtonClass}>
            {busy === 'json' ? t.exporting : t.exportJson}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
            className={secondaryButtonClass}
          >
            {t.importJson}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            tabIndex={-1}
            aria-hidden="true"
            data-testid="import-file"
            onChange={(e) => void onFile(e)}
          />
          <button type="button" disabled={busy !== null} onClick={() => void exportCsv()} className={secondaryButtonClass}>
            {busy === 'csv' ? t.exporting : t.exportCsv}
          </button>
        </div>
      </div>

      <BottomSheet open={pending !== null} title={s.title} onClose={() => busy === null && setPending(null)}>
        {pending && (
          <>
            <div className="grid grid-cols-2 gap-3" data-testid="import-compare">
              <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) px-3 py-2">
                <p className="text-sm text-(--color-text-muted)">{s.current}</p>
                <p className="num mt-1 text-lg font-semibold" data-testid="import-current-count">
                  {s.sessionCount(pending.currentCount)}
                </p>
              </div>
              <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) px-3 py-2">
                <p className="text-sm text-(--color-text-muted)">{s.backup}</p>
                <p className="num mt-1 text-lg font-semibold" data-testid="import-backup-count">
                  {s.sessionCount(pending.backup.sessions.length)}
                </p>
                <p className="num mt-1 text-xs text-(--color-text-muted)" data-testid="import-backup-time">
                  {s.backupTime(formatTimestamp(pending.backup.exportedAt))}
                </p>
              </div>
            </div>
            <p role="note" className="mt-3 text-sm font-semibold text-(--color-danger)">
              {s.warning}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" disabled={busy !== null} onClick={() => setPending(null)} className={secondaryButtonClass}>
                {strings.common.cancel}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void confirmImport()} className={dangerButtonClass}>
                {busy === 'import' ? s.importing : s.confirm}
              </button>
            </div>
          </>
        )}
      </BottomSheet>

      <BottomSheet open={errorText !== null} title={t.importError.title} onClose={() => setImportError(null)}>
        {errorText && (
          <div role="alert">
            <p className="font-semibold" data-testid="import-error-reason">
              {errorText.reason}
            </p>
            {errorText.detail && (
              <p className="num mt-2 text-sm break-words text-(--color-danger)" data-testid="import-error-detail">
                {errorText.detail}
              </p>
            )}
            <p className="mt-2 text-sm text-(--color-text-muted)">{t.importError.unchanged}</p>
          </div>
        )}
        <button type="button" onClick={() => setImportError(null)} className={`${secondaryButtonClass} mt-4 w-full`}>
          {strings.common.confirm}
        </button>
      </BottomSheet>
    </SettingsSection>
  )
}
