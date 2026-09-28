// 紀錄列表的網址參數（Q3）：報表分組（6.4）跳到列表時，以 query 帶入類型、期間與分組條件。
//
// 網址格式：#/sessions?type=<type>&period=<period>[&from=YYYY-MM-DD&to=YYYY-MM-DD][&venue=<id>][&stake=<id>][&name=<text>]
// - type：all | cash | mtt | timed_mtt
// - period：all | 6m（近半年）| 3m（近三個月）| custom（需搭配 from、to，兩端皆含）
// - venue：場地 id；空值（`venue=`）代表「未指定」場地
// - stake：盲注 id（只有現金桌有盲注）
// - name：名稱（比對時去除前後空白、不分大小寫）；空值（`name=`）代表「未命名」
//
// type / period / from / to 為一次性覆蓋：套用到記憶的篩選（Q2）後即從網址移除；
// venue / stake / name 保留在網址中，作為篩選列上可移除的標籤。
// 不認得的值一律忽略（不套用）。
import type { PeriodFilter, SessionType } from '../../domain'
import { TYPE_FILTERS, type ExtraFilters, type ListFilters, type PeriodKind, type TypeFilter } from './listFilters'

export const SESSIONS_PATH = '/sessions'

const PERIOD_PARAM: Record<PeriodKind, string> = {
  all: 'all',
  last6Months: '6m',
  last3Months: '3m',
  custom: 'custom',
}

const PARAM_TO_PERIOD = new Map(Object.entries(PERIOD_PARAM).map(([k, v]) => [v, k as PeriodKind]))

/** 建立列表網址需要的條件（P4 報表分組點擊時使用） */
export interface SessionsLinkParams {
  type: 'all' | SessionType
  period: PeriodFilter
  /** 場地 id；null 代表「未指定」；省略代表不篩選場地 */
  venueId?: string | null
  /** 盲注 id；省略代表不篩選盲注 */
  stakeId?: string
  /** 名稱；null 或空白代表「未命名」；省略代表不篩選名稱 */
  name?: string | null
}

/**
 * 建立紀錄列表的路徑（不含 `#`），例 `/sessions?type=cash&period=3m&venue=<id>`。
 * 用法：`navigate(buildSessionsListPath({ type: 'cash', period: { kind: 'last3Months' }, venueId }))`
 */
export function buildSessionsListPath(p: SessionsLinkParams): string {
  const q = new URLSearchParams()
  q.set('type', p.type)
  q.set('period', PERIOD_PARAM[p.period.kind])
  if (p.period.kind === 'custom') {
    q.set('from', p.period.from)
    q.set('to', p.period.to)
  }
  appendExtras(q, {
    ...(p.venueId !== undefined ? { venue: p.venueId } : {}),
    ...(p.stakeId !== undefined ? { stake: p.stakeId } : {}),
    ...(p.name !== undefined ? { name: p.name } : {}),
  })
  return `${SESSIONS_PATH}?${q.toString()}`
}

function appendExtras(q: URLSearchParams, e: ExtraFilters): void {
  if (e.venue !== undefined) q.set('venue', e.venue ?? '')
  if (e.stake !== undefined) q.set('stake', e.stake)
  if (e.name !== undefined) q.set('name', (e.name ?? '').trim())
}

/** 只含額外條件的 search 字串（含 `?`；沒有條件時為 ''） */
export function extrasToSearch(e: ExtraFilters): string {
  const q = new URLSearchParams()
  appendExtras(q, e)
  const s = q.toString()
  return s === '' ? '' : `?${s}`
}

export interface ParsedListSearch {
  /** 網址帶入、要覆蓋記憶篩選的類型與期間 */
  overrides: Partial<Pick<ListFilters, 'type' | 'period' | 'from' | 'to'>>
  /** 網址是否含 type / period / from / to（需要從網址移除） */
  hasOverrides: boolean
  extras: ExtraFilters
}

function isTypeFilter(v: string): v is TypeFilter {
  return (TYPE_FILTERS as readonly string[]).includes(v)
}

/** 解析列表網址的 search 字串（`?type=cash&...` 或 `type=cash&...`） */
export function parseListSearch(search: string): ParsedListSearch {
  const q = new URLSearchParams(search)
  const overrides: ParsedListSearch['overrides'] = {}
  const type = q.get('type')
  if (type !== null && isTypeFilter(type)) overrides.type = type
  const period = q.get('period')
  const kind = period === null ? undefined : PARAM_TO_PERIOD.get(period)
  if (kind !== undefined) {
    overrides.period = kind
    if (kind === 'custom') {
      overrides.from = q.get('from') ?? ''
      overrides.to = q.get('to') ?? ''
    }
  }
  const extras: ExtraFilters = {}
  const venue = q.get('venue')
  if (venue !== null) extras.venue = venue === '' ? null : venue
  const stake = q.get('stake')
  if (stake !== null && stake !== '') extras.stake = stake
  const name = q.get('name')
  if (name !== null) extras.name = name.trim() === '' ? null : name.trim()
  return {
    overrides,
    hasOverrides: ['type', 'period', 'from', 'to'].some((k) => q.has(k)),
    extras,
  }
}

/** 移除某一個額外條件 */
export function withoutExtra(e: ExtraFilters, key: keyof ExtraFilters): ExtraFilters {
  const next = { ...e }
  delete next[key]
  return next
}
