import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Page } from '../../components/Page'
import { secondaryButtonClass } from '../../components/controlStyles'
import type { ProfitColorScheme } from '../../domain'
import { useAppData } from '../../lib/appData'
import { DEFAULT_PROFIT_SCHEME } from '../../lib/profitScheme'
import { strings } from '../../strings'
import { BACKUP_SECTION_ID, BackupSection } from './BackupSection'
import { ClearDataSection } from './ClearDataSection'
import { DevSeedSection } from './DevSeedSection'
import { DisplaySection } from './DisplaySection'
import { SettingsSection, cardClass } from './SettingsSection'
import { SystemInfoSection } from './SystemInfoSection'

interface SettingsInfo {
  sessionCount: number
  venueCount: number
  stakeCount: number
  lastBackupAt: string | undefined
  profitColorScheme: ProfitColorScheme
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; info: SettingsInfo }

/** 其他頁面導到設定頁時，以 location.state 指定要捲到的區塊（8.7「前往備份」） */
export interface SettingsLocationState {
  focus?: 'backup'
}

// 設定（第 8 節），由上到下：常用清單 → 顯示設定 → 資料備份 → 資料與系統資訊 → 開發工具（僅 DEV）→ 清除所有資料
export function SettingsPage() {
  const { db, repos } = useAppData()
  const location = useLocation()
  const focus = (location.state as SettingsLocationState | null)?.focus
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // 匯入後遞增，讓顯示設定以新的設定值重新建立
  const [dataVersion, setDataVersion] = useState(0)

  const fetchInfo = useCallback(async (): Promise<SettingsInfo> => {
    const [sessionCount, venueCount, stakeCount, lastBackupAt, profitColorScheme] = await Promise.all([
      db.sessions.count(),
      db.venues.count(),
      db.stakes.count(),
      repos.settings.get('lastBackupAt'),
      repos.settings.get('profitColorScheme'),
    ])
    return { sessionCount, venueCount, stakeCount, lastBackupAt, profitColorScheme: profitColorScheme ?? DEFAULT_PROFIT_SCHEME }
  }, [db, repos])
  // 讀取失敗時：已有資料則保留，否則顯示錯誤狀態
  const applyInfo = useCallback(
    (p: Promise<SettingsInfo>) =>
      p.then(
        (info) => setState({ status: 'ready', info }),
        () => setState((s) => (s.status === 'ready' ? s : { status: 'error' })),
      ),
    [],
  )
  const load = useCallback(() => applyInfo(fetchInfo()), [applyInfo, fetchInfo])

  useEffect(() => {
    void applyInfo(fetchInfo())
  }, [applyInfo, fetchInfo])

  // 8.7：從報表提醒條「前往備份」進入時，內容載入後捲到資料備份區塊
  const ready = state.status === 'ready'
  useEffect(() => {
    if (!ready || focus !== 'backup') return
    document.getElementById(BACKUP_SECTION_ID)?.scrollIntoView({ block: 'start' })
  }, [ready, focus, location.key])

  let body
  if (state.status === 'loading') {
    body = (
      <p role="status" className="py-10 text-center text-(--color-text-muted)">
        {strings.common.loading}
      </p>
    )
  } else if (state.status === 'error') {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p>{strings.common.loadFailed}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: 'loading' })
            void load()
          }}
          className={secondaryButtonClass}
        >
          {strings.common.retry}
        </button>
      </div>
    )
  } else {
    const { info } = state
    const links = [
      { to: '/settings/venues', label: strings.pages.venues, count: info.venueCount },
      { to: '/settings/stakes', label: strings.pages.stakes, count: info.stakeCount },
    ]
    body = (
      <>
        <SettingsSection id="settings-lists" title={strings.settings.listsSection}>
          <ul className={`overflow-hidden ${cardClass}`}>
            {links.map(({ to, label, count }) => (
              <li key={to} className="border-b border-(--color-border) last:border-b-0">
                <Link to={to} className="flex min-h-12 items-center gap-2 px-4">
                  <span className="flex-1">{label}</span>
                  <span className="num text-sm text-(--color-text-muted)">{strings.settings.itemCount(count)}</span>
                  <ChevronRight aria-hidden="true" size={20} className="text-(--color-text-muted)" />
                </Link>
              </li>
            ))}
          </ul>
        </SettingsSection>
        <DisplaySection key={dataVersion} initial={info.profitColorScheme} />
        <BackupSection
          lastBackupAt={info.lastBackupAt}
          onChanged={() => void load().then(() => setDataVersion((v) => v + 1))}
        />
        <SystemInfoSection
          sessionCount={info.sessionCount}
          venueCount={info.venueCount}
          stakeCount={info.stakeCount}
          lastBackupAt={info.lastBackupAt}
        />
        {/* 11.1：開發模式才出現的 seed 按鈕；正式建置時此分支為 false 而被移除 */}
        {import.meta.env.DEV && <DevSeedSection />}
        <ClearDataSection />
      </>
    )
  }

  return <Page title={strings.pages.settings}>{body}</Page>
}
