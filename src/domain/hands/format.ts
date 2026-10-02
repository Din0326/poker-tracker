// 4.12 手牌的畫面顯示格式（純函式）：金額依該手 amountUnit、bb 顯示、牌面（3.6）、位置（3.7）。
// H1 的新增 / 編輯手牌頁先用到這些格式；手牌列表與詳情（H2）沿用。所有畫面文字取自 src/strings.ts。
import { strings } from '../../strings'
import { formatBbProfit, roundHalfAwayFromZero } from '../format'
import { RANKS, suitOf, type Rank, type Suit } from './cards'
import type { HandValue } from './evaluator'
import type { AmountUnit, Card, Position } from './types'

const f = strings.format
const h = strings.hands.cards

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 金額絕對值的文字（不含正負號與 `$`）；分單位以整數運算拆出整數與 2 位小數，不經浮點數 */
function absText(value: number, unit: AmountUnit): string {
  const abs = Math.abs(value)
  if (unit !== 'cent') return groupThousands(String(abs))
  const int = Math.floor(abs / 100)
  const frac = String(abs - int * 100).padStart(2, '0')
  return `${groupThousands(String(int))}.${frac}`
}

function prefix(unit: AmountUnit): string {
  return unit === 'chip' ? '' : f.currency
}

/** 4.12 不帶正號的金額：元 `$16,800`、分 `$1,234.56`、籌碼 `1,500` */
export function formatHandAmount(value: number, unit: AmountUnit): string {
  const sign = value < 0 ? f.minus : ''
  return `${sign}${prefix(unit)}${absText(value, unit)}`
}

/** 4.12 結果（heroNet）：正負號永遠顯示（負號 U+2212），0 不帶正負號；null 顯示 — */
export function formatSignedHandAmount(value: number | null, unit: AmountUnit): string {
  if (value === null) return f.empty
  const sign = value > 0 ? f.plus : value < 0 ? f.minus : ''
  return `${sign}${prefix(unit)}${absText(value, unit)}`
}

/** 4.12 bb 顯示：金額 ÷ bb，小數 1 位，含正負號（`+84.0 bb`；以絕對值捨入後為 0 時為 `0.0 bb`） */
export function formatHandBb(value: number, bb: number): string {
  return formatBbProfit(value / bb)
}

/** 4.12 籌碼的 bb 顯示（不帶正負號）：`100.0 bb`；新增手牌頁「預設籌碼」下方小字（5.3） */
export function formatStackBb(stack: number, bb: number): string {
  return `${roundHalfAwayFromZero(stack / bb, 1).toFixed(1)}${f.bbSuffix}`
}

/** 點數顯示：`T` 顯示為 `10`（3.6） */
export function rankText(rank: Rank): string {
  return rank === 'T' ? '10' : rank
}

/** 花色符號 ♠♥♦♣（3.6：花色永遠以符號表示，不只靠顏色） */
export function suitSymbol(suit: Suit): string {
  return h.suitSymbols[suit]
}

/** 紅色花色（♥♦）以 --color-suit-red 顯示，其餘 --color-suit-black（3.6） */
export function isRedSuit(suit: Suit): boolean {
  return suit === 'h' || suit === 'd'
}

/** 牌面顯示 `A♠`、`10♥`（3.6） */
export function cardText(card: Card): string {
  return `${rankText(card[0] as Rank)}${suitSymbol(suitOf(card))}`
}

/** 牌的完整名稱（5.4 選牌器的 aria-label），例「黑桃 A」「紅心 10」 */
export function cardName(card: Card): string {
  return h.cardName(h.suitNames[suitOf(card)], rankText(card[0] as Rank))
}

/** 位置顯示：`UTG1` 顯示為 `UTG+1`，其餘照原字（3.7） */
export function positionText(position: Position): string {
  return strings.hands.positions[position]
}

/** 點數數值（2–14）的顯示文字：14 → `A`、10 → `10` */
function rankValueText(value: number): string {
  return rankText(RANKS[value - 2] as Rank)
}

/**
 * 4.10 畫面上的中文牌型，例「一對 K」。牌型名稱取自字串檔；
 * 點數依 4.10 英文描述的同一組點數組成（例兩對「兩對 K、7」、順子「順子 10 到 A」、A-2-3-4-5 為「順子 A 到 5」）。
 */
export function describeHandValueText(v: HandValue): string {
  const c = strings.hands.categories
  const [r0 = 0, r1 = 0] = v.ranks
  const low = (top: number) => (top === 5 ? 14 : top - 4)
  switch (v.category) {
    case 'highCard':
      return c.highCard(rankValueText(r0))
    case 'pair':
      return c.pair(rankValueText(r0))
    case 'twoPair':
      return c.twoPair(rankValueText(r0), rankValueText(r1))
    case 'threeOfAKind':
      return c.threeOfAKind(rankValueText(r0))
    case 'straight':
      return c.straight(rankValueText(low(r0)), rankValueText(r0))
    case 'flush':
      return c.flush(rankValueText(r0))
    case 'fullHouse':
      return c.fullHouse(rankValueText(r0), rankValueText(r1))
    case 'fourOfAKind':
      return c.fourOfAKind(rankValueText(r0))
    case 'straightFlush':
      return c.straightFlush(rankValueText(low(r0)), rankValueText(r0))
  }
}
