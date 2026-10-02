import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Page } from '../../components/Page'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { toLocalDate } from '../../domain'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'
import { buildLookup, rowDate, sessionTitle } from '../sessions/sessionView'
import { HandExportSheet } from './HandExportSheet'
import { HandFilterBar } from './HandFilterBar'
import { HandList } from './HandList'
import {
  DEFAULT_HAND_FILTERS,
  applyHandFilters,
  groupHandsByMonth,
  isFilteringHands,
  summarizeHandCount,
  tagFilterOptions,
  type HandListFilters,
} from './handListModel'
import { exportRequestFor, type ExportRequest } from './handExportModel'
import { HAND_BATCH_SIZE, memoryFor, rememberFilters, rememberVisible } from './handsListMemory'
import { HANDS_PATH, handNewPath, sessionIdFromSearch } from './handPaths'
import { refreshHands, retryHands, useHandsState } from './handsStore'

const t = strings.hands.list
const KEYWORD_DEBOUNCE_MS = 200

const headerActionClass =
  'flex min-h-(--touch-min) min-w-(--touch-min) items-center justify-center rounded-(--radius-control) px-2 font-semibold whitespace-nowrap text-(--color-accent)'

/**
 * 標題列右上角（6.1）：「＋ 新增手牌」（不關聯場次）與「匯出」（7.1：匯出目前篩選結果中的完整手牌）。
 * 「匯出」只在列表有手牌時顯示；「匯入」於 H4 實作匯入頁時加入。
 */
function HeaderActions({ onExport }: { onExport: (() => void) | null }) {
  return (
    <div className="flex items-center">
      <Link to={handNewPath()} className={headerActionClass}>
        {strings.hands.addHand}
      </Link>
      {onExport && (
        <button type="button" onClick={onExport} aria-label={strings.hands.export.listButtonLabel} className={headerActionClass}>
          {strings.hands.export.listButton}
        </button>
      )}
    </div>
  )
}

/** 場次標籤的文字「09/27 6bet」（日期、標題規則同 v1 7.1）；讀取失敗或場次不存在時為「（找不到）」 */
function useSessionLabel(sessionId: string | null): string | null {
  const { repos } = useAppData()
  const [label, setLabel] = useState<{ id: string; text: string } | null>(null)
  useEffect(() => {
    if (sessionId === null) return
    let cancelled = false
    Promise.all([repos.sessions.get(sessionId), repos.venues.list(), repos.stakes.list()]).then(
      ([session, venues, stakes]) => {
        if (cancelled) return
        const text = session ? t.filters.sessionLabel(rowDate(session), sessionTitle(session, buildLookup(venues, stakes))) : t.filters.unknownSession
        setLabel({ id: sessionId, text })
      },
      () => !cancelled && setLabel({ id: sessionId, text: t.filters.unknownSession }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, sessionId])
  if (sessionId === null) return null
  return t.filters.sessionTag(label?.id === sessionId ? label.text : strings.common.loading)
}

/** 路由元件：以場次篩選作為 key，「手牌」頁籤與場次子頁各自是獨立的列表狀態 */
export function HandsRoute() {
  const { search } = useLocation()
  const sessionId = sessionIdFromSearch(search)
  return <HandsPage key={sessionId ?? ''} sessionId={sessionId} />
}

// 6.1 手牌列表（「手牌」頁籤的根畫面，5.1）。帶 ?sessionId= 時為從場次詳情推入的子頁：只列該場的手牌，
// 篩選與捲動不寫入頁籤記住的列表狀態，左上角返回鈕回到場次詳情
function HandsPage({ sessionId }: { sessionId: string | null }) {
  const { repos } = useAppData()
  const navigate = useNavigate()
  const state = useHandsState()

  // ---- 篩選條件：初始值取自記憶（切到其他頁籤再切回、從詳情返回時相同） ----
  const [filters, setFilters] = useState<HandListFilters>(() => memoryFor(sessionId).filters)
  const [keyword, setKeyword] = useState(filters.keyword)
  useEffect(() => {
    rememberFilters(sessionId, filters)
  }, [sessionId, filters])
  // 關鍵字輸入 debounce 200ms 後才套用（同紀錄列表）
  useEffect(() => {
    if (keyword === filters.keyword) return
    const timer = setTimeout(() => setKeyword(filters.keyword), KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filters.keyword, keyword])

  // ---- 資料：先顯示記憶體快取，背景重新讀取 ----
  useEffect(() => {
    void refreshHands(repos)
  }, [repos])

  const all = state.status === 'ready' ? state.hands : null
  const effective = useMemo(() => ({ ...filters, keyword }), [filters, keyword])
  const today = toLocalDate(new Date())
  const result = useMemo(() => applyHandFilters(all ?? [], effective, sessionId, today), [all, effective, sessionId, today])
  const groups = useMemo(() => groupHandsByMonth(result.hands), [result])
  const total = useMemo(() => summarizeHandCount(result.hands), [result])
  const tagOptions = useMemo(() => tagFilterOptions(all ?? []), [all])
  const sessionTag = useSessionLabel(sessionId)

  // ---- 分批載入：篩選條件相同時沿用記憶的筆數（從詳情返回時捲動位置可還原） ----
  const filterKey = JSON.stringify(effective)
  const [visible, setVisible] = useState(() => {
    const remembered = memoryFor(sessionId).visible
    return remembered && remembered.key === filterKey ? remembered : { key: filterKey, count: HAND_BATCH_SIZE }
  })
  let visibleCount = visible.count
  if (visible.key !== filterKey) {
    visibleCount = HAND_BATCH_SIZE
    setVisible({ key: filterKey, count: HAND_BATCH_SIZE })
  }
  useEffect(() => {
    rememberVisible(sessionId, visible)
  }, [sessionId, visible])
  const loadMore = useCallback(() => setVisible((v) => ({ key: v.key, count: v.count + HAND_BATCH_SIZE })), [])

  // ---- 7.1 匯出：範圍為目前的篩選結果（含場次篩選與已套用的關鍵字） ----
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null)
  const canExport = state.status === 'ready' && state.hands.length > 0
  const openExport = () => setExportRequest(exportRequestFor(result.hands))

  // ---- 操作 ----
  const changeFilters = (patch: Partial<HandListFilters>) => setFilters((f) => ({ ...f, ...patch }))
  // 移除場次標籤、清除篩選：回到「手牌」頁籤的列表（不帶場次篩選）
  const removeSessionTag = () => void navigate(HANDS_PATH, { replace: true })
  const clearFilters = () => {
    setFilters(DEFAULT_HAND_FILTERS)
    setKeyword('')
    if (sessionId !== null) void navigate(HANDS_PATH, { replace: true })
  }

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
        <button type="button" onClick={() => retryHands(repos)} className={secondaryButtonClass}>
          {strings.common.retry}
        </button>
      </div>
    )
  } else if (state.hands.length === 0) {
    // 6.1 空狀態：沒有任何手牌（「匯入 GG 手牌」於 H4 實作匯入頁時加入）
    body = (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{t.empty.noHands}</p>
        <Link to={handNewPath()} className={primaryButtonClass}>
          {t.empty.addFirst}
        </Link>
      </div>
    )
  } else {
    body = (
      <>
        <HandFilterBar
          filters={filters}
          onChange={changeFilters}
          tagOptions={tagOptions}
          sessionTag={sessionTag}
          onRemoveSessionTag={removeSessionTag}
          periodError={result.periodError}
          filtering={isFilteringHands(filters, sessionId)}
          onClear={clearFilters}
        />
        <p data-testid="hand-list-summary" className="num mt-3 px-1 text-sm font-semibold">
          {t.summary(total.count, total.complete)}
        </p>
        {result.hands.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <p>{t.empty.noMatch}</p>
            <button type="button" onClick={clearFilters} className={secondaryButtonClass}>
              {t.filters.clear}
            </button>
          </div>
        ) : (
          <HandList groups={groups} visibleCount={visibleCount} total={result.hands.length} onLoadMore={loadMore} />
        )}
      </>
    )
  }

  return (
    <Page
      title={strings.pages.hands}
      {...(sessionId !== null ? { backTo: `/sessions/${encodeURIComponent(sessionId)}` } : {})}
      action={<HeaderActions onExport={canExport ? openExport : null} />}
    >
      {body}
      {exportRequest && <HandExportSheet request={exportRequest} onClose={() => setExportRequest(null)} />}
    </Page>
  )
}
