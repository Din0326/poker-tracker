import type { ReactNode } from 'react'
import { FieldError } from '../../components/FieldError'
import { deriveAmountUnit, formatHandAmount, formatHandBb, formatSignedHandAmount, type HandGameType } from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'
import { CardSlots } from './CardSlots'
import { AmountField, Field, Switch, sectionTitleClass } from './formParts'
import {
  ERROR_KEYS,
  computeResultView,
  showdownErrorKey,
  showdownOpponents,
  type CompleteStage,
  type HandErrors,
  type HandFormValues,
  type ShowdownValues,
} from './handFormModel'
import { actorLabeler } from './actorLabel'
import { ActionLog } from './StreetStep'

const t = strings.hands

function netClass(value: number): string {
  return value > 0 ? 'text-(--color-gain)' : value < 0 ? 'text-(--color-loss)' : ''
}

type Props = {
  values: HandFormValues
  stage: Extract<CompleteStage, { step: 'result' }>
  errors: HandErrors
  gameType: HandGameType
  onShowdownChange: (seatNo: number, value: ShowdownValues) => void
  openShowdownPicker: (seatNo: number, index: number) => void
  onRakeChange: (rake: string) => void
  /** 標籤、備註（同 5.2，在此步驟） */
  children: ReactNode
}

// 5.3 步驟 6：攤牌 / 結果。系統依 4.6–4.9 即時顯示每個底池金額與贏家、每位玩家淨輸贏、Hero 結果
export function ResultStep({ values, stage, errors, gameType, onShowdownChange, openShowdownPicker, onRakeChange, children }: Props) {
  const unit = deriveAmountUnit('manual', gameType)
  const label = actorLabeler(stage.setup)
  const opponents = showdownOpponents(stage)
  const view = computeResultView(values, stage)
  const heroNet = view?.nets?.get(stage.setup.heroSeat) ?? null
  const potsError = errors[ERROR_KEYS.pots]
  const winnersText = (w: number[] | null) =>
    w === null ? strings.format.empty : w.map((s) => (s === stage.setup.heroSeat ? t.log.you : label(s))).join(t.result.winnerSeparator)

  return (
    <div data-testid="result-step">
      <ActionLog values={values} setup={stage.setup} unit={unit} runoutFrom={stage.state.runout ? firstRunoutStreet(stage) : null} />

      {opponents.length > 0 && (
        <section aria-labelledby="hand-showdown-title" className="mt-5">
          <h2 id="hand-showdown-title" className={sectionTitleClass}>
            {t.result.showdownTitle}
          </h2>
          <ul className="mt-2 space-y-2">
            {opponents.map((seatNo) => {
              const sd = values.showdown[String(seatNo)] ?? { cards: [null, null], mucked: false }
              const key = showdownErrorKey(seatNo)
              const error = errors[key]
              const errorId = `hand-showdown-${seatNo}-error`
              const who = label(seatNo)
              return (
                <li
                  key={seatNo}
                  data-field
                  data-error-key={key}
                  data-invalid={error ? 'true' : undefined}
                  data-testid="showdown-row"
                  className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 py-2"
                >
                  <p className="text-sm font-semibold">{who}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <CardSlots
                      label={who}
                      slots={sd.cards}
                      disabled={sd.mucked}
                      invalid={error !== undefined}
                      describedBy={describedBy(error && errorId)}
                      onOpen={(i) => openShowdownPicker(seatNo, i)}
                    />
                    <Switch
                      checked={sd.mucked}
                      label={`${who} ${t.result.muck}`}
                      text={t.result.muck}
                      onChange={() => onShowdownChange(seatNo, { cards: [null, null], mucked: !sd.mucked })}
                    />
                  </div>
                  <FieldError id={errorId} message={error} />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {gameType === 'cash' && (
        <AmountField id="hand-rake" label={t.fields.rake} errorKey={ERROR_KEYS.rake} value={values.rake} onChange={onRakeChange} error={errors[ERROR_KEYS.rake]} />
      )}

      <Field errorKey={ERROR_KEYS.pots} error={potsError} className="mt-5">
        <section aria-labelledby="hand-pots-title" data-testid="result-pots">
          <h2 id="hand-pots-title" className={sectionTitleClass}>
            {t.result.potsTitle}
          </h2>
          {/* data-pot-info：5.3 自動捲動的「底池資訊」（進入結果步驟後捲到此清單） */}
          <ul data-pot-info className="num mt-2 space-y-1 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm">
            {view?.pots.map((p, i) => (
              <li key={i} data-testid="pot-line">
                {t.result.potLine(i === 0 ? t.result.mainPot : t.result.sidePot(i), formatHandAmount(p.amount, unit), winnersText(p.winners))}
              </li>
            ))}
          </ul>
          <FieldError id="hand-pots-error" message={potsError} />
          {view?.nets && (
            <>
              <h3 className="mt-3 text-sm text-(--color-text-muted)">{t.result.netTitle}</h3>
              <ul className="num mt-1 space-y-0.5 text-sm" data-testid="result-nets">
                {stage.setup.config.seats.map(({ seatNo }) => {
                  const net = view.nets!.get(seatNo) ?? 0
                  return (
                    <li key={seatNo} className="flex justify-between gap-2">
                      <span>{label(seatNo)}</span>
                      <span className={netClass(net)}>{formatSignedHandAmount(net, unit)}</span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      </Field>

      {heroNet !== null && (
        <p data-testid="hero-result" className={`num mt-4 text-center text-xl font-bold ${netClass(heroNet)}`}>
          {t.result.heroResult(t.log.you, formatSignedHandAmount(heroNet, unit), formatHandBb(heroNet, stage.setup.config.bb))}
        </p>
      )}

      {children}
    </div>
  )
}

function firstRunoutStreet(stage: Extract<CompleteStage, { step: 'result' }>) {
  const order = ['preflop', 'flop', 'turn', 'river'] as const
  const last = stage.state.completedStreets[stage.state.completedStreets.length - 1]!
  return order[order.indexOf(last) + 1] ?? null
}
