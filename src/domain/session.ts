// 4.1 單一場次計算（純函式）
// 服務費已含在買入內，只用於服務費統計，絕不從盈利扣除（第 4 節）
import type { Session, SessionResult, Stake } from './types'

type BuyInsOnly = Pick<Session, 'buyIns'>
type ProfitInput = Pick<Session, 'buyIns' | 'cashOut'>

/** 買入總額 = Σ buyIns[i].amount（含服務費） */
export function buyInTotal(s: BuyInsOnly): number {
  return s.buyIns.reduce((sum, b) => sum + b.amount, 0)
}

/** 服務費總額 = Σ buyIns[i].fee */
export function feeTotal(s: BuyInsOnly): number {
  return s.buyIns.reduce((sum, b) => sum + b.fee, 0)
}

/** 進場次數 = buyIns 筆數 */
export function entryCount(s: BuyInsOnly): number {
  return s.buyIns.length
}

/** 盈利 = cashOut − 買入總額 */
export function profit(s: ProfitInput): number {
  return s.cashOut - buyInTotal(s)
}

/** 結果判定：盈利 > 0 贏、< 0 輸、= 0 平（平不算贏） */
export function sessionResult(s: ProfitInput): SessionResult {
  const p = profit(s)
  if (p > 0) return 'win'
  if (p < 0) return 'loss'
  return 'even'
}

/** 現金桌單場 bb 盈利 = 盈利 ÷ 該場 bb（不捨入） */
export function bbProfit(s: ProfitInput, stake: Pick<Stake, 'bb'>): number {
  return profit(s) / stake.bb
}
