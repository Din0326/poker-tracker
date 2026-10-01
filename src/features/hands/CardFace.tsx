import { cardName, isRedSuit, rankText, suitOf, suitSymbol, type Card, type Rank } from '../../domain/hands'

// 牌面顯示（3.6）：點數 `T` 顯示為 `10`，花色以符號表示；紅色花色 ♥♦ 用 --color-suit-red，♠♣ 用 --color-suit-black。
// 花色永遠以符號表示，不只靠顏色（v1 9.4）；螢幕閱讀器讀完整名稱（例「黑桃 A」）。
export function CardFace({ card, className }: { card: Card; className?: string | undefined }) {
  const suit = suitOf(card)
  return (
    <span className={`num font-semibold ${isRedSuit(suit) ? 'text-(--color-suit-red)' : 'text-(--color-suit-black)'} ${className ?? ''}`}>
      <span aria-hidden="true">
        {rankText(card[0] as Rank)}
        {suitSymbol(suit)}
      </span>
      <span className="sr-only">{cardName(card)}</span>
    </span>
  )
}

/** 一組牌（例：公牌 `K♥ 7♦ 2♣`），牌與牌之間空一格 */
export function CardList({ cards, className }: { cards: readonly Card[]; className?: string | undefined }) {
  return (
    <span className={`inline-flex flex-wrap gap-x-1.5 ${className ?? ''}`}>
      {cards.map((c) => (
        <CardFace key={c} card={c} />
      ))}
    </span>
  )
}
