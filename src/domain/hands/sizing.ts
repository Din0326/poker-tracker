// 4.11 下注快捷金額：以整數運算四捨五入到最小單位（1），0.5 進位（演算法同 v1 4.6 的 roundDivHalfUp）。
import { roundDivHalfUp } from '../session'
import { currentPot, legalActions, type EngineState } from './engine'

export interface SizingInput {
  /** 目前底池 P（含本街，未扣退回） */
  pot: number
  /** 目前下注額 B */
  currentBet: number
  /** 最小加注增量 L */
  minRaise: number
  /** 行動者該街已投入 A */
  committed: number
  /** 行動者剩餘籌碼 S */
  stack: number
  /** 大盲（bet 的最小金額） */
  bb: number
}

export interface QuickSize {
  /** 「下注到 / 加注到」金額 */
  to: number
  /** 夾限後等於全下 */
  allIn: boolean
}

export interface QuickSizes {
  min: QuickSize
  half: QuickSize
  twoThirds: QuickSize
  pot: QuickSize
  allIn: QuickSize
}

/**
 * target = B + round((P + C) × f)，C = toCall = B − A。f 以分子 / 分母表示：½ = 1/2、⅔ = 2/3、底池 = 1/1。
 * 夾限：target < 最小合法金額（bet 為 bb，raise 為 B + L）時改為最小合法金額；target ≥ 全下金額（A + S）時改為全下。
 */
export function quickBetSizes(input: SizingInput): QuickSizes {
  const { pot, currentBet: B, minRaise: L, committed: A, stack: S, bb } = input
  const C = B - A
  const allInTo = A + S
  const minLegal = B === 0 ? bb : B + L
  const clamp = (target: number): QuickSize => {
    const to = target < minLegal ? minLegal : target
    return to >= allInTo ? { to: allInTo, allIn: true } : { to, allIn: false }
  }
  const fraction = (num: number, den: number) => clamp(B + roundDivHalfUp((pot + C) * num, den))
  return {
    min: clamp(minLegal),
    half: fraction(1, 2),
    twoThirds: fraction(2, 3),
    pot: fraction(1, 1),
    allIn: { to: allInTo, allIn: true },
  }
}

/** 由引擎狀態取得目前行動者的快捷金額；不能下注或加注時回傳 null */
export function quickBetSizesFor(state: EngineState): QuickSizes | null {
  const legal = legalActions(state)
  if (!legal || (!legal.canBet && !legal.canRaise)) return null
  return quickBetSizes({
    pot: currentPot(state),
    currentBet: legal.currentBet,
    minRaise: legal.minRaise,
    committed: legal.committed,
    stack: legal.stack,
    bb: state.bb,
  })
}
