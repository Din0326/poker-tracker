import { PERIOD_KINDS, type PeriodError, type PeriodKind, type PeriodSelection } from '../domain'
import { describedBy } from '../lib/aria'
import { strings } from '../strings'
import { FieldError } from './FieldError'
import { inputClass } from './controlStyles'
import { SelectBox } from './SelectBox'

// 期間選擇（4.5）：報表（6.1）與紀錄列表（7.1）共用。
// 分成期間選單與自訂起迄兩個元件，讓呼叫端各自決定版面位置；
// idPrefix 決定元素 id（例 `sl` → `sl-period`、`sl-from`、`sl-to`、`sl-range-error`）。

const t = strings.period
const labelClass = 'mb-1 block text-sm font-medium text-(--color-text-muted)'

type SelectProps = {
  idPrefix: string
  value: PeriodKind
  onChange: (period: PeriodKind) => void
}

/** 期間選單：全部 / 近半年 / 近三個月 / 自訂 */
export function PeriodSelect({ idPrefix, value, onChange }: SelectProps) {
  const id = `${idPrefix}-period`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelClass}>
        {t.label}
      </label>
      <SelectBox id={id} value={value} onChange={(e) => onChange(e.target.value as PeriodKind)}>
        {PERIOD_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t.options[kind]}
          </option>
        ))}
      </SelectBox>
    </div>
  )
}

type RangeProps = {
  idPrefix: string
  value: Pick<PeriodSelection, 'from' | 'to'>
  onChange: (patch: Partial<Pick<PeriodSelection, 'from' | 'to'>>) => void
  /** resolvePeriod 的錯誤；只有 fromAfterTo 顯示訊息（起迄未填齊時不顯示、不套用） */
  error: PeriodError | null
}

/** 自訂期間的起迄日期（選自訂時才由呼叫端顯示） */
export function CustomRangeFields({ idPrefix, value, onChange, error }: RangeProps) {
  const errorId = `${idPrefix}-range-error`
  const message = error === 'fromAfterTo' ? t.fromAfterTo : undefined
  const field = (key: 'from' | 'to') => (
    <div className="min-w-0">
      <label htmlFor={`${idPrefix}-${key}`} className={labelClass}>
        {t[key]}
      </label>
      <input
        id={`${idPrefix}-${key}`}
        type="date"
        value={value[key]}
        onChange={(e) => onChange({ [key]: e.target.value })}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy(message && errorId)}
        className={`num ${inputClass}`}
      />
    </div>
  )
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {field('from')}
        {field('to')}
      </div>
      <FieldError id={errorId} message={message} />
    </div>
  )
}
