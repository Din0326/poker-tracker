import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type Ref } from 'react'
import { groupDigits, sanitizeDigits } from '../lib/digits'
import { inputClass } from './controlStyles'

// 數字輸入框（5.3 金額輸入框，所有金額共用；參賽人數、名次、盲注以 grouping=false 共用）
// - inputmode="numeric" 叫出數字鍵盤；字級 ≥ 16px，避免 iOS Safari 聚焦時放大畫面
// - 只接受數字：輸入或貼上含逗號、$ 等字元時自動移除非數字
// - grouping 為 true 時輸入中即時加千分位；游標依「游標前的數字個數」還原，插入逗號後位置仍正確
// value / onChange 一律為只含數字的字串（不含逗號），'' 代表未填

type Props = Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string
  onValueChange: (digits: string) => void
  grouping?: boolean
  ref?: Ref<HTMLInputElement>
}

export function NumberInput({ value, onValueChange, grouping = true, className, ref, ...rest }: Props) {
  const innerRef = useRef<HTMLInputElement | null>(null)
  // 變更後要把游標放在第幾個數字之後
  const pendingDigitsBeforeCaret = useRef<number | null>(null)
  const display = grouping ? groupDigits(value) : value

  useLayoutEffect(() => {
    const el = innerRef.current
    const target = pendingDigitsBeforeCaret.current
    pendingDigitsBeforeCaret.current = null
    if (!el || target === null || document.activeElement !== el) return
    let pos = 0
    let seen = 0
    while (pos < el.value.length && seen < target) {
      if (/\d/.test(el.value.charAt(pos))) seen++
      pos++
    }
    el.setSelectionRange(pos, pos)
  })

  const setRefs = (el: HTMLInputElement | null) => {
    innerRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  return (
    <input
      {...rest}
      ref={setRefs}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={display}
      className={`num ${inputClass} ${className ?? ''}`}
      onChange={(e) => {
        const el = e.currentTarget
        const caret = el.selectionStart ?? el.value.length
        const raw = el.value
        const allDigits = raw.replace(/\D/g, '')
        const next = sanitizeDigits(raw)
        const before = raw.slice(0, caret).replace(/\D/g, '').length - (allDigits.length - next.length)
        pendingDigitsBeforeCaret.current = Math.max(0, before)
        onValueChange(next)
      }}
    />
  )
}
