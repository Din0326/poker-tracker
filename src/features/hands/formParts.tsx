import type { ReactNode } from 'react'
import { FieldError } from '../../components/FieldError'
import { SegmentedControl } from '../../components/SegmentedControl'
import { HAND_GAME_TYPES, type HandGameType } from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'
import { HandAmountInput } from './HandAmountInput'

// 新增 / 編輯手牌頁共用的小元件：欄位外框、金額欄位、牌局類型

export const labelClass = 'mb-1 block text-sm font-medium text-(--color-text-muted)'
export const hintClass = 'mt-1 text-xs text-(--color-text-muted)'
export const sectionTitleClass = 'text-sm font-semibold text-(--color-text-muted)'

/** 欄位外框：data-error-key 對應錯誤 key，data-invalid 供「捲動到第一個錯誤」使用 */
export function Field({
  errorKey,
  error,
  className,
  children,
}: {
  errorKey: string
  error: string | undefined
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <div data-field data-error-key={errorKey} data-invalid={error ? 'true' : undefined} className={className ?? 'mt-4'}>
      {children}
    </div>
  )
}

/** 金額欄位（3.8 整數輸入）：可見標籤、錯誤訊息以 aria-describedby 關聯 */
export function AmountField({
  id,
  label,
  errorKey,
  value,
  onChange,
  error,
  hint,
  disabled,
  placeholder,
  className,
}: {
  id: string
  label: string
  errorKey: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
  hint?: ReactNode
  disabled?: boolean | undefined
  placeholder?: string | undefined
  className?: string | undefined
}) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  return (
    <Field errorKey={errorKey} error={error} className={className ?? 'mt-4 min-w-0'}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <HandAmountInput
        id={id}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && errorId, hint !== undefined && hintId)}
      />
      {hint !== undefined && (
        <p id={hintId} className={`num ${hintClass}`}>
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </Field>
  )
}

export function GameTypeField({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: HandGameType
  onChange: (value: HandGameType) => void
  disabled?: boolean | undefined
  hint?: string | undefined
}) {
  const t = strings.hands
  return (
    <div className="mt-4">
      <p className={labelClass}>{t.fields.gameType}</p>
      <fieldset disabled={disabled} className="min-w-0">
        <SegmentedControl
          label={t.fields.gameType}
          options={HAND_GAME_TYPES.map((g) => ({ value: g, label: t.gameTypes[g] }))}
          value={value}
          onChange={onChange}
        />
      </fieldset>
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

/** 開關（Straddle、空位）：原生 button + role="switch" */
export function Switch({
  checked,
  onChange,
  label,
  text,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  label: string
  /** 開關旁的可見文字；空字串時不顯示 */
  text: string
  disabled?: boolean | undefined
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="flex min-h-(--touch-min) min-w-(--touch-min) items-center gap-2 rounded-(--radius-control) px-1 text-sm disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-6 w-10 rounded-full border border-(--color-border) ${checked ? 'bg-(--color-accent)' : 'bg-(--color-surface-raised)'}`}
      >
        <span
          className={`absolute top-0.5 left-0 size-4.5 rounded-full bg-(--color-surface) shadow-sm transition-transform duration-(--motion-duration) motion-reduce:transition-none ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </span>
      {text !== '' && <span>{text}</span>}
    </button>
  )
}
