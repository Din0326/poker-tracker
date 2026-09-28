import { ChevronDown } from 'lucide-react'
import type { ComponentPropsWithoutRef, Ref } from 'react'
import { selectClass } from './controlStyles'

type Props = ComponentPropsWithoutRef<'select'> & { ref?: Ref<HTMLSelectElement> }

// 原生 <select>（iOS 會叫出系統滾輪選單），外觀統一並疊上箭頭圖示
export function SelectBox({ className, children, ref, ...rest }: Props) {
  return (
    <div className={`relative min-w-0 ${className ?? ''}`}>
      <select {...rest} ref={ref} className={selectClass}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={18}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
      />
    </div>
  )
}
