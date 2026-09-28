import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Page } from '../../components/Page'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { formatSignedMoney, sortReverseChronological, stakeLabel, summarize, toLocalDate } from '../../domain'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'
import { FilterBar, type ExtraTag } from './FilterBar'
import { BATCH_SIZE, listMemory } from './listMemory'
import { DEFAULT_FILTERS, applyListFilters, isFiltering, type ExtraFilters, type ListFilters } from './listFilters'
import { SESSIONS_PATH, extrasToSearch, parseListSearch, withoutExtra } from './listUrl'
import { SessionList } from './SessionList'
import { buildLookup, groupByMonth, profitColorClass, type RefLookup } from './sessionView'
import { refreshSessions, retrySessions, useSessionsState } from './sessionsStore'

const t = strings.sessions
const KEYWORD_DEBOUNCE_MS = 200

/** 網址帶入的 type / period 覆蓋記憶的篩選（Q3） */
function applyOverrides(filters: ListFilters, search: string): ListFilters {
  const { overrides } = parseListSearch(search)
  return { ...filters, ...overrides }
}

function extraTags(extras: ExtraFilters, lookup: RefLookup | null): ExtraTag[] {
  const f = t.filters
  const tags: ExtraTag[] = []
  if (extras.venue !== undefined) {
    const name =
      extras.venue === null ? f.unspecifiedVenue : (lookup?.venues.get(extras.venue)?.name ?? f.unknownRef)
    tags.push({ key: 'venue', label: f.venueTag(name) })
  }
  if (extras.stake !== undefined) {
    const stake = lookup?.stakes.get(extras.stake)
    tags.push({ key: 'stake', label: f.stakeTag(stake ? stakeLabel(stake) : f.unknownRef) })
  }
  if (extras.name !== undefined) {
    tags.push({ key: 'name', label: f.nameTag(extras.name ?? f.unnamed) })
  }
  return tags
}

// 紀錄列表（7.1）
export function SessionsPage() {
  const { repos } = useAppData()
  const navigate = useNavigate()
  const { search } = useLocation()
  const state = useSessionsState()

  // ---- 篩選條件：初始值取自記憶（Q2），網址帶入的類型 / 期間覆蓋之（Q3） ----
  const [filters, setFilters] = useState<ListFilters>(() => applyOverrides(listMemory.filters, search))
  const [keyword, setKeyword] = useState(filters.keyword)
  const [appliedSearch, setAppliedSearch] = useState(search)
  if (search !== appliedSearch) {
    // 已在列表時網址改變（例：直接修改網址）：同樣套用覆蓋
    setAppliedSearch(search)
    const next = applyOverrides(filters, search)
    setFilters(next)
    setKeyword(next.keyword)
  }
  const parsed = useMemo(() => parseListSearch(search), [search])
  const { extras } = parsed

  // type / period 是一次性覆蓋：套用後從網址移除，只留額外條件（避免返回時再次覆蓋使用者之後的變更）
  useEffect(() => {
    if (parsed.hasOverrides) void navigate({ pathname: SESSIONS_PATH, search: extrasToSearch(extras) }, { replace: true })
  }, [parsed, extras, navigate])

  useEffect(() => {
    listMemory.filters = filters
  }, [filters])
  useEffect(() => {
    listMemory.search = parsed.hasOverrides ? extrasToSearch(extras) : search
  }, [parsed, extras, search])

  // 關鍵字輸入 debounce 200ms 後才套用
  useEffect(() => {
    if (keyword === filters.keyword) return
    const timer = setTimeout(() => setKeyword(filters.keyword), KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filters.keyword, keyword])

  // ---- 資料：先顯示記憶體快取，背景重新讀取 ----
  useEffect(() => {
    void refreshSessions(repos)
  }, [repos])

  const data = state.status === 'ready' ? state.data : null
  const lookup = useMemo(() => (data ? buildLookup(data.venues, data.stakes) : null), [data])
  const sorted = useMemo(() => (data ? sortReverseChronological(data.sessions) : []), [data])
  const effectiveFilters = useMemo(() => ({ ...filters, keyword }), [filters, keyword])
  const today = toLocalDate(new Date())
  const result = useMemo(
    () => applyListFilters(sorted, effectiveFilters, extras, today),
    [sorted, effectiveFilters, extras, today],
  )
  const groups = useMemo(() => groupByMonth(result.sessions), [result])
  const total = useMemo(() => summarize(result.sessions), [result])

  // ---- 分批載入：篩選條件相同時沿用記憶的筆數（從詳情返回時捲動位置可還原） ----
  const filterKey = JSON.stringify([effectiveFilters, extras])
  const [visible, setVisible] = useState(() =>
    listMemory.visible && listMemory.visible.key === filterKey ? listMemory.visible : { key: filterKey, count: BATCH_SIZE },
  )
  let visibleCount = visible.count
  if (visible.key !== filterKey) {
    visibleCount = BATCH_SIZE
    setVisible({ key: filterKey, count: BATCH_SIZE })
  }
  useEffect(() => {
    listMemory.visible = visible
  }, [visible])
  const loadMore = useCallback(() => {
    setVisible((v) => ({ key: v.key, count: v.count + BATCH_SIZE }))
  }, [])

  // ---- 操作 ----
  const changeFilters = (patch: Partial<ListFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const removeTag = (key: keyof ExtraFilters) =>
    void navigate({ pathname: SESSIONS_PATH, search: extrasToSearch(withoutExtra(extras, key)) }, { replace: true })
  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS)
    setKeyword('')
    if (search !== '') void navigate(SESSIONS_PATH, { replace: true })
  }

  const filtering = isFiltering(filters, extras)
  const tags = extraTags(extras, lookup)

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
    // 完全沒有紀錄（同報表空狀態 6.5）
    body = (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{t.empty.noRecords}</p>
        <Link to="/" className={primaryButtonClass}>
          {t.empty.addFirst}
        </Link>
      </div>
    )
  } else {
    body = (
      <>
        <FilterBar
          filters={filters}
          onChange={changeFilters}
          tags={tags}
          onRemoveTag={removeTag}
          periodError={result.periodError}
          filtering={filtering}
          onClear={clearFilters}
        />
        <p data-testid="list-summary" className="num mt-3 px-1 text-sm font-semibold">
          {t.summary(total.count, '')}
          <span className={profitColorClass(total.profit)}>{formatSignedMoney(total.profit)}</span>
        </p>
        {result.sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <p>{t.empty.noMatch}</p>
            <button type="button" onClick={clearFilters} className={secondaryButtonClass}>
              {t.filters.clear}
            </button>
          </div>
        ) : (
          lookup && (
            <SessionList
              groups={groups}
              lookup={lookup}
              visibleCount={visibleCount}
              total={result.sessions.length}
              onLoadMore={loadMore}
            />
          )
        )}
      </>
    )
  }

  return <Page title={strings.pages.sessions}>{body}</Page>
}
