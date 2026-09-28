// 4.2 彙總指標與 4.3 類型專屬指標（純函式）
// 規則：分母為 0 時回傳 null（顯示為 —）；內部計算不得提前捨入，捨入只在 format.ts 顯示時進行。
import { bbProfit, buyInTotal, entryCount, feeTotal, profit, sessionResult } from './session'
import type { Session, Stake } from './types'

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

/** 4.2 彙總指標（適用任何場次組合） */
export interface SummaryMetrics {
  /** Σ 盈利 */
  profit: number
  /** 場次數 */
  count: number
  /** 贏的場次數（平不算贏） */
  winCount: number
  /** 贏的場次數 ÷ 場次數 */
  winRate: number | null
  /** Σ 盈利 ÷ 場次數 */
  avgProfit: number | null
  /** Σ 買入總額 */
  totalBuyIn: number
  /** Σ cashOut */
  totalCashOut: number
  /** Σ 盈利 ÷ Σ 買入總額 */
  roi: number | null
  /** Σ durationMin */
  totalMinutes: number
  /** Σ durationMin ÷ 60 */
  totalHours: number
  /** Σ 盈利 ÷ 總時數 */
  hourly: number | null
  /** Σ 服務費總額 */
  totalFee: number
  /** Σ 服務費總額 ÷ Σ 買入總額 */
  feeRate: number | null
}

export function summarize(sessions: readonly Session[]): SummaryMetrics {
  let totalProfit = 0
  let winCount = 0
  let totalBuyIn = 0
  let totalCashOut = 0
  let totalMinutes = 0
  let totalFee = 0
  for (const s of sessions) {
    totalProfit += profit(s)
    if (sessionResult(s) === 'win') winCount++
    totalBuyIn += buyInTotal(s)
    totalCashOut += s.cashOut
    totalMinutes += s.durationMin
    totalFee += feeTotal(s)
  }
  const count = sessions.length
  const totalHours = totalMinutes / 60
  return {
    profit: totalProfit,
    count,
    winCount,
    winRate: ratio(winCount, count),
    avgProfit: ratio(totalProfit, count),
    totalBuyIn,
    totalCashOut,
    roi: ratio(totalProfit, totalBuyIn),
    totalMinutes,
    totalHours,
    hourly: ratio(totalProfit, totalHours),
    totalFee,
    feeRate: ratio(totalFee, totalBuyIn),
  }
}

/** 找不到場次參照的盲注時拋出（資料完整性問題，不應發生） */
export class MissingStakeError extends Error {
  readonly stakeId: string | null
  constructor(stakeId: string | null) {
    super(`Stake not found: ${String(stakeId)}`)
    this.name = 'MissingStakeError'
    this.stakeId = stakeId
  }
}

export type StakeLookup = ReadonlyMap<string, Pick<Stake, 'bb'>>

/**
 * 4.3 bb/hr = Σ（盈利ᵢ ÷ bbᵢ）÷ 總時數。
 * 只計入 type 為 cash 的場次（總時數也只算這些場次）；各場依自己的 bb 換算後再加總。
 * stakes 由呼叫端傳入（domain 不碰 DB）。
 */
export function bbPerHour(sessions: readonly Session[], stakes: StakeLookup): number | null {
  let bbSum = 0
  let minutes = 0
  for (const s of sessions) {
    if (s.type !== 'cash') continue
    const stake = s.stakeId === null ? undefined : stakes.get(s.stakeId)
    if (!stake) throw new MissingStakeError(s.stakeId)
    bbSum += bbProfit(s, stake)
    minutes += s.durationMin
  }
  return ratio(bbSum, minutes / 60)
}

/** 4.3 ITM%：到手金額 > 0 的場次數 ÷ 場次數；只計入 type 為 mtt 的場次 */
export interface ItmMetrics {
  itmCount: number
  count: number
  rate: number | null
}

export function itm(sessions: readonly Session[]): ItmMetrics {
  const mtt = sessions.filter((s) => s.type === 'mtt')
  const itmCount = mtt.filter((s) => s.cashOut > 0).length
  return { itmCount, count: mtt.length, rate: ratio(itmCount, mtt.length) }
}

/**
 * 4.3 平均名次百分位 = 平均（finishPlace ÷ fieldSize），只計兩欄都有填的 mtt 場次。
 * value 為 0–1 的比率（顯示時 ×100），n 為樣本數。
 */
export interface PlacePercentile {
  value: number | null
  n: number
}

export function averagePlacePercentile(sessions: readonly Session[]): PlacePercentile {
  let sum = 0
  let n = 0
  for (const s of sessions) {
    if (s.type !== 'mtt' || s.finishPlace === null || s.fieldSize === null) continue
    sum += s.finishPlace / s.fieldSize
    n++
  }
  return { value: ratio(sum, n), n }
}

/** 4.3 錦標賽指標：只計入 type 為 mtt 或 timed_mtt 的場次 */
export interface TournamentMetrics {
  /** Σ 進場次數 ÷ 場次數 */
  avgEntries: number | null
  /** 平均單次買入（ABI）= Σ 買入總額 ÷ Σ 進場次數 */
  abi: number | null
}

export function tournamentMetrics(sessions: readonly Session[]): TournamentMetrics {
  let count = 0
  let entries = 0
  let buyIn = 0
  for (const s of sessions) {
    if (s.type === 'cash') continue
    count++
    entries += entryCount(s)
    buyIn += buyInTotal(s)
  }
  return { avgEntries: ratio(entries, count), abi: ratio(buyIn, entries) }
}
