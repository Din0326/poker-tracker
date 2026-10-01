// 4.6 底池與邊池、4.7 攤牌贏家、4.8 抽水與分配。全部以整數運算。
import { orderAfterButton } from './positions'
import type { Collected } from './types'

export interface PotPlayer {
  seatNo: number
  /** 總投入 = 前注 + 各街投入 − 退回 */
  total: number
  folded: boolean
  /** 剩餘籌碼；0 且未棄牌即為全下 */
  stack: number
}

export interface Pot {
  amount: number
  /** 有資格的座位（未棄牌且總投入 ≥ 該層級），由小到大 */
  eligible: number[]
}

/** 底池總額 = Σ 所有玩家總投入 */
export function totalPot(players: readonly Pick<PotPlayer, 'total'>[]): number {
  return players.reduce((s, p) => s + p.total, 0)
}

/**
 * 4.6 邊池切分：
 * 1. 層級 = 「未棄牌且全下」玩家的總投入 ∪ 未棄牌玩家中的最大總投入，去重後由小到大
 * 2. 第 j 池 = Σ（所有玩家，含已棄牌者）[min(總投入, cⱼ) − min(總投入, cⱼ₋₁)]
 * 3. 資格者 = 未棄牌且總投入 ≥ cⱼ
 * 4. 相鄰兩池資格者完全相同時合併；5. 金額為 0 的池移除
 */
export function buildPots(players: readonly PotPlayer[]): Pot[] {
  const active = players.filter((p) => !p.folded)
  if (active.length === 0) return []
  const levels = [
    ...new Set([
      ...active.filter((p) => p.stack === 0).map((p) => p.total),
      Math.max(...active.map((p) => p.total)),
    ]),
  ].sort((a, b) => a - b)
  const raw: Pot[] = []
  let prev = 0
  for (const level of levels) {
    const amount = players.reduce((s, p) => s + Math.min(p.total, level) - Math.min(p.total, prev), 0)
    const eligible = active.filter((p) => p.total >= level).map((p) => p.seatNo).sort((a, b) => a - b)
    raw.push({ amount, eligible })
    prev = level
  }
  const merged: Pot[] = []
  for (const pot of raw) {
    const last = merged[merged.length - 1]
    if (last && last.eligible.join(',') === pot.eligible.join(',')) last.amount += pot.amount
    else merged.push({ amount: pot.amount, eligible: [...pot.eligible] })
  }
  return merged.filter((p) => p.amount > 0)
}

/** 4.8 抽水扣除：從主池開始扣，主池不足時剩餘部分從下一個池扣（14 節 HQ7）。回傳每池扣除後的金額 */
export function potsAfterRake(pots: readonly Pot[], rake: number): number[] {
  let remaining = rake
  return pots.map((p) => {
    const take = Math.min(p.amount, remaining)
    remaining -= take
    return p.amount - take
  })
}

/**
 * 4.8 平分：q = ⌊A ÷ w⌋、r = A − q × w；不能整除時，贏家依「從按鈕順時針下一位起」排列（按鈕排最後），
 * 前 r 位各得 q + 1（多 1 個最小單位），其餘各得 q。
 */
export function splitPot(amount: number, winners: readonly number[], seatNos: readonly number[], buttonSeat: number): Map<number, number> {
  const w = winners.length
  const result = new Map<number, number>()
  if (w === 0) return result
  const q = Math.floor(amount / w)
  const r = amount - q * w
  const order = orderAfterButton(seatNos, buttonSeat).filter((s) => winners.includes(s))
  order.forEach((seat, i) => result.set(seat, i < r ? q + 1 : q))
  return result
}

/**
 * 4.8 分配：每個池扣除抽水後的金額由該池的贏家平分；金額為 0 的池不產生 collected。
 * winnersByPot[i] 為第 i 池的贏家座位。結果依 potIndex、再依 seatNo 由小到大（3.5）。
 */
export function distributePots(
  pots: readonly Pot[],
  rake: number,
  winnersByPot: readonly (readonly number[])[],
  seatNos: readonly number[],
  buttonSeat: number,
): Collected[] {
  const amounts = potsAfterRake(pots, rake)
  const collected: Collected[] = []
  amounts.forEach((amount, potIndex) => {
    if (amount <= 0) return
    const shares = splitPot(amount, winnersByPot[potIndex] ?? [], seatNos, buttonSeat)
    for (const [seatNo, share] of [...shares.entries()].sort((a, b) => a[0] - b[0])) {
      if (share > 0) collected.push({ seatNo, potIndex, amount: share })
    }
  })
  return collected
}

/**
 * 4.7 每個池的贏家：該池資格者中、有手牌的玩家裡牌力最高者（同牌力平分）。
 * strength 回傳 null 表示沒有手牌（蓋牌或未選牌）。某個池的資格者都沒有手牌時該池回傳 null。
 */
export function potWinners(pots: readonly Pot[], strength: (seatNo: number) => number | null): (number[] | null)[] {
  return pots.map((pot) => {
    let best = -1
    let winners: number[] = []
    for (const seat of pot.eligible) {
      const s = strength(seat)
      if (s === null) continue
      if (s > best) {
        best = s
        winners = [seat]
      } else if (s === best) winners.push(seat)
    }
    return winners.length > 0 ? winners : null
  })
}

/** 4.9：每位玩家淨輸贏 = Σ 該玩家 collected − 總投入 */
export function netBySeat(players: readonly Pick<PotPlayer, 'seatNo' | 'total'>[], collected: readonly Collected[]): Map<number, number> {
  // 0 - total 避免產生 -0
  const net = new Map(players.map((p) => [p.seatNo, 0 - p.total]))
  for (const c of collected) net.set(c.seatNo, (net.get(c.seatNo) ?? 0) + c.amount)
  return net
}
