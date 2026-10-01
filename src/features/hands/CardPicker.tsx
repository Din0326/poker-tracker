import { useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { secondaryButtonClass } from '../../components/controlStyles'
import { RANKS, SUITS, cardName, isRedSuit, rankText, suitSymbol, type Card, type Rank, type Suit } from '../../domain/hands'
import { strings } from '../../strings'
import { CardSlots } from './CardSlots'
import type { CardSlot } from './handFormModel'

const t = strings.hands.cardPicker

/** 點數區：A K Q J 10 9 … 2（7 + 6 兩列） */
const RANK_ORDER: readonly Rank[] = [...RANKS].reverse()

export interface PickerRequest {
  /** sheet 標題（例「選擇翻牌」） */
  title: string
  /** 牌組名稱（牌位 aria-label） */
  label: string
  /** 本次要選的牌位（在 slots 中的索引） */
  indices: number[]
  /** 開啟時作用中的牌位 */
  start: number
}

type Props = {
  request: PickerRequest | null
  /** 牌組目前的所有牌位（含本次以外的牌位） */
  slots: readonly CardSlot[]
  /** 這手牌中已使用的牌（含本牌組已填的牌） */
  used: ReadonlySet<Card>
  onChange: (slots: CardSlot[]) => void
  onClose: () => void
}

// 5.4 選牌器：bottom sheet、先選點數再選花色，每顆按鈕 ≥ 44×44px。
// - 頂端為本次要選的牌位，作用中的牌位有外框；點擊已填的牌位可清除並重選
// - 已使用的牌停用（aria-label 標明「已使用」，畫面以刪除線與降低不透明度呈現，不只靠顏色）；四種花色都用掉的點數停用
// - 選完一張自動跳到下一個空牌位；全部填滿後自動關閉，也可按「完成」關閉（未填滿的牌位保持空白）
export function CardPicker({ request, slots, used, onChange, onClose }: Props) {
  return (
    <BottomSheet open={request !== null} title={request?.title ?? ''} onClose={onClose}>
      {request && <PickerBody key={`${request.title}-${request.start}`} request={request} slots={slots} used={used} onChange={onChange} onClose={onClose} />}
    </BottomSheet>
  )
}

function PickerBody({ request, slots, used, onChange, onClose }: Props & { request: PickerRequest }) {
  const [active, setActive] = useState(request.start)
  const [rank, setRank] = useState<Rank | null>(null)

  const choose = (suit: Suit) => {
    if (rank === null) return
    const card = `${rank}${suit}`
    const next = [...slots]
    next[active] = card
    onChange(next)
    setRank(null)
    // 自動跳到下一個空牌位（先往後找，再從頭找）；全部填滿後自動關閉
    const order = request.indices
    const pos = order.indexOf(active)
    const rest = [...order.slice(pos + 1), ...order.slice(0, pos)]
    const nextEmpty = rest.find((i) => next[i] === null)
    if (nextEmpty === undefined) onClose()
    else setActive(nextEmpty)
  }

  const clickSlot = (index: number) => {
    if (slots[index] !== null) {
      const next = [...slots]
      next[index] = null
      onChange(next)
    }
    setActive(index)
    setRank(null)
  }

  const rankUsedUp = (r: Rank) => SUITS.every((s) => used.has(`${r}${s}`))

  return (
    <div data-testid="card-picker">
      <div aria-label={t.slotsLabel} role="group">
        <CardSlots label={request.label} slots={slots} indices={request.indices} activeIndex={active} onOpen={clickSlot} testId="picker-slots" />
      </div>

      <p className="mt-4 mb-2 text-sm font-medium text-(--color-text-muted)">{t.ranks}</p>
      <div role="group" aria-label={t.ranks} className="grid grid-cols-7 gap-1">
        {RANK_ORDER.map((r) => {
          const disabled = rankUsedUp(r)
          const pressed = rank === r
          return (
            <button
              key={r}
              type="button"
              disabled={disabled}
              aria-pressed={pressed}
              aria-label={t.rankLabel(rankText(r))}
              onClick={() => setRank(r)}
              data-testid="picker-rank"
              className={`num flex h-12 min-w-11 items-center justify-center rounded-(--radius-control) border text-lg font-semibold disabled:line-through disabled:opacity-40 ${
                pressed ? 'border-(--color-accent) bg-(--color-accent) text-(--color-on-accent)' : 'border-(--color-border) bg-(--color-surface-raised)'
              }`}
            >
              {rankText(r)}
            </button>
          )
        })}
      </div>

      <p className="mt-4 mb-2 text-sm font-medium text-(--color-text-muted)">{t.suits}</p>
      <div role="group" aria-label={t.suits} className="grid grid-cols-4 gap-2">
        {SUITS.map((s) => {
          const card = rank === null ? null : `${rank}${s}`
          const isUsed = card !== null && used.has(card)
          const name = card === null ? strings.hands.cards.suitNames[s] : cardName(card)
          return (
            <button
              key={s}
              type="button"
              disabled={rank === null || isUsed}
              aria-label={isUsed ? t.used(name) : name}
              onClick={() => choose(s)}
              data-testid="picker-suit"
              className={`flex h-14 items-center justify-center rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-raised) text-2xl disabled:opacity-40 ${
                isUsed ? 'line-through' : ''
              } ${isRedSuit(s) ? 'text-(--color-suit-red)' : 'text-(--color-suit-black)'}`}
            >
              <span aria-hidden="true">{suitSymbol(s)}</span>
            </button>
          )
        })}
      </div>

      <button type="button" onClick={onClose} className={`${secondaryButtonClass} mt-4 w-full`}>
        {t.done}
      </button>
    </div>
  )
}
