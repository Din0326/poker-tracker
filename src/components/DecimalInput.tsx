import type { ComponentPropsWithoutRef, Ref } from 'react'
import { sanitizeDecimal } from '../domain'
import { inputClass } from './controlStyles'

// 小數輸入框（5.3 賣股份的比例、加價倍數）
// - inputmode="decimal" 叫出含小數點的數字鍵盤；字級 ≥ 16px，避免 iOS Safari 聚焦時放大畫面
// - 只接受數字與一個小數點：輸入或貼上含 %、×、x、空白等字元時自動移除
// value / onValueChange 為過濾後的原始字串，'' 代表未填

type Props = Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string
  onValueChange: (text: string) => void
  ref?: Ref<HTMLInputElement>
}

export function DecimalInput({ value, onValueChange, className, ref, ...rest }: Props) {
  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      className={`num ${inputClass} ${className ?? ''}`}
      onChange={(e) => onValueChange(sanitizeDecimal(e.currentTarget.value))}
    />
  )
}
