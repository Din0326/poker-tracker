// 4.5 期間篩選：以 startAt 的本地日期判斷，與結束時間無關。
// 「今天」由呼叫端以 `YYYY-MM-DD` 傳入，方便測試。
import dayjs from 'dayjs'
import type { Session } from './types'

export type PeriodFilter =
  | { kind: 'all' }
  | { kind: 'last3Months' }
  | { kind: 'last6Months' }
  /** from、to 皆為 `YYYY-MM-DD`，兩端皆含 */
  | { kind: 'custom'; from: string; to: string }

export type PeriodKind = PeriodFilter['kind']
/** 期間選單的選項順序（6.1、7.1）：全部 / 近半年 / 近三個月 / 自訂 */
export const PERIOD_KINDS = ['all', 'last6Months', 'last3Months', 'custom'] as const satisfies readonly PeriodKind[]

/**
 * 畫面上的期間選擇（報表與紀錄列表共用）。
 * from、to 為自訂期間的起迄 `YYYY-MM-DD`，'' 代表未填；只有 period 為 custom 時使用。
 */
export interface PeriodSelection {
  period: PeriodKind
  from: string
  to: string
}

/** 期間選擇轉為 PeriodFilter */
export function selectionToFilter(sel: PeriodSelection): PeriodFilter {
  return sel.period === 'custom' ? { kind: 'custom', from: sel.from, to: sel.to } : { kind: sel.period }
}

/** 解析後的日期範圍（`YYYY-MM-DD`，兩端皆含）；null 代表該端不限 */
export interface DateRange {
  from: string | null
  to: string | null
}

export type PeriodError = 'invalidDate' | 'fromAfterTo'

export type PeriodResult = { ok: true; range: DateRange } | { ok: false; error: PeriodError }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 是否為存在的日曆日期 `YYYY-MM-DD` */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const d = dayjs(value)
  // dayjs 會把 2026-02-30 進位成 3/2，所以要比對格式化結果
  return d.isValid() && d.format('YYYY-MM-DD') === value
}

/** 本地日期字串 `YYYY-MM-DD` */
export function toLocalDate(date: Date): string {
  return dayjs(date).format('YYYY-MM-DD')
}

function monthsBack(today: string, months: number): DateRange {
  // dayjs subtract(n, 'month') 月底自動收斂（例 5/31 往前 3 個月為 2/28）
  return { from: dayjs(today).subtract(months, 'month').format('YYYY-MM-DD'), to: today }
}

/** 把期間選項轉成日期範圍；自訂起日晚於迄日時回報 fromAfterTo */
export function resolvePeriod(filter: PeriodFilter, today: string): PeriodResult {
  if (filter.kind === 'all') return { ok: true, range: { from: null, to: null } }
  if (filter.kind === 'custom') {
    if (!isValidDate(filter.from) || !isValidDate(filter.to)) return { ok: false, error: 'invalidDate' }
    if (filter.from > filter.to) return { ok: false, error: 'fromAfterTo' }
    return { ok: true, range: { from: filter.from, to: filter.to } }
  }
  if (!isValidDate(today)) return { ok: false, error: 'invalidDate' }
  return { ok: true, range: monthsBack(today, filter.kind === 'last3Months' ? 3 : 6) }
}

/** startAt 的本地日期部分 */
export function startDate(s: Pick<Session, 'startAt'>): string {
  return s.startAt.slice(0, 10)
}

/** 日期是否落在範圍內（兩端皆含；`YYYY-MM-DD` 可直接以字串比較） */
export function inRange(date: string, range: DateRange): boolean {
  return (range.from === null || date >= range.from) && (range.to === null || date <= range.to)
}

export function filterByRange<T extends Pick<Session, 'startAt'>>(sessions: readonly T[], range: DateRange): T[] {
  return sessions.filter((s) => inRange(startDate(s), range))
}

/** 依期間選項篩選場次；期間不合法時回報錯誤而不篩選 */
export function filterByPeriod<T extends Pick<Session, 'startAt'>>(
  sessions: readonly T[],
  filter: PeriodFilter,
  today: string,
): { ok: true; sessions: T[] } | { ok: false; error: PeriodError } {
  const r = resolvePeriod(filter, today)
  if (!r.ok) return r
  return { ok: true, sessions: filterByRange(sessions, r.range) }
}
