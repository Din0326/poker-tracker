// 4.1 單一場次計算與 4.6 賣股份（份額）計算（純函式）
// - 服務費已含在買入內，只用於服務費統計，絕不從盈利扣除（第 4 節）
// - 口徑（v1.2）：「全額」以整場買入總額與 cashOut 計算；「份額」以你的成本 / 你的到手 / 你的盈利計算。
//   沒有出資者時兩者相等。結果判定、bb 盈利、時薪一律用你的盈利（4.1）。
// - 4.6 捨入：每位出資者的付款、分走獎金各自以「整數運算」四捨五入（0.5 進位），
//   不得先把比例換成小數再相乘（浮點陷阱見 10.2 C21）。
import type { Backer, Session, SessionResult, Stake } from './types'

type BuyInsOnly = Pick<Session, 'buyIns'>
/** 計算份額需要的欄位；backers 為空陣列代表沒有賣股 */
export type StakingInput = Pick<Session, 'buyIns' | 'cashOut' | 'backers'>
type FullProfitInput = Pick<Session, 'buyIns' | 'cashOut'>
type BackerShare = Pick<Backer, 'sharePermille' | 'markupPermille'>

/** 4.6 分母：比例（千分比）× 倍數（千分之一） */
const PAY_DENOMINATOR = 1_000_000
/** 4.6 分母：比例（千分比） */
const PAYOUT_DENOMINATOR = 1_000
/** 比例的千分比總量（100%） */
export const FULL_PERMILLE = 1000

/** 買入總額 = Σ buyIns[i].amount（含服務費） */
export function buyInTotal(s: BuyInsOnly): number {
  return s.buyIns.reduce((sum, b) => sum + b.amount, 0)
}

/** 服務費總額 = Σ buyIns[i].fee（不分攤，永遠是整場全額，4.6） */
export function feeTotal(s: BuyInsOnly): number {
  return s.buyIns.reduce((sum, b) => sum + b.fee, 0)
}

/** 進場次數 = buyIns 筆數 */
export function entryCount(s: BuyInsOnly): number {
  return s.buyIns.length
}

/** 全額盈利 = cashOut − 買入總額（4.1；v1 的「盈利」即此值） */
export function fullProfit(s: FullProfitInput): number {
  return s.cashOut - buyInTotal(s)
}

/**
 * 4.6 整數運算的四捨五入：n ÷ d，0.5 進位（n ≥ 0、d > 0，皆為安全整數）。
 * q = ⌊n ÷ d⌋、r = n − q × d，2r ≥ d 時進位。
 * n ÷ d 以浮點數計算時，q 可能因捨入差 1，所以再以整數餘數校正（q × d 為安全整數，結果精確）。
 */
export function roundDivHalfUp(n: number, d: number): number {
  let q = Math.floor(n / d)
  let r = n - q * d
  if (r < 0) {
    q -= 1
    r += d
  } else if (r >= d) {
    q += 1
    r -= d
  }
  return 2 * r >= d ? q + 1 : q
}

/** 出資者付款 payᵢ = round(買入總額 × sᵢ × mᵢ ÷ 1,000,000)（4.6） */
export function backerPay(buyInTotalValue: number, backer: BackerShare): number {
  return roundDivHalfUp(buyInTotalValue * backer.sharePermille * backer.markupPermille, PAY_DENOMINATOR)
}

/** 分走獎金 payoutᵢ = round(cashOut × sᵢ ÷ 1,000)（4.6） */
export function backerPayout(cashOut: number, backer: Pick<Backer, 'sharePermille'>): number {
  return roundDivHalfUp(cashOut * backer.sharePermille, PAYOUT_DENOMINATOR)
}

/** 賣出比例合計 Σsᵢ（千分比） */
export function soldPermille(backers: readonly Pick<Backer, 'sharePermille'>[]): number {
  return backers.reduce((sum, b) => sum + b.sharePermille, 0)
}

/** 你佔比例 = 1000 − Σsᵢ（千分比） */
export function myPermille(backers: readonly Pick<Backer, 'sharePermille'>[]): number {
  return FULL_PERMILLE - soldPermille(backers)
}

/** 是否有出資者（賣股場次） */
export function hasBackers(s: Pick<Session, 'backers'>): boolean {
  return s.backers.length > 0
}

/** Σ payᵢ */
export function backerPayTotal(s: Pick<Session, 'buyIns' | 'backers'>): number {
  if (s.backers.length === 0) return 0
  const total = buyInTotal(s)
  return s.backers.reduce((sum, b) => sum + backerPay(total, b), 0)
}

/** Σ payoutᵢ */
export function backerPayoutTotal(s: Pick<Session, 'cashOut' | 'backers'>): number {
  return s.backers.reduce((sum, b) => sum + backerPayout(s.cashOut, b), 0)
}

/** 你的成本 = 買入總額 − Σ payᵢ（可能為 0 或負數，4.6） */
export function myCost(s: Pick<Session, 'buyIns' | 'backers'>): number {
  return buyInTotal(s) - backerPayTotal(s)
}

/** 你的到手 = cashOut − Σ payoutᵢ（極端情況可能為小額負數，4.6） */
export function myCashOut(s: Pick<Session, 'cashOut' | 'backers'>): number {
  return s.cashOut - backerPayoutTotal(s)
}

/** 你的盈利 = 你的到手 − 你的成本；沒有出資者時等於全額盈利（4.6） */
export function myProfit(s: StakingInput): number {
  if (s.backers.length === 0) return fullProfit(s)
  return myCashOut(s) - myCost(s)
}

/** 詳情（7.2）用：一位出資者的付款與分走獎金 */
export interface BackerLine {
  backer: Backer
  pay: number
  payout: number
}

/** 單場賣股份的完整明細（7.2 詳情、預覽共用；數字全部來自上方的純函式） */
export interface StakingBreakdown {
  lines: BackerLine[]
  buyInTotal: number
  cashOut: number
  payTotal: number
  payoutTotal: number
  fullProfit: number
  myCost: number
  myCashOut: number
  myProfit: number
  soldPermille: number
  myPermille: number
}

export function stakingBreakdown(s: StakingInput): StakingBreakdown {
  const total = buyInTotal(s)
  const lines = s.backers.map((backer) => ({
    backer,
    pay: backerPay(total, backer),
    payout: backerPayout(s.cashOut, backer),
  }))
  const payTotal = lines.reduce((sum, l) => sum + l.pay, 0)
  const payoutTotal = lines.reduce((sum, l) => sum + l.payout, 0)
  const cost = total - payTotal
  const cashOut = s.cashOut - payoutTotal
  const sold = soldPermille(s.backers)
  return {
    lines,
    buyInTotal: total,
    cashOut: s.cashOut,
    payTotal,
    payoutTotal,
    fullProfit: s.cashOut - total,
    myCost: cost,
    myCashOut: cashOut,
    myProfit: cashOut - cost,
    soldPermille: sold,
    myPermille: FULL_PERMILLE - sold,
  }
}

/** 結果判定（以你的盈利為準）：> 0 贏、< 0 輸、= 0 平（平不算贏） */
export function sessionResult(s: StakingInput): SessionResult {
  const p = myProfit(s)
  if (p > 0) return 'win'
  if (p < 0) return 'loss'
  return 'even'
}

/** 現金桌單場 bb 盈利 = 你的盈利 ÷ 該場 bb（不捨入） */
export function bbProfit(s: StakingInput, stake: Pick<Stake, 'bb'>): number {
  return myProfit(s) / stake.bb
}
