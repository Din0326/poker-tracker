import { CircleCheck, DatabaseBackup } from 'lucide-react'
import { useState } from 'react'
import type { LegacyData } from '../db/preUpgrade'
import { backupFileName, backupSchemaForDbVersion, buildLegacyBackup, serializeBackup } from '../domain/backup'
import { exportFile } from '../lib/shareFile'
import { strings } from '../strings'
import { primaryButtonClass, secondaryButtonClass } from './controlStyles'

const t = strings.dbUpgrade.prompt

type Props = {
  /** 舊資料庫的 Dexie 版本（原生版本 ÷ 10），決定備份的 schemaVersion */
  dexieVersion: number
  /** 提示畫面顯示前已讀出的升級前原始資料 */
  data: LegacyData
  /** 繼續升級；backupExportedAt 為這次匯出成功的備份 exportedAt（沒有匯出時為 null） */
  onProceed: (backupExportedAt: string | null) => void
  /** 測試用：注入現在時間 */
  now?: () => Date
}

type ExportState = { kind: 'idle' } | { kind: 'exporting' } | { kind: 'done'; exportedAt: string }

const systemNow = () => new Date()

/**
 * 3.7「升級前的備份提示」（v1.6）：舊版且有資料的資料庫在升級之前顯示的全畫面提示。
 * 【先匯出備份】匯出升級前的原始資料（schemaVersion 對應舊資料庫結構，8.4「升級前的備份」）；
 * 【直接更新】不備份直接升級。分享完成或下載觸發後顯示「已備份」並出現【繼續更新】。
 */
export function DbUpgradePrompt({ dexieVersion, data, onProceed, now = systemNow }: Props) {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const schemaVersion = backupSchemaForDbVersion(dexieVersion)
  const busy = state.kind === 'exporting'
  const done = state.kind === 'done'

  /**
   * 8.4 iOS 使用者手勢：資料在提示畫面顯示前就已讀出，click 的同步路徑中組出檔案並呼叫 exportFile
   * （其內同步呼叫 navigator.share），之前沒有任何 await。分享取消不視為已備份、不顯示錯誤。
   */
  const exportBackup = () => {
    if (busy || schemaVersion === null) return
    let job: Promise<'shared' | 'downloaded' | 'cancelled'>
    let exportedAt: string
    try {
      const date = now()
      const backup = buildLegacyBackup(data, schemaVersion, date)
      exportedAt = backup.exportedAt as string
      job = exportFile(new File([serializeBackup(backup)], backupFileName(date), { type: 'application/json' }))
    } catch {
      setError(strings.settings.exportFailed)
      return
    }
    const previous = state
    setError(null)
    setState({ kind: 'exporting' })
    void job.then(
      (outcome) => setState(outcome === 'cancelled' ? previous : { kind: 'done', exportedAt }),
      (err: unknown) => {
        setState(previous)
        setError(err instanceof DOMException && err.name === 'NotAllowedError' ? strings.settings.exportRetry : strings.settings.exportFailed)
      },
    )
  }

  const summary = strings.settings.dataCountValue(data.sessions.length, data.venues.length, data.stakes.length)
  const handsText =
    data.hands.length > 0
      ? strings.settings.handCountValue(
          data.hands.length,
          data.hands.filter((h) => h.kind === 'complete').length,
          data.hands.filter((h) => h.kind !== 'complete').length,
        )
      : null

  return (
    <main
      data-testid="db-upgrade-prompt"
      aria-labelledby="db-upgrade-title"
      className="mx-auto flex min-h-dvh max-w-(--page-max-width) flex-col justify-center px-4 pt-[calc(env(safe-area-inset-top)+24px)] pb-[calc(env(safe-area-inset-bottom)+24px)]"
    >
      <DatabaseBackup aria-hidden="true" size={40} className="mx-auto text-(--color-accent)" />
      <h1 id="db-upgrade-title" className="mt-4 text-center text-xl font-bold">
        {t.title}
      </h1>
      <p className="mt-3 text-(--color-text-muted)">{t.body}</p>

      <div className="mt-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-4 py-3 text-sm">
        <p className="text-(--color-text-muted)">{t.dataLabel}</p>
        <p className="num mt-1 font-semibold" data-testid="db-upgrade-data-count">
          {handsText ? `${summary} · ${handsText}` : summary}
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {schemaVersion !== null && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={exportBackup}
              disabled={busy}
              aria-busy={busy}
              className={done ? secondaryButtonClass : primaryButtonClass}
            >
              {busy ? t.exporting : done ? t.exportAgain : t.exportBackup}
            </button>
            {done && (
              <p role="status" data-testid="db-upgrade-backed-up" className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                <CircleCheck aria-hidden="true" size={18} className="text-(--color-accent)" />
                {t.backedUp}
              </p>
            )}
            {error && (
              <p role="alert" className="text-center text-sm text-(--color-danger)">
                {error}
              </p>
            )}
          </div>
        )}
        {done ? (
          <button type="button" onClick={() => onProceed(state.exportedAt)} className={primaryButtonClass}>
            {t.continue}
          </button>
        ) : (
          <button type="button" onClick={() => onProceed(null)} disabled={busy} className={secondaryButtonClass}>
            {t.skip}
          </button>
        )}
      </div>
    </main>
  )
}
