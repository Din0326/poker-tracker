// 7.1 列表篩選（純函式）：類型、期間（4.5）、關鍵字、報表分組跳入的場地 / 盲注 / 名稱
import { filterByRange, resolvePeriod, type PeriodError, type PeriodFilter, type Session, type SessionType } from '../../domain'

export type TypeFilter = 'all' | SessionType
export const TYPE_FILTERS = ['all', 'cash', 'mtt', 'timed_mtt'] as const satisfies readonly TypeFilter[]

export type PeriodKind = PeriodFilter['kind']
/** 與 6.1 相同順序：全部 / 近半年 / 近三個月 / 自訂 */
export const PERIOD_KINDS = ['all', 'last6Months', 'last3Months', 'custom'] as const satisfies readonly PeriodKind[]

/** 篩選列上可操作的條件（Q2：App 開啟期間保留） */
export interface ListFilters {
  type: TypeFilter
  period: PeriodKind
  /** 自訂期間起日 `YYYY-MM-DD`；'' 為未填 */
  from: string
  /** 自訂期間迄日 `YYYY-MM-DD`；'' 為未填 */
  to: string
  keyword: string
}

export const DEFAULT_FILTERS: ListFilters = { type: 'all', period: 'all', from: '', to: '', keyword: '' }

/**
 * 報表分組跳入的額外條件（Q3，以網址參數帶入）；undefined 代表不篩選。
 * venue：null 代表「未指定」；name：null 代表「未命名」。
 */
export interface ExtraFilters {
  venue?: string | null
  stake?: string
  name?: string | null
}

export function hasExtraFilters(e: ExtraFilters): boolean {
  return e.venue !== undefined || e.stake !== undefined || e.name !== undefined
}

/** 是否有任何篩選條件（決定「清除篩選」是否顯示） */
export function isFiltering(f: ListFilters, e: ExtraFilters): boolean {
  return (
    f.type !== 'all' ||
    f.period !== 'all' ||
    f.from !== '' ||
    f.to !== '' ||
    f.keyword !== '' ||
    hasExtraFilters(e)
  )
}

/** 名稱比對鍵（6.4）：去除前後空白、不分大小寫；空字串為「未命名」 */
export function nameKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

/** 名稱篩選：null 代表未命名 */
export function matchName(s: Pick<Session, 'name'>, name: string | null): boolean {
  const target = nameKey(name)
  return nameKey(s.name) === target
}

/** 場地篩選：null 代表未指定 */
export function matchVenue(s: Pick<Session, 'venueId'>, venue: string | null): boolean {
  return s.venueId === venue
}

/** 關鍵字正規化：去除前後空白後轉小寫；空字串代表不篩選 */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase()
}

/** 關鍵字：比對 name 與 note，不分大小寫、部分符合。keyword 須先以 normalizeKeyword 處理 */
export function matchKeyword(s: Pick<Session, 'name' | 'note'>, normalized: string): boolean {
  if (normalized === '') return true
  return (s.name?.toLowerCase().includes(normalized) ?? false) || (s.note?.toLowerCase().includes(normalized) ?? false)
}

/** 篩選列的期間選項轉為 domain 的 PeriodFilter */
export function toPeriodFilter(f: Pick<ListFilters, 'period' | 'from' | 'to'>): PeriodFilter {
  return f.period === 'custom' ? { kind: 'custom', from: f.from, to: f.to } : { kind: f.period }
}

export interface FilterResult {
  sessions: Session[]
  /**
   * 期間不合法時的原因（此時不套用期間，其他條件照常套用）：
   * fromAfterTo 顯示「起日不可晚於迄日」；invalidDate（自訂起迄未填完整）不顯示訊息
   */
  periodError: PeriodError | null
}

/**
 * 套用全部篩選條件。輸入順序保持不變（呼叫端先排序）。
 * today 為 `YYYY-MM-DD`（4.5 以本地日期判斷）。keyword 以原始輸入傳入。
 */
export function applyListFilters(
  sessions: readonly Session[],
  f: ListFilters,
  e: ExtraFilters,
  today: string,
): FilterResult {
  const period = resolvePeriod(toPeriodFilter(f), today)
  const keyword = normalizeKeyword(f.keyword)
  let result = sessions.filter(
    (s) =>
      (f.type === 'all' || s.type === f.type) &&
      (e.venue === undefined || matchVenue(s, e.venue)) &&
      (e.stake === undefined || s.stakeId === e.stake) &&
      (e.name === undefined || matchName(s, e.name)) &&
      matchKeyword(s, keyword),
  )
  if (period.ok && (period.range.from !== null || period.range.to !== null)) {
    result = filterByRange(result, period.range)
  }
  return { sessions: result, periodError: period.ok ? null : period.error }
}
