// SPEC-v2-hands 6.1 手牌列表的顯示與篩選邏輯（純函式，不含 React 與 DB）。
// 金額、bb、牌面、位置的格式一律呼叫 domain/hands/format.ts；這裡只負責組合文字、排序、分組與篩選。
// 11.1：列表只需要摘要欄位，讀出後轉成不含 detail、rawText 的輕量物件（HandListItem）並快取。
import {
  PERIOD_KINDS,
  inRange,
  resolvePeriod,
  selectionToFilter,
  type PeriodError,
  type PeriodKind,
} from '../../domain'
import {
  POSITIONS,
  formatHandAmount,
  formatHandBb,
  formatSignedHandAmount,
  handTagHistory,
  positionText,
  tagKey,
  type Hand,
  type Position,
} from '../../domain/hands'
import { strings } from '../../strings'

const t = strings.hands.list

/** 列表用的輕量手牌：Hand 去掉 detail、rawText，另記 detail 的小盲與是否有 detail */
export type HandListItem = Omit<Hand, 'detail' | 'rawText'> & {
  /** 有 detail 時為 detail.sb；備忘手牌為 null */
  sb: number | null
  /** detail 不為 null（完整手牌或未完成的完整紀錄） */
  hasDetail: boolean
}

export function toHandListItem(hand: Hand): HandListItem {
  const { detail, rawText: _rawText, ...rest } = hand
  void _rawText
  return { ...rest, sb: detail ? detail.sb : null, hasDetail: detail !== null }
}

// ---------------------------------------------------------------------------
// 排序與分組
// ---------------------------------------------------------------------------

/**
 * 6.1 排序：依 playedAt 由新到舊，同時間依 createdAt 由新到舊。
 * playedAt 為固定格式的本地時間字串，可直接比較；createdAt 含時區偏移，轉成時間值比較（先算好避免排序中重複解析）。
 */
export function sortHandsNewestFirst<T extends Pick<Hand, 'playedAt' | 'createdAt'>>(hands: readonly T[]): T[] {
  const keyed = hands.map((h) => ({ h, created: Date.parse(h.createdAt) }))
  keyed.sort((a, b) => {
    if (a.h.playedAt !== b.h.playedAt) return a.h.playedAt < b.h.playedAt ? 1 : -1
    return b.created - a.created
  })
  return keyed.map((k) => k.h)
}

export interface HandMonthGroup<T> {
  /** `YYYY-MM` */
  key: string
  year: number
  month: number
  hands: T[]
}

/** 6.1 以 playedAt 的月份分組；輸入須已排序，分組保持輸入順序 */
export function groupHandsByMonth<T extends Pick<Hand, 'playedAt'>>(sorted: readonly T[]): HandMonthGroup<T>[] {
  const groups: HandMonthGroup<T>[] = []
  let current: HandMonthGroup<T> | null = null
  for (const h of sorted) {
    const key = h.playedAt.slice(0, 7)
    if (!current || current.key !== key) {
      current = { key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)), hands: [] }
      groups.push(current)
    }
    current.hands.push(h)
  }
  return groups
}

/** 6.1 彙總「共 N 手（完整 M 手）」的數字；不計算結果加總（4.13） */
export function summarizeHandCount(hands: readonly Pick<Hand, 'kind'>[]): { count: number; complete: number } {
  let complete = 0
  for (const h of hands) if (h.kind === 'complete') complete++
  return { count: hands.length, complete }
}

// ---------------------------------------------------------------------------
// 6.1 篩選
// ---------------------------------------------------------------------------

export const KIND_FILTERS = ['all', 'complete', 'simple'] as const
export type KindFilter = (typeof KIND_FILTERS)[number]
export const SOURCE_FILTERS = ['all', 'manual', 'gg'] as const
export type SourceFilter = (typeof SOURCE_FILTERS)[number]
export const LINK_FILTERS = ['all', 'linked', 'standalone'] as const
export type LinkFilter = (typeof LINK_FILTERS)[number]
/** 位置：全部 / 10 種位置 / 未指定（none） */
export type PositionFilter = 'all' | 'none' | Position
export const POSITION_FILTERS: readonly PositionFilter[] = ['all', ...POSITIONS, 'none']

export { PERIOD_KINDS, type PeriodKind }

export interface HandListFilters {
  /** 期間（同 v1 4.5，以 playedAt 的本地日期判斷） */
  period: PeriodKind
  /** 自訂期間起日 `YYYY-MM-DD`；'' 為未填 */
  from: string
  to: string
  /** 紀錄類型：簡易含未完成 */
  kind: KindFilter
  source: SourceFilter
  position: PositionFilter
  /** 單選一個標籤；null 為全部 */
  tag: string | null
  link: LinkFilter
  /** 比對 note 與 tags，不分大小寫、部分符合 */
  keyword: string
}

export const DEFAULT_HAND_FILTERS: HandListFilters = {
  period: 'all',
  from: '',
  to: '',
  kind: 'all',
  source: 'all',
  position: 'all',
  tag: null,
  link: 'all',
  keyword: '',
}

/** 是否有任何篩選條件（含網址帶入的場次篩選）；決定「清除篩選」是否顯示 */
export function isFilteringHands(f: HandListFilters, sessionId: string | null): boolean {
  return (
    f.period !== 'all' ||
    f.from !== '' ||
    f.to !== '' ||
    f.kind !== 'all' ||
    f.source !== 'all' ||
    f.position !== 'all' ||
    f.tag !== null ||
    f.link !== 'all' ||
    f.keyword !== '' ||
    sessionId !== null
  )
}

/** 關鍵字：比對 note 與 tags，不分大小寫、部分符合。normalized 為去除前後空白、轉小寫後的關鍵字 */
export function matchHandKeyword(h: Pick<Hand, 'note' | 'tags'>, normalized: string): boolean {
  if (normalized === '') return true
  if (h.note?.toLowerCase().includes(normalized)) return true
  return h.tags.some((tag) => tag.toLowerCase().includes(normalized))
}

export interface HandFilterResult<T> {
  hands: T[]
  /** 期間不合法時的原因（此時不套用期間，其他條件照常套用；同紀錄列表） */
  periodError: PeriodError | null
}

/**
 * 套用 6.1 全部篩選條件；輸入順序保持不變（呼叫端先排序）。
 * sessionId：從場次詳情「查看全部」進入時只列該場的手牌（null 為不限）。today 為 `YYYY-MM-DD`。
 */
export function applyHandFilters<T extends HandListItem>(
  hands: readonly T[],
  f: HandListFilters,
  sessionId: string | null,
  today: string,
): HandFilterResult<T> {
  const period = resolvePeriod(selectionToFilter(f), today)
  const range = period.ok && (period.range.from !== null || period.range.to !== null) ? period.range : null
  const keyword = f.keyword.trim().toLowerCase()
  const tag = f.tag === null ? null : tagKey(f.tag)
  const result = hands.filter(
    (h) =>
      (sessionId === null || h.sessionId === sessionId) &&
      (range === null || inRange(h.playedAt.slice(0, 10), range)) &&
      (f.kind === 'all' || h.kind === f.kind) &&
      (f.source === 'all' || h.source === f.source) &&
      (f.position === 'all' || (f.position === 'none' ? h.heroPosition === null : h.heroPosition === f.position)) &&
      (tag === null || h.tags.some((x) => tagKey(x) === tag)) &&
      (f.link === 'all' || (f.link === 'linked' ? h.sessionId !== null : h.sessionId === null)) &&
      matchHandKeyword(h, keyword),
  )
  return { hands: result, periodError: period.ok ? null : period.error }
}

/** 標籤篩選的選單：所有出現過的標籤，依 5.6 的最近使用排序 */
export function tagFilterOptions(hands: readonly Pick<Hand, 'tags' | 'playedAt' | 'createdAt'>[]): string[] {
  return handTagHistory(hands)
}

// ---------------------------------------------------------------------------
// 6.1 單列內容
// ---------------------------------------------------------------------------

/** 單列時間 `09/30 21:15`（playedAt 的本地時間） */
export function handRowTime(h: Pick<Hand, 'playedAt'>): string {
  const p = h.playedAt
  return t.rowTime(p.slice(5, 7), p.slice(8, 10), p.slice(11, 13), p.slice(14, 16))
}

/** 盲注文字（金額格式依 4.12）：有 detail 時 `$100/$200`；備忘手牌有大盲時 `大盲 $200`；沒有時為 null */
export function handBlindsText(h: Pick<HandListItem, 'sb' | 'bb' | 'hasDetail' | 'amountUnit'>): string | null {
  if (h.bb === null) return null
  if (h.hasDetail && h.sb !== null) return t.blinds(formatHandAmount(h.sb, h.amountUnit), formatHandAmount(h.bb, h.amountUnit))
  return t.memoBb(formatHandAmount(h.bb, h.amountUnit))
}

/**
 * 6.1 中間第一行：位置 + 盲注（`BTN · $100/$200`、`SB · $0.10/$0.25`、`BB · 100/200`、`BTN · 大盲 $200`）；
 * 沒有盲注時只顯示位置；位置與盲注都沒有時顯示「手牌」；只有盲注時只顯示盲注。
 */
export function handRowTitle(h: Pick<HandListItem, 'heroPosition' | 'sb' | 'bb' | 'hasDetail' | 'amountUnit'>): string {
  const position = h.heroPosition === null ? null : positionText(h.heroPosition)
  const blinds = handBlindsText(h)
  if (position !== null && blinds !== null) return t.join(position, blinds)
  return position ?? blinds ?? t.untitled
}

/** 6.1 小標籤：`未完成`（simple 且有 detail，取代 `簡易`）、`簡易`、`GG`（source 為 gg） */
export function handRowBadges(h: Pick<HandListItem, 'kind' | 'hasDetail' | 'source'>): string[] {
  const badges: string[] = []
  if (h.kind === 'simple') badges.push(h.hasDetail ? t.badges.unfinished : t.badges.simple)
  if (h.source === 'gg') badges.push(t.badges.gg)
  return badges
}

/** 6.1 中間第二行的標籤：前 2 個標籤，多於 2 個時另記剩餘數量 */
export function handRowTags(h: Pick<Hand, 'tags'>): { shown: string[]; more: number } {
  return { shown: h.tags.slice(0, 2), more: Math.max(0, h.tags.length - 2) }
}

/** 4.12 結果：有 bb 顯示 bb，否則金額；heroNet 為 null 顯示 `—` */
export function handResultText(h: Pick<Hand, 'heroNet' | 'bb' | 'amountUnit'>): string {
  if (h.heroNet === null) return strings.format.empty
  if (h.bb !== null) return formatHandBb(h.heroNet, h.bb)
  return formatSignedHandAmount(h.heroNet, h.amountUnit)
}

/**
 * 結果文字的顏色（--color-gain / --color-loss，9.3）：依顯示出來的正負號決定，
 * 以絕對值捨入後為 `0.0 bb`、`$0` 等不帶正負號的文字不上色。
 */
export function signedTextClass(text: string): string {
  if (text.startsWith(strings.format.plus)) return 'text-(--color-gain)'
  if (text.startsWith(strings.format.minus)) return 'text-(--color-loss)'
  return ''
}
