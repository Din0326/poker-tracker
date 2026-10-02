import { useEffect, useState, type ReactNode } from 'react'
import { DB_VERSION, createSettingsRepo, inspectBeforeUpgrade, type LegacyData, type PokerDb, type PreUpgradeInspection } from '../db'
import { strings } from '../strings'
import { DbUpgradePrompt } from './DbUpgradePrompt'

type Status =
  | { kind: 'inspecting' }
  | { kind: 'prompt'; dexieVersion: number; data: LegacyData }
  | { kind: 'opening' }
  | { kind: 'ready' }
  | { kind: 'failed' }

type Props = {
  db: PokerDb
  children: ReactNode
  /** 資料庫開啟（含升級）成功後呼叫一次；啟動時需要讀 Dexie 的工作（例如套用盈虧顏色）放這裡，避免提早觸發升級 */
  onReady?: () => void | Promise<void>
  /** 測試用：替換升級前的偵測 */
  inspect?: (name: string, targetDexieVersion: number) => Promise<PreUpgradeInspection>
}

/**
 * 3.7：App 啟動時先開啟資料庫（含遷移），完成後才渲染任何畫面。
 * 開啟前先以原生 IndexedDB 偵測（不觸發升級）：裝置上的資料庫為舊版且有資料時，先顯示升級前的備份提示
 * （3.7「升級前的備份提示」，v1.6），使用者選【先匯出備份】→【繼續更新】或【直接更新】後才開啟並升級。
 * 開啟或遷移失敗時 Dexie 已回滾，資料維持原版本；此時只顯示錯誤狀態，不進入任何可寫入的畫面。
 */
export function DbGate({ db, children, onReady, inspect = inspectBeforeUpgrade }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'inspecting' })
  // 使用者選擇繼續（或不需要提示）後才設定，觸發開啟；null 代表尚未要開啟
  const [openRequest, setOpenRequest] = useState<{ backupExportedAt: string | null } | null>(null)
  const proceed = (backupExportedAt: string | null) => {
    setStatus({ kind: 'opening' })
    setOpenRequest({ backupExportedAt })
  }

  useEffect(() => {
    let cancelled = false
    void inspect(db.name, DB_VERSION).then((r) => {
      if (cancelled) return
      if (r.kind === 'oldWithData') setStatus({ kind: 'prompt', dexieVersion: r.dexieVersion, data: r.data })
      else {
        // 全新安裝、已是最新版、舊版沒有資料、偵測失敗：不提示，直接開啟（行為與 v1.5 相同）
        setStatus({ kind: 'opening' })
        setOpenRequest({ backupExportedAt: null })
      }
    })
    return () => {
      cancelled = true
    }
  }, [db, inspect])

  useEffect(() => {
    if (!openRequest) return
    let cancelled = false
    db.open().then(
      async () => {
        // 升級前匯出的備份：升級成功後才把 lastBackupAt 寫入新版資料庫（舊資料庫在升級前不寫入）
        if (openRequest.backupExportedAt !== null) {
          await createSettingsRepo(db)
            .set('lastBackupAt', openRequest.backupExportedAt)
            .catch(() => undefined)
        }
        if (cancelled) return
        // 等啟動工作完成再渲染 App（例如盈虧顏色先套用，避免畫面先以預設顏色閃一下）
        await Promise.resolve(onReady?.()).catch(() => undefined)
        if (!cancelled) setStatus({ kind: 'ready' })
      },
      () => !cancelled && setStatus({ kind: 'failed' }),
    )
    return () => {
      cancelled = true
    }
    // onReady 只在開啟成功時呼叫一次，不因父元件重新渲染而重新開啟
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, openRequest])

  if (status.kind === 'ready') return children
  if (status.kind === 'failed') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-(--page-max-width) flex-col items-center justify-center px-6 text-center">
        <p role="alert" data-testid="db-upgrade-failed" className="text-lg">
          {strings.dbUpgrade.failed}
        </p>
      </main>
    )
  }
  if (status.kind === 'prompt') {
    return (
      <DbUpgradePrompt dexieVersion={status.dexieVersion} data={status.data} onProceed={proceed} />
    )
  }
  return (
    <p role="status" className="py-10 text-center text-(--color-text-muted)">
      {strings.common.loading}
    </p>
  )
}
