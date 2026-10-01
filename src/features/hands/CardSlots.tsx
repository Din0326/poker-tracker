import { Plus } from 'lucide-react'
import { cardName } from '../../domain/hands'
import { strings } from '../../strings'
import { CardFace } from './CardFace'
import type { CardSlot } from './handFormModel'

const t = strings.hands

type Props = {
  /** 牌組名稱（手牌、公牌、翻牌…），用於 aria-label「手牌第 1 張：黑桃 A」 */
  label: string
  slots: readonly CardSlot[]
  /** 牌位的實際索引（例：轉牌為公牌的第 4 個牌位）；未指定時為 0… */
  indices?: readonly number[] | undefined
  onOpen?: ((index: number) => void) | undefined
  disabled?: boolean | undefined
  invalid?: boolean | undefined
  describedBy?: string | undefined
  /** 目前作用中的牌位（選牌器頂端）以外框標示 */
  activeIndex?: number | null | undefined
  testId?: string | undefined
}

// 牌位按鈕列（5.2、5.3、5.4）：點擊開啟選牌器；每個牌位為原生 <button>，觸控區 ≥ 44×44px
export function CardSlots({ label, slots, indices, onOpen, disabled, invalid, describedBy, activeIndex, testId }: Props) {
  const list = indices ?? slots.map((_, i) => i)
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {list.map((index, n) => {
        const card = slots[index] ?? null
        const active = activeIndex === index
        return (
          <button
            key={index}
            type="button"
            disabled={disabled}
            onClick={() => onOpen?.(index)}
            aria-label={t.slotLabel(label, n + 1, card === null ? t.emptySlot : cardName(card))}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            aria-current={active ? 'true' : undefined}
            data-card={card ?? ''}
            className={`flex h-14 w-12 items-center justify-center rounded-(--radius-control) border bg-(--color-surface) text-lg disabled:opacity-60 ${
              active
                ? 'border-2 border-(--color-accent)'
                : invalid
                  ? 'border-(--color-danger)'
                  : 'border-(--color-border)'
            }`}
          >
            {card === null ? <Plus aria-hidden="true" size={18} className="text-(--color-text-muted)" /> : <CardFace card={card} />}
          </button>
        )
      })}
    </div>
  )
}
