// 6.4 分組統計（純函式，不含 React 與 DB）。
// 指標一律以 domain 彙總函式計算、format.ts 格式化；這裡只負責分組鍵、顯示名稱、排序與欄位選擇。
import {
  compareChronological,
  formatFraction,
  formatMoney,
  itm,
  stakeLabel,
  summarize,
  type Session,
  type StakeLookup,
  type SummaryMetrics,
} from '../../domain'
import { strings } from '../../strings'
import { nameKey } from '../sessions/listFilters'
import type { SessionsLinkParams } from '../sessions/listUrl'
import type { RefLookup } from '../sessions/sessionView'
import { safeBbPerHour, signed, type DisplayValue, type ReportTab } from './reportModel'

const t = strings.report.groups

export type GroupBy = 'venue' | 'stake' | 'name'

/** 6.4 各頁籤可選的分組；第一個為預設 */
export const GROUP_OPTIONS_BY_TAB: Record<ReportTab, readonly GroupBy[]> = {
  all: ['venue'],
  cash: ['venue', 'stake'],
  mtt: ['venue', 'name'],
  timed_mtt: ['venue', 'name'],
}

export type GroupColumn = keyof typeof strings.report.groups.columns

/** 6.4 各頁籤的分組欄位（依表格順序） */
export const GROUP_COLUMNS_BY_TAB: Record<ReportTab, readonly GroupColumn[]> = {
  all: ['count', 'profit', 'totalFee'],
  cash: ['count', 'profit', 'hourly', 'bbPerHour'],
  mtt: ['count', 'profit', 'roi', 'itm'],
  timed_mtt: ['count', 'profit', 'roi', 'hourly'],
}

/** 分組點擊跳到紀錄列表時的額外篩選（對應 buildSessionsListPath 的參數） */
export type GroupLink = Pick<SessionsLinkParams, 'venueId' | 'stakeId' | 'name'>

export interface GroupRow {
  /** 分組鍵（React key 與測試用） */
  key: string
  /** 顯示名稱（已封存者含「（已封存）」） */
  label: string
  /** 「未指定」或「未命名」組，永遠排最後 */
  unassigned: boolean
  count: number
  /** Σ 盈利（排序用，未捨入） */
  profit: number
  cells: { key: GroupColumn; label: string; value: DisplayValue }[]
  link: GroupLink
}

interface Bucket {
  key: string
  label: string
  unassigned: boolean
  link: GroupLink
  sessions: Session[]
  /** 名稱分組：目前這組最近一場（決定顯示名稱） */
  latest?: Session
}

function bucketOf(s: Session, by: GroupBy, lookup: RefLookup): Omit<Bucket, 'sessions'> {
  if (by === 'venue') {
    if (s.venueId === null) return { key: 'venue:', label: t.unspecified, unassigned: true, link: { venueId: null } }
    const venue = lookup.venues.get(s.venueId)
    const name = venue ? venue.name : t.unknownRef
    return {
      key: `venue:${s.venueId}`,
      label: venue?.archived ? `${name}${t.archivedSuffix}` : name,
      unassigned: false,
      link: { venueId: s.venueId },
    }
  }
  if (by === 'stake') {
    // 現金桌盲注必填（3.1）；stakeId 為 null 屬資料異常，歸到參照遺失
    const stake = s.stakeId === null ? undefined : lookup.stakes.get(s.stakeId)
    const name = stake ? stakeLabel(stake) : t.unknownRef
    return {
      key: `stake:${s.stakeId ?? ''}`,
      label: stake?.archived ? `${name}${t.archivedSuffix}` : name,
      unassigned: false,
      link: s.stakeId === null ? {} : { stakeId: s.stakeId },
    }
  }
  const k = nameKey(s.name)
  if (k === '') return { key: 'name:', label: t.unnamed, unassigned: true, link: { name: null } }
  // 顯示名稱與連結名稱稍後以最近一場決定
  return { key: `name:${k}`, label: '', unassigned: false, link: {} }
}

function cellValue(col: GroupColumn, sessions: readonly Session[], m: SummaryMetrics, stakes: StakeLookup): DisplayValue {
  switch (col) {
    case 'count':
      return { text: String(m.count), tone: null }
    case 'profit':
      return signed.money(m.profit)
    case 'totalFee':
      return { text: formatMoney(m.totalFee), tone: null }
    case 'hourly':
      return signed.hourly(m.hourly)
    case 'bbPerHour':
      return signed.bbPerHour(safeBbPerHour(sessions, stakes))
    case 'roi':
      return signed.roi(m.roi)
    case 'itm': {
      const r = itm(sessions)
      return { text: formatFraction(r.itmCount, r.count), tone: null }
    }
  }
}

/** 顯示名稱的比較：以字碼順序比較，結果在各裝置一致（不依賴語系排序） */
function compareLabel(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 6.4 分組統計。sessions 須已依頁籤與期間篩選。
 * - 排序：盈利由高到低；同盈利依場次數多到少，再依顯示名稱；「未指定」「未命名」永遠排最後。
 * - 名稱分組：去除前後空白、不分大小寫相同者為同一組；顯示名稱取該組最近一場（startAt 最新，同時間依 createdAt）的去空白原文。
 * - 已封存的場地與盲注照常列入，名稱後加「（已封存）」。
 */
export function buildGroups(
  sessions: readonly Session[],
  tab: ReportTab,
  by: GroupBy,
  lookup: RefLookup,
  stakes: StakeLookup,
): GroupRow[] {
  const buckets = new Map<string, Bucket>()
  for (const s of sessions) {
    const b = bucketOf(s, by, lookup)
    let bucket = buckets.get(b.key)
    if (!bucket) {
      bucket = { ...b, sessions: [] }
      buckets.set(b.key, bucket)
    }
    bucket.sessions.push(s)
    if (by === 'name' && !b.unassigned && (!bucket.latest || compareChronological(bucket.latest, s) < 0)) {
      bucket.latest = s
    }
  }

  const columns = GROUP_COLUMNS_BY_TAB[tab]
  const rows: GroupRow[] = [...buckets.values()].map((b) => {
    let { label, link } = b
    if (b.latest) {
      label = (b.latest.name ?? '').trim()
      link = { name: label }
    }
    const m = summarize(b.sessions)
    return {
      key: b.key,
      label,
      unassigned: b.unassigned,
      count: m.count,
      profit: m.profit,
      cells: columns.map((key) => ({ key, label: t.columns[key], value: cellValue(key, b.sessions, m, stakes) })),
      link,
    }
  })

  return rows.sort(
    (a, b) =>
      Number(a.unassigned) - Number(b.unassigned) ||
      b.profit - a.profit ||
      b.count - a.count ||
      compareLabel(a.label, b.label),
  )
}
