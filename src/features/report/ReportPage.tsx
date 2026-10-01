import { ChevronRight } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Page } from '../../components/Page'
import { CustomRangeFields, PeriodSelect } from '../../components/PeriodPicker'
import { SegmentedControl } from '../../components/SegmentedControl'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { sessionTypeIcons } from '../../components/sessionTypeIcons'
import {
  filterByRange,
  resolvePeriod,
  selectionToFilter,
  toLocalDate,
  type PeriodSelection,
  type SessionType,
} from '../../domain'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'
import { buildSessionsListPath } from '../sessions/listUrl'
import { buildLookup, profitColorClass } from '../sessions/sessionView'
import { refreshSessions, retrySessions, useSessionsState } from '../sessions/sessionsStore'
import { BackupReminder } from './BackupReminder'
import { GroupStats } from './GroupStats'
import { GROUP_OPTIONS_BY_TAB, buildGroups, type GroupBy, type GroupRow } from './grouping'
import { ProfitCurve } from './ProfitCurve'
import { reportMemory } from './reportMemory'
import {
  REPORT_TABS,
  buildCurve,
  buildMetricCards,
  buildTypeBreakdown,
  filterByTab,
  tabLabel,
  type MetricCard,
  type ReportTab,
  type TypeBreakdownRow,
} from './reportModel'

const t = strings.report
const tabOptions = REPORT_TABS.map((value) => ({ value, label: tabLabel(value) }))

// 6.2 指標卡：雙欄格狀，第一張（盈利）橫跨整列並加大字級
const MetricCards = memo(function MetricCards({ cards }: { cards: MetricCard[] }) {
  return (
    <section aria-label={t.metricsLabel} className="mt-4 grid grid-cols-2 gap-2" data-testid="metric-cards">
      {cards.map((card, i) => {
        const hero = i === 0
        return (
          <div
            key={card.key}
            data-testid="metric-card"
            data-metric={card.key}
            className={`min-w-0 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 py-2.5 ${
              hero ? 'col-span-2' : ''
            }`}
          >
            <p data-testid="metric-label" className="text-xs text-(--color-text-muted)">
              {card.label}
            </p>
            <p
              data-testid="metric-value"
              className={`num mt-0.5 font-semibold break-words ${hero ? 'text-3xl' : 'text-base'} ${profitColorClass(card.value.tone)}`}
            >
              {card.value.text}
            </p>
          </div>
        )
      })}
    </section>
  )
})

// 6.2 總體頁小表：三種類型的場次數與盈利，整列點擊切換到該類型頁籤（期間不變）
function TypeBreakdown({ rows, onSelect }: { rows: TypeBreakdownRow[]; onSelect: (type: SessionType) => void }) {
  return (
    <section aria-label={t.breakdown.label} className="mt-2">
      <ul className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)">
        {rows.map((row) => {
          const Icon = sessionTypeIcons[row.type]
          const name = strings.sessionTypes[row.type]
          return (
            <li key={row.type} className="border-b border-(--color-border) last:border-b-0">
              <button
                type="button"
                data-testid="type-breakdown-row"
                data-type={row.type}
                onClick={() => onSelect(row.type)}
                className="flex min-h-12 w-full items-center gap-3 px-3 text-left"
              >
                <Icon aria-hidden="true" size={20} className="shrink-0 text-(--color-text-muted)" />
                <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
                <span data-testid="breakdown-count" className="num shrink-0 text-sm text-(--color-text-muted)">
                  {t.breakdown.count(row.count)}
                </span>
                <span
                  data-testid="breakdown-profit"
                  className={`num w-28 shrink-0 text-right font-semibold ${profitColorClass(row.profit.tone)}`}
                >
                  {row.profit.text}
                </span>
                <ChevronRight aria-hidden="true" size={18} className="-mr-1 shrink-0 text-(--color-text-muted)" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// 報表（第 6 節）：分類頁籤、期間篩選、指標卡、累積盈利曲線、分組統計。
// 資料來自紀錄列表共用的記憶體快取（sessionsStore），所有計算在記憶體內以 useMemo 快取（6.6）。
export function ReportPage() {
  const { repos } = useAppData()
  const navigate = useNavigate()
  const state = useSessionsState()

  // ---- 頁籤、期間、分組依據：App 開啟期間保留（6.1） ----
  const [tab, setTab] = useState<ReportTab>(reportMemory.tab)
  const [period, setPeriod] = useState<PeriodSelection>(reportMemory.period)
  const [groupByChoice, setGroupByChoice] = useState<GroupBy | null>(reportMemory.groupBy)
  useEffect(() => {
    reportMemory.tab = tab
    reportMemory.period = period
    reportMemory.groupBy = groupByChoice
  }, [tab, period, groupByChoice])

  const groupOptions = GROUP_OPTIONS_BY_TAB[tab]
  const groupBy: GroupBy =
    groupByChoice !== null && groupOptions.includes(groupByChoice) ? groupByChoice : groupOptions[0]!

  const selectTab = useCallback((next: ReportTab) => {
    setTab(next)
    // 切換頁籤時分組依據重設為該頁籤的第一個選項
    setGroupByChoice(null)
  }, [])

  // ---- 資料：先顯示記憶體快取，背景重新讀取 ----
  useEffect(() => {
    void refreshSessions(repos)
  }, [repos])

  const data = state.status === 'ready' ? state.data : null
  const lookup = useMemo(() => (data ? buildLookup(data.venues, data.stakes) : null), [data])
  const today = toLocalDate(new Date())
  // 自訂期間起迄未填齊或起日晚於迄日時不套用期間（與紀錄列表相同）
  const periodResult = useMemo(() => resolvePeriod(selectionToFilter(period), today), [period, today])
  const inPeriod = useMemo(() => {
    if (!data) return []
    return periodResult.ok ? filterByRange(data.sessions, periodResult.range) : data.sessions
  }, [data, periodResult])
  const sessions = useMemo(() => filterByTab(inPeriod, tab), [inPeriod, tab])

  const stakeLookup = lookup?.stakes
  const cards = useMemo(
    () => (stakeLookup ? buildMetricCards(sessions, tab, stakeLookup) : []),
    [sessions, tab, stakeLookup],
  )
  const breakdown = useMemo(() => (tab === 'all' ? buildTypeBreakdown(inPeriod) : []), [tab, inPeriod])
  const curve = useMemo(() => buildCurve(sessions), [sessions])
  const groups = useMemo(
    () => (lookup ? buildGroups(sessions, tab, groupBy, lookup, lookup.stakes) : []),
    [sessions, tab, groupBy, lookup],
  )

  const openGroup = useCallback(
    (row: GroupRow) => {
      void navigate(
        buildSessionsListPath({
          type: tab,
          // 期間未套用（自訂未填齊或不合法）時報表顯示全部期間，列表也用全部
          period: periodResult.ok ? selectionToFilter(period) : { kind: 'all' },
          ...row.link,
        }),
      )
    },
    [navigate, tab, period, periodResult],
  )

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
        <button type="button" onClick={() => retrySessions(repos)} className={secondaryButtonClass}>
          {strings.common.retry}
        </button>
      </div>
    )
  } else if (state.data.sessions.length === 0) {
    // 6.5 完全沒有紀錄
    body = (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{strings.sessions.empty.noRecords}</p>
        <Link to="/" className={primaryButtonClass}>
          {strings.sessions.empty.addFirst}
        </Link>
      </div>
    )
  } else {
    const empty = sessions.length === 0
    body = (
      <div data-testid="report-content" data-tab={tab}>
        <div className="mt-2 space-y-3">
          <SegmentedControl label={t.tabsLabel} options={tabOptions} value={tab} onChange={selectTab} testId="report-tabs" />
          <div className="grid grid-cols-[8.5rem_1fr]">
            <PeriodSelect idPrefix="rp" value={period.period} onChange={(p) => setPeriod((s) => ({ ...s, period: p }))} />
          </div>
          {period.period === 'custom' && (
            <CustomRangeFields
              idPrefix="rp"
              value={period}
              onChange={(patch) => setPeriod((s) => ({ ...s, ...patch }))}
              error={periodResult.ok ? null : periodResult.error}
            />
          )}
        </div>

        <MetricCards cards={cards} />
        {tab === 'all' && <TypeBreakdown rows={breakdown} onSelect={selectTab} />}

        <section aria-labelledby="rp-curve-title" className="mt-6">
          <h2 id="rp-curve-title" className="px-1 pb-2 text-sm font-semibold text-(--color-text-muted)">
            {t.curve.title}
          </h2>
          <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-1 py-3">
            {empty ? (
              <p data-testid="curve-no-records" className="py-10 text-center text-sm text-(--color-text-muted)">
                {t.noRecordsInPeriod}
              </p>
            ) : (
              <ProfitCurve points={curve} />
            )}
          </div>
        </section>

        <GroupStats tab={tab} groupBy={groupBy} onGroupByChange={setGroupByChoice} rows={groups} onOpen={openGroup} />
      </div>
    )
  }

  return (
    <Page title={strings.pages.report}>
      {/* 8.7 備份提醒條：報表頁頂端 */}
      {data && <BackupReminder sessions={data.sessions} />}
      {body}
    </Page>
  )
}
