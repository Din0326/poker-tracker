// 場次列表與詳情的顯示邏輯（7.1、7.2），純函式、不含 React 與 DB，方便單元測試。
// 指標計算一律呼叫 src/domain，這裡只負責組合顯示文字與分組。
import {
  entryCount,
  stakeLabel,
  summarize,
  type Session,
  type Stake,
  type Venue,
} from '../../domain'
import { strings } from '../../strings'
import { formatStartAt } from '../record/formModel'

/** 場地與盲注查表（含已封存） */
export interface RefLookup {
  venues: ReadonlyMap<string, Venue>
  stakes: ReadonlyMap<string, Stake>
}

export function buildLookup(venues: readonly Venue[], stakes: readonly Stake[]): RefLookup {
  return {
    venues: new Map(venues.map((v) => [v.id, v])),
    stakes: new Map(stakes.map((s) => [s.id, s])),
  }
}

export function venueOf(s: Pick<Session, 'venueId'>, lookup: RefLookup): Venue | undefined {
  return s.venueId === null ? undefined : lookup.venues.get(s.venueId)
}

export function stakeOf(s: Pick<Session, 'stakeId'>, lookup: RefLookup): Stake | undefined {
  return s.stakeId === null ? undefined : lookup.stakes.get(s.stakeId)
}

/**
 * 7.1 標題：依序取第一個有值的
 * 1. name
 * 2. 現金桌 `場地 · 50/100`；錦標賽：場地名稱
 * 3. 現金桌 `50/100`；錦標賽：類型名稱（MTT / 限時 MTT）
 * 已封存的場地與盲注照常顯示名稱。
 */
export function sessionTitle(s: Session, lookup: RefLookup): string {
  const name = s.name?.trim()
  if (name) return name
  const venue = venueOf(s, lookup)
  if (s.type === 'cash') {
    const stake = stakeOf(s, lookup)
    if (venue && stake) return strings.format.titleJoin(venue.name, stakeLabel(stake))
    if (stake) return stakeLabel(stake)
    // 盲注參照遺失屬資料完整性問題（不應發生），退回類型名稱
    return strings.sessionTypes.cash
  }
  if (venue) return venue.name
  return strings.sessionTypes[s.type]
}

/** 錦標賽進場 2 次以上時的小標籤 `×2`；其餘回傳 null */
export function entriesBadge(s: Session): string | null {
  if (s.type === 'cash') return null
  const n = entryCount(s)
  return n >= 2 ? strings.sessions.entriesBadge(n) : null
}

/** 單列日期 `09/27`（startAt 的本地日期） */
export function rowDate(s: Pick<Session, 'startAt'>): string {
  return strings.sessions.rowDate(s.startAt.slice(5, 7), s.startAt.slice(8, 10))
}

/** 月份分組 */
export interface MonthGroup {
  /** `YYYY-MM` */
  key: string
  year: number
  month: number
  sessions: Session[]
  /** 該月（符合篩選的）場次數 */
  count: number
  /** 該月（符合篩選的）盈利總和 */
  profit: number
}

/**
 * 7.1 依月份分組。輸入須已依 startAt 由新到舊排序（domain/sort.ts），
 * 分組保持輸入順序，所以月份也由新到舊。場次數與盈利以 domain summarize 計算。
 */
export function groupByMonth(sorted: readonly Session[]): MonthGroup[] {
  const groups: MonthGroup[] = []
  let current: { key: string; sessions: Session[] } | null = null
  const buckets: { key: string; sessions: Session[] }[] = []
  for (const s of sorted) {
    const key = s.startAt.slice(0, 7)
    if (!current || current.key !== key) {
      current = { key, sessions: [] }
      buckets.push(current)
    }
    current.sessions.push(s)
  }
  for (const b of buckets) {
    const m = summarize(b.sessions)
    groups.push({
      key: b.key,
      year: Number(b.key.slice(0, 4)),
      month: Number(b.key.slice(5, 7)),
      sessions: b.sessions,
      count: m.count,
      profit: m.profit,
    })
  }
  return groups
}

/** 盈虧顏色 class（9.3 語意 token）；0 不上色。正負號由格式化函式負責 */
export function profitColorClass(value: number | null): string {
  if (value === null || value === 0) return ''
  return value > 0 ? 'text-(--color-gain)' : 'text-(--color-loss)'
}

/** 場次開始時間 `2026/09/27 20 時`（與新增頁顯示格式相同，5.3） */
export function startAtText(s: Pick<Session, 'startAt'>): string {
  return formatStartAt(s.startAt.slice(0, 10), String(Number(s.startAt.slice(11, 13)))) ?? s.startAt
}
