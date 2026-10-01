// 報表（第 6 節）的顯示模型：純函式，不含 React 與 DB，方便單元測試。
// 指標計算一律呼叫 src/domain 的彙總函式，格式化一律呼叫 src/domain/format.ts；這裡只負責
// 「哪個頁籤顯示哪些指標、順序為何」（6.2 表格）、正負上色判斷與曲線資料的組合。
import {
  MissingStakeError,
  averagePlacePercentile,
  bbPerHour,
  formatAvgEntries,
  formatBbPerHour,
  formatFraction,
  formatHourly,
  formatHours,
  formatMoney,
  formatPercent,
  formatPlacePercentile,
  formatSignedMoney,
  formatSignedPercent,
  itm,
  profit,
  roundHalfAwayFromZero,
  sortChronological,
  summarize,
  tournamentMetrics,
  SESSION_TYPES,
  type Session,
  type SessionType,
  type StakeLookup,
  type SummaryMetrics,
} from '../../domain'
import { strings } from '../../strings'

/** 6.1 分類頁籤：總體 / 現金桌 / MTT / 限時 MTT */
export type ReportTab = 'all' | SessionType
export const REPORT_TABS = ['all', 'cash', 'mtt', 'timed_mtt'] as const satisfies readonly ReportTab[]

export function tabLabel(tab: ReportTab): string {
  return strings.report.tabs[tab]
}

/** 頁籤對應的場次（總體為全部類型） */
export function filterByTab<T extends Pick<Session, 'type'>>(sessions: readonly T[], tab: ReportTab): T[] {
  return tab === 'all' ? [...sessions] : sessions.filter((s) => s.type === tab)
}

export type MetricKey = keyof typeof strings.report.metrics

/** 6.2 各頁籤顯示的指標；陣列順序即呈現順序（表格由上到下） */
export const METRICS_BY_TAB: Record<ReportTab, readonly MetricKey[]> = {
  all: ['profit', 'count', 'winRate', 'totalHours', 'totalBuyIn', 'totalCashOut', 'totalFee', 'feeRate'],
  cash: [
    'profit',
    'count',
    'winRate',
    'hourly',
    'bbPerHour',
    'avgProfit',
    'totalHours',
    'totalBuyIn',
    'totalCashOut',
    'totalFee',
    'feeRate',
  ],
  mtt: [
    'profit',
    'count',
    'winRate',
    'roi',
    'hourly',
    'itm',
    'placePercentile',
    'avgProfit',
    'abi',
    'avgEntries',
    'totalHours',
    'totalBuyIn',
    'totalCashOut',
    'totalFee',
    'feeRate',
  ],
  timed_mtt: [
    'profit',
    'count',
    'winRate',
    'roi',
    'hourly',
    'avgProfit',
    'abi',
    'avgEntries',
    'totalHours',
    'totalBuyIn',
    'totalCashOut',
    'totalFee',
    'feeRate',
  ],
}

/**
 * 盈虧上色依據（9.3）：回傳「顯示時捨入後」的值，0 與 null 不上色。
 * 用捨入後的值判斷，避免 +0.4 顯示為 `$0` 卻被上色。decimals 與該指標的顯示小數位數相同。
 */
export function toneValue(value: number | null, decimals: number): number | null {
  return value === null ? null : roundHalfAwayFromZero(value, decimals)
}

/** 一個顯示用的數值：文字與上色依據（null 為不上色） */
export interface DisplayValue {
  text: string
  tone: number | null
}

const plain = (text: string): DisplayValue => ({ text, tone: null })

/** bb/hr；盲注參照遺失屬資料完整性問題（不應發生），此時顯示 — 而不讓整頁出錯 */
export function safeBbPerHour(sessions: readonly Session[], stakes: StakeLookup): number | null {
  try {
    return bbPerHour(sessions, stakes)
  } catch (e) {
    if (e instanceof MissingStakeError) return null
    throw e
  }
}

/** 帶正負號的指標值（6.2 與 6.4 共用），依顯示小數位數判斷上色 */
export const signed = {
  money: (v: number | null): DisplayValue => ({ text: formatSignedMoney(v), tone: toneValue(v, 0) }),
  hourly: (v: number | null): DisplayValue => ({ text: formatHourly(v), tone: toneValue(v, 0) }),
  /** ROI 顯示為百分比小數 1 位，所以以 ×100 後的 1 位小數判斷 */
  roi: (v: number | null): DisplayValue => ({ text: formatSignedPercent(v), tone: toneValue(v === null ? null : v * 100, 1) }),
  bbPerHour: (v: number | null): DisplayValue => ({ text: formatBbPerHour(v), tone: toneValue(v, 1) }),
}

export interface MetricCard {
  key: MetricKey
  label: string
  value: DisplayValue
}

/**
 * 6.2 指標卡。sessions 須已依頁籤與期間篩選；空集合時比率指標為 —、金額為 $0（C5）。
 * 只計算該頁籤需要的指標。
 */
export function buildMetricCards(sessions: readonly Session[], tab: ReportTab, stakes: StakeLookup): MetricCard[] {
  const keys = METRICS_BY_TAB[tab]
  const m: SummaryMetrics = summarize(sessions)
  const needTournament = keys.includes('abi') || keys.includes('avgEntries')
  const tour = needTournament ? tournamentMetrics(sessions) : null
  const value = (key: MetricKey): DisplayValue => {
    switch (key) {
      case 'profit':
        return signed.money(m.profit)
      case 'count':
        return plain(String(m.count))
      case 'winRate':
        return plain(formatFraction(m.winCount, m.count))
      case 'roi':
        return signed.roi(m.roi)
      case 'hourly':
        return signed.hourly(m.hourly)
      case 'bbPerHour':
        return signed.bbPerHour(safeBbPerHour(sessions, stakes))
      case 'itm': {
        const r = itm(sessions)
        return plain(formatFraction(r.itmCount, r.count))
      }
      case 'placePercentile':
        return plain(formatPlacePercentile(averagePlacePercentile(sessions)))
      case 'avgProfit':
        return signed.money(m.avgProfit)
      case 'abi':
        return plain(formatMoney(tour?.abi ?? null))
      case 'avgEntries':
        return plain(formatAvgEntries(tour?.avgEntries ?? null))
      case 'totalHours':
        return plain(formatHours(m.totalHours))
      case 'totalBuyIn':
        return plain(formatMoney(m.totalBuyIn))
      case 'totalCashOut':
        return plain(formatMoney(m.totalCashOut))
      case 'totalFee':
        return plain(formatMoney(m.totalFee))
      case 'feeRate':
        return plain(formatPercent(m.feeRate))
    }
  }
  return keys.map((key) => ({ key, label: strings.report.metrics[key], value: value(key) }))
}

/** 6.2 總體頁小表的一列：該類型的場次數與盈利 */
export interface TypeBreakdownRow {
  type: SessionType
  count: number
  profit: DisplayValue
}

/** 總體頁小表；sessions 為期間篩選後的全部類型場次 */
export function buildTypeBreakdown(sessions: readonly Session[]): TypeBreakdownRow[] {
  return SESSION_TYPES.map((type) => {
    const m = summarize(sessions.filter((s) => s.type === type))
    return { type, count: m.count, profit: signed.money(m.profit) }
  })
}

/** 6.3 累積盈利曲線的一個點 */
export interface CurvePoint {
  /** 場次序號，1..N */
  index: number
  /** 顯示用日期 `2026/09/27` */
  date: string
  type: SessionType
  /** 該場盈利 */
  profit: number
  /** 到這一場為止的累積盈利（從 0 開始累積） */
  cumulative: number
}

/**
 * 6.3：依 startAt 由舊到新（同時間依 createdAt）排序後累積盈利。
 * sessions 須已依頁籤與期間篩選，所以期間篩選時從 0 開始累積。
 */
export function buildCurve(sessions: readonly Session[]): CurvePoint[] {
  let cumulative = 0
  return sortChronological(sessions).map((s, i) => {
    const p = profit(s)
    cumulative += p
    return {
      index: i + 1,
      date: strings.report.curve.date(s.startAt.slice(0, 4), s.startAt.slice(5, 7), s.startAt.slice(8, 10)),
      type: s.type,
      profit: p,
      cumulative,
    }
  })
}

/** 少於 2 筆不畫曲線（6.3） */
export const MIN_CURVE_POINTS = 2
/** 超過 500 點不畫個別資料點圓圈（6.3） */
export const MAX_DOTS = 500
