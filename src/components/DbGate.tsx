import { useEffect, useState, type ReactNode } from 'react'
import type { PokerDb } from '../db'
import { strings } from '../strings'

type Status = 'opening' | 'ready' | 'failed'

/**
 * 3.7：App 啟動時先開啟資料庫（含 version 1 → 2 的遷移），完成後才渲染任何畫面。
 * 開啟或遷移失敗時 Dexie 已回滾，資料維持原版本；此時只顯示錯誤狀態，不進入任何可寫入的畫面。
 */
export function DbGate({ db, children }: { db: PokerDb; children: ReactNode }) {
  const [status, setStatus] = useState<Status>('opening')

  useEffect(() => {
    let cancelled = false
    db.open().then(
      () => !cancelled && setStatus('ready'),
      () => !cancelled && setStatus('failed'),
    )
    return () => {
      cancelled = true
    }
  }, [db])

  if (status === 'ready') return children
  if (status === 'failed') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-(--page-max-width) flex-col items-center justify-center px-6 text-center">
        <p role="alert" data-testid="db-upgrade-failed" className="text-lg">
          {strings.dbUpgrade.failed}
        </p>
      </main>
    )
  }
  return (
    <p role="status" className="py-10 text-center text-(--color-text-muted)">
      {strings.common.loading}
    </p>
  )
}
