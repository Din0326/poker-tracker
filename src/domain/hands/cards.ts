// 3.6 牌面編碼與驗證。畫面顯示格式（T → 10、花色符號）屬 4.12，於 H2 實作在 format.ts。
import type { Card } from './types'

/** 點數由小到大；`T` 代表 10 */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export type Rank = (typeof RANKS)[number]
/** 花色：s ♠、h ♥、d ♦、c ♣（花色不分大小） */
export const SUITS = ['s', 'h', 'd', 'c'] as const
export type Suit = (typeof SUITS)[number]

/** 3.6：點數大寫、花色小寫，區分大小寫 */
export const CARD_RE = /^[2-9TJQKA][shdc]$/

export function isCard(value: unknown): value is Card {
  return typeof value === 'string' && CARD_RE.test(value)
}

/** 點數數值：2–14（A = 14） */
export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0] as Rank) + 2
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit
}

/** 完整 52 張牌（依點數、花色排列） */
export const FULL_DECK: readonly Card[] = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`))

/** 回傳第一張重複出現的牌；沒有重複時為 null（3.6：52 張中每張最多出現一次） */
export function findDuplicateCard(cards: readonly Card[]): Card | null {
  const seen = new Set<Card>()
  for (const c of cards) {
    if (seen.has(c)) return c
    seen.add(c)
  }
  return null
}
