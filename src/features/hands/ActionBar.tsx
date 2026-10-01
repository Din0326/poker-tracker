import { useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { FieldError } from '../../components/FieldError'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import {
  formatHandAmount,
  legalActions,
  positionText,
  positionsBySeat,
  quickBetSizesFor,
  type AmountUnit,
  type EngineState,
  type HandGameType,
  type LegalActions,
  type QuickSize,
} from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'
import { labelClass } from './formParts'
import { HandAmountInput } from './HandAmountInput'
import { betAmountError, parseAmount } from './handFormModel'

const t = strings.hands

export type ActionChoice = { type: 'fold' | 'check' | 'call'; to: null } | { type: 'bet' | 'raise'; to: number }

type Props = {
  state: EngineState
  heroSeat: number
  unit: AmountUnit
  gameType: HandGameType
  onAction: (choice: ActionChoice) => void
}

const actionButtonClass = `${secondaryButtonClass} min-h-12 px-2 text-sm leading-tight whitespace-normal`

// 5.3 行動列（固定在分頁列上方）：輪到誰、合法行動按鈕（4.3：toCall > 0 時不顯示「過牌」；toCall = 0 時不顯示「棄牌」與「跟注」；
// 不可加注時不顯示「加注」）。按「下注 / 加注」開啟 bottom sheet：快捷金額（4.11）與自訂金額
export function ActionBar({ state, heroSeat, unit, gameType, onAction }: Props) {
  const legal = legalActions(state)
  const [sheet, setSheet] = useState<'bet' | 'raise' | null>(null)
  if (!legal) return null
  const money = (n: number) => formatHandAmount(n, unit)
  const seatNos = state.players.map((p) => p.seatNo)
  const position = positionsBySeat(seatNos, state.buttonSeat).get(legal.seatNo)
  const posText = position ? positionText(position) : strings.format.empty
  const who = legal.seatNo === heroSeat ? t.heroWho(t.log.you, posText) : posText
  const callAllIn = legal.callAmount >= legal.stack

  return (
    <div data-testid="action-bar">
      <p className="num text-center text-sm font-semibold" data-testid="to-act">
        {t.toAct(who, legal.seatNo, money(legal.stack))}
      </p>
      <div role="group" aria-label={t.actions.label} className="mt-2 grid auto-cols-fr grid-flow-col gap-2">
        {legal.toCall > 0 && (
          <button type="button" onClick={() => onAction({ type: 'fold', to: null })} className={actionButtonClass}>
            {t.actions.fold}
          </button>
        )}
        {legal.canCheck && (
          <button type="button" onClick={() => onAction({ type: 'check', to: null })} className={actionButtonClass}>
            {t.actions.check}
          </button>
        )}
        {legal.canCall && (
          <button type="button" onClick={() => onAction({ type: 'call', to: null })} className={actionButtonClass}>
            {callAllIn ? t.actions.callAllIn(money(legal.callAmount)) : t.actions.call(money(legal.callAmount))}
          </button>
        )}
        {legal.canBet && (
          <button type="button" onClick={() => setSheet('bet')} className={actionButtonClass}>
            {t.actions.bet}
          </button>
        )}
        {legal.canRaise && (
          <button type="button" onClick={() => setSheet('raise')} className={actionButtonClass}>
            {t.actions.raise}
          </button>
        )}
      </div>
      <BetSheet
        kind={sheet}
        state={state}
        legal={legal}
        unit={unit}
        gameType={gameType}
        onClose={() => setSheet(null)}
        onSubmit={(to) => {
          setSheet(null)
          onAction({ type: sheet === 'raise' ? 'raise' : 'bet', to })
        }}
      />
    </div>
  )
}

type SheetProps = {
  kind: 'bet' | 'raise' | null
  state: EngineState
  legal: LegalActions
  unit: AmountUnit
  gameType: HandGameType
  onClose: () => void
  onSubmit: (to: number) => void
}

export function BetSheet({ kind, state, legal, unit, gameType, onClose, onSubmit }: SheetProps) {
  return (
    <BottomSheet open={kind !== null} title={kind === 'raise' ? t.betSheet.raise : t.betSheet.bet} onClose={onClose}>
      {kind !== null && <BetSheetBody key={`${legal.seatNo}-${kind}`} kind={kind} state={state} legal={legal} unit={unit} gameType={gameType} onSubmit={onSubmit} />}
    </BottomSheet>
  )
}

function BetSheetBody({ kind, state, legal, unit, gameType, onSubmit }: Omit<SheetProps, 'kind' | 'onClose'> & { kind: 'bet' | 'raise' }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const sizes = quickBetSizesFor(state)
  const money = (n: number) => formatHandAmount(n, unit)
  const quick: { key: string; label: string; size: QuickSize }[] = sizes
    ? [
        { key: 'min', label: t.betSheet.min, size: sizes.min },
        { key: 'half', label: t.betSheet.half, size: sizes.half },
        { key: 'twoThirds', label: t.betSheet.twoThirds, size: sizes.twoThirds },
        { key: 'pot', label: t.betSheet.pot, size: sizes.pot },
        { key: 'allIn', label: t.betSheet.allIn, size: sizes.allIn },
      ]
    : []
  const inputId = 'hand-bet-to'
  const errorId = `${inputId}-error`
  const check = (text: string) => betAmountError(text, kind, legal, state.bb, unit, gameType)

  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        setSubmitted(true)
        const err = check(value)
        setError(err)
        const r = parseAmount(value)
        if (err === null && r.ok) onSubmit(r.value)
      }}
    >
      <p className={labelClass}>{t.betSheet.quickLabel}</p>
      <div role="group" aria-label={t.betSheet.quickLabel} className="grid grid-cols-3 gap-2" data-testid="quick-sizes">
        {quick.map((q) => (
          <button
            key={q.key}
            type="button"
            data-testid={`quick-${q.key}`}
            onClick={() => {
              const text = String(q.size.to)
              setValue(text)
              if (submitted) setError(check(text))
            }}
            className={`${secondaryButtonClass} min-h-12 px-1 text-sm leading-tight whitespace-normal`}
          >
            {/* 夾限後等於全下時按鈕文字改為「全下 $15,900」（4.11） */}
            {t.betSheet.quick(q.size.allIn ? t.betSheet.allIn : q.label, money(q.size.to))}
          </button>
        ))}
      </div>
      <label htmlFor={inputId} className={`${labelClass} mt-4`}>
        {kind === 'raise' ? t.betSheet.raiseTo : t.betSheet.betTo}
      </label>
      <HandAmountInput
        id={inputId}
        value={value}
        onValueChange={(text) => {
          setValue(text)
          if (submitted) setError(check(text))
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && errorId)}
      />
      <FieldError id={errorId} message={error ?? undefined} />
      <button type="submit" className={`${primaryButtonClass} mt-4 w-full`}>
        {t.betSheet.confirm}
      </button>
    </form>
  )
}
