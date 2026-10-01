// 4.10 牌力評估：2 張手牌 + 5 張公牌，取 7 張中最佳 5 張；同牌型依 5 張逐張比較（踢腳）。
// A 可當 1 組成 A-2-3-4-5（最小的順子，Five high）。花色不分大小。
import { rankValue, suitOf } from './cards'
import type { Card } from './types'

/** 牌型由小到大 */
export const HAND_CATEGORIES = [
  'highCard',
  'pair',
  'twoPair',
  'threeOfAKind',
  'straight',
  'flush',
  'fullHouse',
  'fourOfAKind',
  'straightFlush',
] as const
export type HandCategory = (typeof HAND_CATEGORIES)[number]

export interface HandValue {
  category: HandCategory
  /** 比較用的點數序列（牌型決定的順序，例葫蘆為 [三條點數, 對子點數]） */
  ranks: number[]
  /** 單一數值，越大越強；相等即平手 */
  score: number
}

function valueOf(categoryIndex: number, ranks: readonly number[]): HandValue {
  // 以 15 進位編碼：牌型 × 15^5 + 依序的點數，最大約 8 × 15^5 + … < 2^31，整數精確
  let score = categoryIndex
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0)
  return { category: HAND_CATEGORIES[categoryIndex] as HandCategory, ranks: [...ranks], score }
}

/** 5 張牌的牌力 */
export function evaluateFive(cards: readonly Card[]): HandValue {
  const ranks = cards.map(rankValue).sort((a, b) => b - a)
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!))
  const unique = [...new Set(ranks)]
  let straightTop = 0
  if (unique.length === 5) {
    if (ranks[0]! - ranks[4]! === 4) straightTop = ranks[0]!
    else if (ranks[0] === 14 && ranks[1] === 5) straightTop = 5 // A-2-3-4-5
  }
  // 依「張數多 → 點數大」排序的點數群組
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const byGroup = groups.map(([r]) => r)
  const shape = groups.map(([, n]) => n).join('')

  if (straightTop && flush) return valueOf(8, [straightTop])
  if (shape === '41') return valueOf(7, byGroup)
  if (shape === '32') return valueOf(6, byGroup)
  if (flush) return valueOf(5, ranks)
  if (straightTop) return valueOf(4, [straightTop])
  if (shape === '311') return valueOf(3, byGroup)
  if (shape === '221') return valueOf(2, byGroup)
  if (shape === '2111') return valueOf(1, byGroup)
  return valueOf(0, ranks)
}

/** 5–7 張牌中最佳 5 張的牌力 */
export function evaluateBest(cards: readonly Card[]): HandValue {
  if (cards.length < 5) throw new Error(`evaluateBest needs at least 5 cards, got ${cards.length}`)
  let best: HandValue | null = null
  const n = cards.length
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!])
            if (!best || v.score > best.score) best = v
          }
  return best!
}

/** 2 張手牌 + 公牌 */
export function evaluateHand(holeCards: readonly Card[], board: readonly Card[]): HandValue {
  return evaluateBest([...holeCards, ...board])
}

/** 比較牌力：a 較強為正、較弱為負、平手為 0 */
export function compareHandValues(a: HandValue, b: HandValue): number {
  return a.score - b.score
}

// ---- 4.10 英文描述（匯出檔用；畫面上的中文牌型名稱在字串檔） ----

const RANK_SINGULAR: Record<number, string> = {
  2: 'Deuce',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
}
const RANK_PLURAL: Record<number, string> = {
  2: 'Deuces',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
}

const one = (r: number) => RANK_SINGULAR[r]!
const many = (r: number) => RANK_PLURAL[r]!
/** 順子最小的那張：A-2-3-4-5 為 Ace */
const straightLow = (top: number) => (top === 5 ? 14 : top - 4)

/** 4.10 表格的英文描述（需驗證，14 節 HQ12） */
export function describeHandValue(v: HandValue): string {
  const [r0 = 0, r1 = 0] = v.ranks
  switch (v.category) {
    case 'highCard':
      return `high card ${one(r0)}`
    case 'pair':
      return `a pair of ${many(r0)}`
    case 'twoPair':
      return `two pair, ${many(r0)} and ${many(r1)}`
    case 'threeOfAKind':
      return `three of a kind, ${many(r0)}`
    case 'straight':
      return `a straight, ${one(straightLow(r0))} to ${one(r0)}`
    case 'flush':
      return `a flush, ${one(r0)} high`
    case 'fullHouse':
      return `a full house, ${many(r0)} full of ${many(r1)}`
    case 'fourOfAKind':
      return `four of a kind, ${many(r0)}`
    case 'straightFlush':
      return r0 === 14 ? 'a Royal Flush' : `a straight flush, ${one(straightLow(r0))} to ${one(r0)}`
  }
}
