import { useState, type ReactNode } from 'react'
import { FieldError } from '../../components/FieldError'
import { SegmentedControl } from '../../components/SegmentedControl'
import { SelectBox } from '../../components/SelectBox'
import { deriveAmountUnit, forcedSeats, formatHandAmount, formatStackBb, positionText, positionsBySeat } from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'
import { CardSlots } from './CardSlots'
import { AmountField, Field, GameTypeField, Switch, labelClass, sectionTitleClass } from './formParts'
import {
  ERROR_KEYS,
  OTHER_TABLE_SIZES,
  TABLE_SIZE_PRESETS,
  occupiedSeats,
  parseAmount,
  seatErrorKey,
  type HandErrors,
  type HandFormValues,
} from './handFormModel'
import { HandAmountInput } from './HandAmountInput'

const t = strings.hands
const OTHER = 'other'

type Props = {
  values: HandFormValues
  errors: HandErrors
  /** 時間、關聯場次（共用欄位，由 HandForm 渲染後傳入） */
  timeAndSession: ReactNode
  /** 修改牌局設定欄位（已有行動時需先確認，5.8） */
  onSetupChange: (update: (v: HandFormValues) => HandFormValues) => void
  /** 修改不影響行動的欄位（你的手牌） */
  openHeroPicker: (index: number) => void
  gameTypeLocked: boolean
}

// 5.3 步驟 1：牌局設定。座位圖每座位一列（不畫圓桌），375px 寬度下觸控區足夠
export function SetupStep({ values, errors, timeAndSession, onSetupChange, openHeroPicker, gameTypeLocked }: Props) {
  const [otherSize, setOtherSize] = useState(!TABLE_SIZE_PRESETS.includes(values.tableSize as (typeof TABLE_SIZE_PRESETS)[number]))
  const unit = deriveAmountUnit('manual', values.gameType)
  const occupied = occupiedSeats(values)
  const positions = occupied.includes(values.buttonSeat) ? positionsBySeat(occupied, values.buttonSeat) : new Map()
  const straddleSeat =
    values.straddle && occupied.length >= 3 && occupied.includes(values.buttonSeat) ? forcedSeats(occupied, values.buttonSeat, true).straddleSeat : null
  const bb = parseAmount(values.setupBb)
  const stack = parseAmount(values.defaultStack)
  const stackHint = bb.ok && bb.value > 0 && stack.ok ? formatStackBb(stack.value, bb.value) : strings.format.empty
  const seatsError = errors[ERROR_KEYS.seats] ?? errors[ERROR_KEYS.buttonSeat] ?? errors[ERROR_KEYS.heroSeat]
  const seatsErrorKey = errors[ERROR_KEYS.seats] ? ERROR_KEYS.seats : errors[ERROR_KEYS.buttonSeat] ? ERROR_KEYS.buttonSeat : ERROR_KEYS.heroSeat
  const heroError = errors[ERROR_KEYS.heroCards]

  const sizeValue = otherSize ? OTHER : String(values.tableSize)
  const setSize = (n: number) => onSetupChange((v) => ({ ...v, tableSize: n, buttonSeat: v.buttonSeat > n ? 1 : v.buttonSeat, heroSeat: v.heroSeat !== null && v.heroSeat > n ? null : v.heroSeat }))

  return (
    <div data-testid="setup-step">
      {timeAndSession}
      <GameTypeField
        value={values.gameType}
        onChange={(g) => onSetupChange((v) => ({ ...v, gameType: g }))}
        disabled={gameTypeLocked}
        {...(gameTypeLocked ? { hint: t.gameTypeLocked } : {})}
      />

      <div className="mt-4">
        <p className={labelClass}>{t.fields.tableSize}</p>
        <SegmentedControl
          label={t.fields.tableSize}
          options={[...TABLE_SIZE_PRESETS.map((n) => ({ value: String(n), label: String(n) })), { value: OTHER, label: t.tableSizeOther }]}
          value={sizeValue}
          onChange={(value) => {
            if (value === OTHER) {
              setOtherSize(true)
              return
            }
            setOtherSize(false)
            setSize(Number(value))
          }}
        />
        {otherSize && (
          <div className="mt-2">
            <SelectBox
              id="hand-table-size"
              aria-label={t.fields.tableSizeOther}
              value={String(values.tableSize)}
              onChange={(e) => setSize(Number(e.target.value))}
            >
              {OTHER_TABLE_SIZES.map((n) => (
                <option key={n} value={String(n)}>
                  {t.tableSizeOption(n)}
                </option>
              ))}
            </SelectBox>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AmountField
          id="hand-sb"
          label={t.fields.sb}
          errorKey={ERROR_KEYS.sb}
          value={values.sb}
          onChange={(sb) => onSetupChange((v) => ({ ...v, sb }))}
          error={errors[ERROR_KEYS.sb]}
        />
        <AmountField
          id="hand-setup-bb"
          label={t.fields.setupBb}
          errorKey={ERROR_KEYS.setupBb}
          value={values.setupBb}
          onChange={(setupBb) => onSetupChange((v) => ({ ...v, setupBb }))}
          error={errors[ERROR_KEYS.setupBb]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <AmountField
          id="hand-ante"
          label={t.fields.ante}
          errorKey={ERROR_KEYS.ante}
          value={values.ante}
          placeholder="0"
          onChange={(ante) => onSetupChange((v) => ({ ...v, ante }))}
          error={errors[ERROR_KEYS.ante]}
        />
        <Field errorKey={ERROR_KEYS.straddle} error={errors[ERROR_KEYS.straddle]} className="mt-4 min-w-0">
          <p className={labelClass}>{t.fields.straddle}</p>
          <Switch
            checked={values.straddle}
            onChange={() => onSetupChange((v) => ({ ...v, straddle: !v.straddle }))}
            label={t.fields.straddle}
            text={values.straddle && bb.ok ? t.straddleAmount(formatHandAmount(2 * bb.value, unit)) : ''}
          />
          <FieldError id="hand-straddle-error" message={errors[ERROR_KEYS.straddle]} />
        </Field>
      </div>
      <AmountField
        id="hand-default-stack"
        label={t.fields.defaultStack}
        errorKey={ERROR_KEYS.defaultStack}
        value={values.defaultStack}
        onChange={(defaultStack) =>
          onSetupChange((v) => ({ ...v, defaultStack, seats: v.seats.map((s) => (s.edited ? s : { ...s, stack: defaultStack })) }))
        }
        error={errors[ERROR_KEYS.defaultStack]}
        hint={stackHint}
      />

      <section aria-labelledby="hand-seats-title" className="mt-5">
        <Field errorKey={seatsErrorKey} error={seatsError} className="">
          <h2 id="hand-seats-title" className={sectionTitleClass}>
            {t.fields.seats}
          </h2>
          <FieldError id="hand-seats-error" message={seatsError} />
        </Field>
        <ol className="mt-2 space-y-2" aria-describedby={describedBy(seatsError && 'hand-seats-error')}>
          {Array.from({ length: values.tableSize }, (_, i) => {
            const seatNo = i + 1
            const seat = values.seats[i]!
            const key = seatErrorKey(seatNo)
            const error = errors[key]
            const position = positions.get(seatNo)
            const stackId = `hand-seat-${seatNo}-stack`
            return (
              <li
                key={seatNo}
                data-field
                data-error-key={key}
                data-invalid={error ? 'true' : undefined}
                data-testid="seat-row"
                className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 pt-1 pb-3"
              >
                <div className="flex min-h-(--touch-min) items-center gap-2">
                  <span className="text-sm font-semibold">{t.seat.label(seatNo)}</span>
                  {position && !seat.empty && (
                    <span data-testid="seat-position" className="rounded-(--radius-control) border border-(--color-border) px-1.5 text-xs font-semibold">
                      {positionText(position)}
                    </span>
                  )}
                  {straddleSeat === seatNo && (
                    <span className="rounded-(--radius-control) border border-(--color-border) px-1.5 text-xs">{t.seat.straddleBadge}</span>
                  )}
                  <span className="flex-1" />
                  <Switch
                    checked={seat.empty}
                    onChange={() => onSetupChange((v) => ({ ...v, seats: v.seats.map((s, j) => (j === i ? { ...s, empty: !s.empty } : s)) }))}
                    label={t.seat.emptyLabel(seatNo)}
                    text={t.seat.empty}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <HandAmountInput
                      id={stackId}
                      value={seat.stack}
                      disabled={seat.empty}
                      aria-label={t.seat.stackLabel(seatNo)}
                      onValueChange={(value) =>
                        onSetupChange((v) => ({ ...v, seats: v.seats.map((s, j) => (j === i ? { ...s, stack: value, edited: true } : s)) }))
                      }
                      aria-invalid={error ? true : undefined}
                      aria-describedby={describedBy(error && `${stackId}-error`)}
                    />
                  </div>
                  <RadioPill
                    name="hand-button"
                    checked={values.buttonSeat === seatNo}
                    label={t.seat.buttonLabel(seatNo)}
                    text={t.seat.button}
                    onChange={() => onSetupChange((v) => ({ ...v, buttonSeat: seatNo }))}
                  />
                  <RadioPill
                    name="hand-hero"
                    checked={values.heroSeat === seatNo}
                    label={t.seat.heroLabel(seatNo)}
                    text={t.seat.hero}
                    onChange={() => onSetupChange((v) => ({ ...v, heroSeat: seatNo }))}
                  />
                </div>
                <FieldError id={`${stackId}-error`} message={error} />
              </li>
            )
          })}
        </ol>
      </section>

      <Field errorKey={ERROR_KEYS.heroCards} error={heroError} className="mt-5">
        <p id="hand-setup-hero-label" className={labelClass}>
          {t.fields.yourCards}
        </p>
        <CardSlots
          label={t.fields.yourCards}
          slots={values.heroCards}
          onOpen={openHeroPicker}
          invalid={heroError !== undefined}
          describedBy={describedBy(heroError && 'hand-setup-hero-error')}
          testId="setup-hero-cards"
        />
        <FieldError id="hand-setup-hero-error" message={heroError} />
      </Field>
    </div>
  )
}

/** 座位圖的「按鈕」「你」單選：原生 radio，外框觸控區 ≥ 44×44px */
function RadioPill({ name, checked, label, text, onChange }: { name: string; checked: boolean; label: string; text: string; onChange: () => void }) {
  return (
    <label
      className={`relative flex min-h-(--touch-min) min-w-(--touch-min) shrink-0 cursor-pointer items-center justify-center gap-1 rounded-(--radius-control) px-2 text-sm inset-ring has-focus-visible:outline-2 has-focus-visible:outline-(--color-accent) has-disabled:opacity-60 ${
        checked ? 'bg-(--color-accent) font-semibold text-(--color-on-accent) inset-ring-(--color-accent)' : 'bg-(--color-surface-raised) inset-ring-(--color-border)'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} aria-label={label} className="absolute inset-0 m-0 size-full cursor-pointer opacity-0" />
      <span aria-hidden="true">{text}</span>
    </label>
  )
}
