import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type Ref } from 'react'
import { inputClass } from '../../components/controlStyles'
import { groupDigits } from '../../lib/digits'

// 手牌的金額輸入框（SPEC-v2-hands 3.8）：inputmode="numeric"，金額只接受整數（現金桌以元、錦標賽以籌碼）。
// - 可接受千分位逗號輸入，存值時去除；輸入中即時加千分位（只有數字時）
// - 與 v1 的 NumberInput 不同：小數點不會被自動移除，而是保留下來由驗證顯示「金額必須是整數」（5.5、HC31），
//   避免 `12.5` 被默默當成 125
// - 其他字元（$、空白、文字）自動移除；value / onValueChange 為只含數字與小數點的字串，'' 代表未填
// - 字級 ≥ 16px，避免 iOS Safari 聚焦時放大畫面

type Props = Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string
  onValueChange: (value: string) => void
  ref?: Ref<HTMLInputElement>
}

const KEEP = /[\d.]/

export function HandAmountInput({ value, onValueChange, className, ref, ...rest }: Props) {
  const innerRef = useRef<HTMLInputElement | null>(null)
  const pendingCharsBeforeCaret = useRef<number | null>(null)
  const display = value.includes('.') ? value : groupDigits(value)

  // 插入千分位逗號後，依「游標前的數字與小數點個數」還原游標位置
  useLayoutEffect(() => {
    const el = innerRef.current
    const target = pendingCharsBeforeCaret.current
    pendingCharsBeforeCaret.current = null
    if (!el || target === null || document.activeElement !== el) return
    let pos = 0
    let seen = 0
    while (pos < el.value.length && seen < target) {
      if (KEEP.test(el.value.charAt(pos))) seen++
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
        const next = el.value.replace(/[^\d.]/g, '')
        pendingCharsBeforeCaret.current = el.value.slice(0, caret).replace(/[^\d.]/g, '').length
        onValueChange(next)
      }}
    />
  )
}
