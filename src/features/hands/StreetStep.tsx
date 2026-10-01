import { FieldError } from '../../components/FieldError'
import {
  boardCountFor,
  currentPot,
  deriveAmountUnit,
  describeActions,
  formatHandAmount,
  type AmountUnit,
  type HandGameType,
  type Street,
} from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'
import { CardList } from './CardFace'
import { CardSlots } from './CardSlots'
import { actorLabeler } from './actorLabel'
import { actionPhrase } from './handDetailView'
import { Field, labelClass, sectionTitleClass } from './formParts'
import { ERROR_KEYS, confirmedBoard, pendingBoardSlots, type CompleteStage, type HandErrors, type HandFormValues, type ParsedSetup } from './handFormModel'

const t = strings.hands
const STREET_LIST: readonly Street[] = ['preflop', 'flop', 'turn', 'river']

type LogProps = {
  values: HandFormValues
  setup: ParsedSetup
  unit: AmountUnit
  /** 只顯示到這條街（回看已完成的步驟時） */
  untilStreet?: Street | undefined
  runoutFrom?: Street | null | undefined
}

// 5.3 本手行動紀錄：依街分組、最新在下；街標題顯示該街公牌（6.2 寫法）
export function ActionLog({ values, setup, unit, untilStreet, runoutFrom }: LogProps) {
  const entries = describeActions(setup.config, values.actions)
  const board = confirmedBoard(values)
  const label = actorLabeler(setup)
  const streets = STREET_LIST.filter((s, i) => {
    if (untilStreet !== undefined && i > STREET_LIST.indexOf(untilStreet)) return false
    return s === 'preflop' || entries.some((x) => x.action.street === s) || board.length >= boardCountFor(s)
  })
  return (
    <section aria-labelledby="hand-log-title" className="mt-4" data-testid="action-log">
      <h2 id="hand-log-title" className={sectionTitleClass}>
        {t.log.title}
      </h2>
      <div className="mt-2 space-y-3">
        {streets.map((street) => {
          const lines = entries.filter((x) => x.action.street === street)
          const cards = street === 'preflop' ? [] : street === 'flop' ? board.slice(0, 3) : board.slice(boardCountFor(street) - 1, boardCountFor(street))
          const isRunout = runoutFrom !== null && runoutFrom !== undefined && STREET_LIST.indexOf(street) >= STREET_LIST.indexOf(runoutFrom) && lines.length === 0
          return (
            <div key={street} data-testid={`log-${street}`} className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 py-2">
              <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                <span>{t.streets[street]}</span>
                {cards.length > 0 && <CardList cards={cards} />}
                {isRunout && <span className="text-xs font-normal text-(--color-text-muted)">{t.runoutNote}</span>}
              </h3>
              {lines.length > 0 && (
                <ol className="num mt-1 space-y-0.5 text-sm">
                  {lines.map((x, i) => (
                    <li key={i} data-testid="log-line">
                      {t.log.line(label(x.action.seatNo), actionPhrase(x.action.type, x.amount, x.allIn, unit))}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

type Props = {
  values: HandFormValues
  stage: Exclude<CompleteStage, { step: 'setup' | 'result' }>
  errors: HandErrors
  gameType: HandGameType
  openBoardPicker: (indices: number[], start: number, title: string, label: string) => void
}

// 5.3 步驟 2–5：上方行動紀錄、目前公牌、底池 P、目前下注額；翻牌、轉牌、河牌開始時先選公牌
export function StreetStep({ values, stage, errors, gameType, openBoardPicker }: Props) {
  const unit = deriveAmountUnit('manual', gameType)
  const pending = pendingBoardSlots(values, stage)
  const boardError = errors[ERROR_KEYS.streetBoard]
  const pickerTitle = stage.runout ? t.cardPicker.titles.runout : t.cardPicker.titles[stage.step as 'flop' | 'turn' | 'river']

  return (
    <div data-testid={`street-step-${stage.step}`}>
      <ActionLog values={values} setup={stage.setup} unit={unit} runoutFrom={stage.runout ? stage.step : null} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="pot-line">
        <span className="num font-semibold">{t.pot(formatHandAmount(currentPot(stage.state), unit))}</span>
        {stage.phase === 'action' && <span className="num text-(--color-text-muted)">{t.currentBet(formatHandAmount(stage.state.currentBet, unit))}</span>}
      </div>

      {stage.phase === 'board' && (
        <Field errorKey={ERROR_KEYS.streetBoard} error={boardError}>
          <p className={labelClass}>
            {stage.runout ? t.cardPicker.titles.runout : t.streets[stage.step]}
            {stage.runout && <span className="ml-2 text-xs font-normal">{t.runoutNote}</span>}
          </p>
          <CardSlots
            label={t.fields.board}
            slots={values.board}
            indices={pending}
            invalid={boardError !== undefined}
            describedBy={describedBy(boardError && 'hand-street-board-error')}
            onOpen={(i) => openBoardPicker(pending, i, pickerTitle, t.fields.board)}
            testId="street-board-slots"
          />
          <FieldError id="hand-street-board-error" message={boardError} />
        </Field>
      )}
    </div>
  )
}
