import dayjs from 'dayjs'
import { FieldError } from '../../components/FieldError'
import { SelectBox } from '../../components/SelectBox'
import { inputClass } from '../../components/controlStyles'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'
import { HOURS, MINUTES, formatPlayedAtText, type HandFormValues } from './handFormModel'

const t = strings.hands

type TimeValues = Pick<HandFormValues, 'date' | 'hour' | 'minute'>

type Props = {
  idPrefix: string
  value: TimeValues
  onChange: (patch: Partial<TimeValues>) => void
  error: string | undefined
  now: Date
  disabled?: boolean
}

// 5.2 時間：日期選擇器 + 小時（0–23）+ 分鐘（0–55，每 5 分鐘）；顯示 `2026/09/30 21:15`
export function TimeField({ idPrefix, value, onChange, error, now, disabled }: Props) {
  const errorId = `${idPrefix}-time-error`
  const invalid = error ? (true as const) : undefined
  const text = formatPlayedAtText(value)
  // 編輯既有手牌時，分鐘可能不是 5 的倍數（例如備份匯入的資料）：仍列出原值
  const minutes = MINUTES.includes(Number(value.minute)) ? MINUTES : [...MINUTES, Number(value.minute)].sort((a, b) => a - b)
  return (
    <fieldset data-field data-error-key="date" data-invalid={error ? 'true' : undefined} className="mt-4 min-w-0" aria-describedby={describedBy(error && errorId)}>
      <legend className="mb-1 text-sm font-medium text-(--color-text-muted)">{t.fields.time}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-2">
        <input
          id={`${idPrefix}-date`}
          type="date"
          max={dayjs(now).format('YYYY-MM-DD')}
          value={value.date}
          disabled={disabled}
          onChange={(e) => onChange({ date: e.target.value })}
          aria-label={t.fields.date}
          aria-invalid={invalid}
          aria-describedby={describedBy(error && errorId)}
          className={`num ${inputClass}`}
        />
        <SelectBox
          id={`${idPrefix}-hour`}
          value={value.hour}
          disabled={disabled}
          onChange={(e) => onChange({ hour: e.target.value })}
          aria-label={t.fields.hour}
          aria-invalid={invalid}
          aria-describedby={describedBy(error && errorId)}
        >
          {HOURS.map((h) => (
            <option key={h} value={String(h)}>
              {t.hourOption(h)}
            </option>
          ))}
        </SelectBox>
        <SelectBox
          id={`${idPrefix}-minute`}
          value={value.minute}
          disabled={disabled}
          onChange={(e) => onChange({ minute: e.target.value })}
          aria-label={t.fields.minute}
          aria-invalid={invalid}
          aria-describedby={describedBy(error && errorId)}
        >
          {minutes.map((m) => (
            <option key={m} value={String(m)}>
              {t.minuteOption(m)}
            </option>
          ))}
        </SelectBox>
      </div>
      {text && (
        <p className="num mt-1 text-xs text-(--color-text-muted)" data-testid="hand-time-display">
          {text}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </fieldset>
  )
}
