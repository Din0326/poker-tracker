// 3.7 位置、4.1 座位與強制下注的座位。
// 「順時針」= 座位號遞增，超過最大座位號後回到最小的座位號；只計算有玩家的座位（空位跳過）。
import type { Position } from './types'

/** 3.7：依被發牌的玩家數 n，從按鈕起順時針的位置名稱 */
export const POSITIONS_BY_PLAYER_COUNT: Readonly<Record<number, readonly Position[]>> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'HJ', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO'],
  10: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'UTG3', 'LJ', 'HJ', 'CO'],
}

/** 由 start 起（含 start）順時針排列的座位號；seatNos 不需事先排序。start 不在其中時回傳 [] */
export function clockwiseFrom(seatNos: readonly number[], start: number): number[] {
  const sorted = [...seatNos].sort((a, b) => a - b)
  const i = sorted.indexOf(start)
  if (i < 0) return []
  return [...sorted.slice(i), ...sorted.slice(0, i)]
}

/** seat 順時針的下一個座位（只在 seatNos 中找；seat 本身可不在其中） */
export function nextSeatClockwise(seatNos: readonly number[], seat: number): number {
  const sorted = [...seatNos].sort((a, b) => a - b)
  return sorted.find((s) => s > seat) ?? (sorted[0] as number)
}

/** 由按鈕順時針下一位起排列、按鈕排最後（4.8 平分餘數的順序、翻牌後的行動順序） */
export function orderAfterButton(seatNos: readonly number[], buttonSeat: number): number[] {
  const order = clockwiseFrom(seatNos, buttonSeat)
  return [...order.slice(1), ...order.slice(0, 1)]
}

export interface ForcedSeats {
  /** 小盲座位；2 人時為按鈕 */
  sbSeat: number
  bbSeat: number
  /** straddle 玩家 = 大盲順時針下一位（3 人桌即按鈕）；沒有 straddle 時為 null */
  straddleSeat: number | null
}

/** 4.1：小盲、大盲、straddle 的座位 */
export function forcedSeats(seatNos: readonly number[], buttonSeat: number, hasStraddle: boolean): ForcedSeats {
  const order = clockwiseFrom(seatNos, buttonSeat)
  const headsUp = order.length === 2
  const sbSeat = headsUp ? (order[0] as number) : (order[1] as number)
  const bbSeat = headsUp ? (order[1] as number) : (order[2] as number)
  const straddleSeat = hasStraddle ? nextSeatClockwise(seatNos, bbSeat) : null
  return { sbSeat, bbSeat, straddleSeat }
}

/** 3.7：每個座位的位置名稱；人數不在 2–10 或按鈕不在座位中時回傳空 Map */
export function positionsBySeat(seatNos: readonly number[], buttonSeat: number): Map<number, Position> {
  const names = POSITIONS_BY_PLAYER_COUNT[seatNos.length]
  const order = clockwiseFrom(seatNos, buttonSeat)
  const map = new Map<number, Position>()
  if (!names || order.length === 0) return map
  order.forEach((seat, i) => map.set(seat, names[i] as Position))
  return map
}
