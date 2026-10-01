import { MoreHorizontal, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { FieldError } from '../../components/FieldError'
import { Page } from '../../components/Page'
import { SegmentedControl } from '../../components/SegmentedControl'
import { SelectBox } from '../../components/SelectBox'
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass, textareaClass } from '../../components/controlStyles'
import type { HandInput, HandPatch } from '../../db'
import { charCount, type Session } from '../../domain'
import {
  MAX_HAND_NOTE_LENGTH,
  POSITIONS,
  analyzeDetail,
  deriveAmountUnit,
  formatSignedHandAmount,
  handTagHistory,
  positionText,
  type Hand,
  type HandSetup,
  type Position,
} from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { useAppData } from '../../lib/appData'
import { registerDraftFlusher } from '../../lib/draftFlush'
import { showGlobalToast } from '../../lib/globalToast'
import { OBSCURES_BOTTOM_ATTR, useKeepFocusedVisible } from '../../lib/viewport'
import { strings } from '../../strings'
import { ActionBar, type ActionChoice } from './ActionBar'
import { CardPicker, type PickerRequest } from './CardPicker'
import { CardSlots } from './CardSlots'
import { AmountField, Field, GameTypeField, labelClass } from './formParts'
import {
  ERROR_KEYS,
  RESULT_CHOICES,
  addAction,
  boardDone,
  boardMissingError,
  buildDetail,
  canUndo,
  clearActions,
  completeFromSimple,
  confirmBoard,
  confirmedBoard,
  deriveStage,
  discardComplete,
  parseAmount,
  stepStatuses,
  toCompleteInput,
  toHandDraft,
  toHandSetup,
  toSimpleInput,
  undoStep,
  usedCards,
  validateCompleteSave,
  validateSetupStep,
  validateSimple,
  validateTimeAndSession,
  valuesEqual,
  type CardSlot,
  type CompleteStage,
  type HandErrors,
  type HandFormValues,
  type ProgressStep,
  type ResultChoice,
  type ShowdownValues,
  type ValidationContext,
} from './handFormModel'
import { ProgressSteps } from './ProgressSteps'
import { ResultStep } from './ResultStep'
import { SessionField, type SessionChoice } from './SessionField'
import { SetupStep } from './SetupStep'
import { actorLabeler } from './actorLabel'
import { ActionLog, StreetStep } from './StreetStep'
import { TagInput } from './TagInput'
import { TimeField } from './TimeField'

const t = strings.hands
const DRAFT_DEBOUNCE_MS = 500
const SUCCESS_TOAST_MS = 3000
const ERROR_TOAST_MS = 5000
const systemNow = () => new Date()

/** 5.1 步驟 1 的錯誤 key：回看時切到設定步驟才看得到 */
const SETUP_KEYS = new Set<string>([ERROR_KEYS.date, ERROR_KEYS.sessionId, ERROR_KEYS.heroCards])

/** 新增 / 編輯手牌頁需要的資料 */
export interface HandFormData {
  /** 全部場次（新到舊），label 為「09/27 · 標題」 */
  sessions: SessionChoice[]
  sessionsById: ReadonlyMap<string, Pick<Session, 'type'>>
  lastHandSetup: HandSetup | undefined
}

type Validator = 'simple' | 'setup' | 'board' | 'save' | 'partial' | 'locked'

type PickerTarget = { kind: 'hero' } | { kind: 'board' } | { kind: 'showdown'; seatNo: number }

type Props = {
  mode: 'create' | 'edit'
  data: HandFormData
  /** 表單初始值（新增：預帶值或還原的草稿；編輯：手牌原值） */
  initial: HandFormValues
  /** 判斷「有任何輸入 / 未儲存變更」的基準（新增：剛進頁面的預帶值；編輯：手牌原值） */
  baseline: HandFormValues
  /** 新增模式：產生新的預帶值（「清除」、5.1 從完整切到簡易時捨棄牌局設定） */
  makeEntry: () => HandFormValues
  /** 編輯模式：要編輯的手牌 */
  hand?: Hand | undefined
  title: string
  backTo: string
  onDirtyChange?: ((dirty: boolean) => void) | undefined
  onSaved: (hand: Hand) => void
  /** 測試用：注入現在時間 */
  now?: (() => Date) | undefined
}

// 新增 / 編輯手牌（SPEC-v2-hands 第 5 節）：簡易模式（5.2）與完整模式的逐步流程（5.3）。
// 規則與計算全部來自 domain/hands；本元件只負責畫面狀態、驗證時機（5.5）、草稿（5.7）與儲存（5.8）。
export function HandForm({ mode, data, initial, baseline: initialBaseline, makeEntry, hand, title, backTo, onDirtyChange, onSaved, now = systemNow }: Props) {
  const { db, repos } = useAppData()
  const isEdit = mode === 'edit'
  const locked = hand?.source === 'gg'
  const [values, setValues] = useState(initial)
  const [baseline, setBaseline] = useState(initialBaseline)
  const [validator, setValidator] = useState<Validator | null>(null)
  const [shownKeys, setShownKeys] = useState<ReadonlySet<string>>(new Set())
  const [scrollSeq, setScrollSeq] = useState(0)
  const [viewStep, setViewStep] = useState<ProgressStep | null>(null)
  const [picker, setPicker] = useState<{ request: PickerRequest; target: PickerTarget } | null>(null)
  const [sheet, setSheet] = useState<'menu' | 'switchSimple' | 'setupConfirm' | null>(null)
  const pendingSetup = useRef<((v: HandFormValues) => HandFormValues) | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  useKeepFocusedVisible(containerRef)

  const unit = deriveAmountUnit('manual', values.gameType)
  const stage: CompleteStage | null = useMemo(() => (values.mode === 'complete' ? deriveStage(values) : null), [values])
  const statuses = stage ? stepStatuses(values, stage) : null
  const viewing: ProgressStep | null = stage ? (viewStep && statuses?.[viewStep] !== 'disabled' ? viewStep : stage.step) : null
  const isViewingPast = stage !== null && viewing !== stage.step
  const valuesKey = JSON.stringify(values)
  const dirty = !valuesEqual(values, baseline)
  const gameTypeLocked = isEdit && hand?.detail !== null && hand?.detail !== undefined

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // ---- 5.5 驗證：按下「開始翻前」「確定」「儲存」時執行；已顯示錯誤的欄位修改後即時重新驗證 ----
  const ctx = (): ValidationContext => ({ now: now(), sessionsById: data.sessionsById })
  const runValidator = (kind: Validator, v: HandFormValues): HandErrors => {
    const st = v.mode === 'complete' ? deriveStage(v) : null
    switch (kind) {
      case 'simple':
        return validateSimple(v, ctx())
      case 'setup':
        return validateSetupStep(v, ctx())
      case 'board': {
        const msg = st ? boardMissingError(v, st) : null
        return msg ? { [ERROR_KEYS.streetBoard]: msg } : {}
      }
      case 'save':
        return st?.step === 'result' ? validateCompleteSave(v, st, ctx()) : {}
      case 'partial':
      case 'locked': {
        const errors = validateTimeAndSession(v, ctx())
        if (kind === 'partial' && st?.step === 'result' && v.gameType === 'cash') {
          const r = parseAmount(v.rake === '' ? '0' : v.rake)
          if (!r.ok) errors[ERROR_KEYS.rake] = r.reason === 'tooLarge' ? t.errors.amountTooLarge : t.errors.cashInteger
        }
        if (kind === 'locked') {
          if (v.note !== '' && charCount(v.note) > MAX_HAND_NOTE_LENGTH) errors[ERROR_KEYS.note] = t.errors.noteTooLong
        }
        return errors
      }
    }
  }
  // 畫面上的錯誤：只顯示上次驗證時已顯示的欄位，內容依目前的值即時重新計算
  const errors: HandErrors = useMemo(() => {
    if (!validator || shownKeys.size === 0) return {}
    const fresh = runValidator(validator, values)
    return Object.fromEntries(Object.entries(fresh).filter(([k]) => shownKeys.has(k)))
    // runValidator 只依賴 values、data 與 now
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validator, shownKeys, values, data, now])

  /** 執行驗證；有錯誤時顯示並捲動到第一個錯誤欄位，回傳是否通過 */
  const validate = (kind: Validator, v: HandFormValues = values): boolean => {
    const result = runValidator(kind, v)
    const keys = Object.keys(result)
    setValidator(kind)
    setShownKeys(new Set(keys))
    if (keys.length === 0) return true
    if (stage && keys.some((k) => SETUP_KEYS.has(k)) && stage.step !== 'setup' && kind !== 'board') setViewStep('setup')
    setScrollSeq((n) => n + 1)
    return false
  }
  const clearErrors = () => {
    setValidator(null)
    setShownKeys(new Set())
  }

  // 錯誤渲染到畫面後，捲動到第一個錯誤欄位（DOM 順序即畫面順序）並 focus
  useEffect(() => {
    if (scrollSeq === 0) return
    const field = containerRef.current?.querySelector<HTMLElement>('[data-invalid="true"]')
    if (!field) return
    field.scrollIntoView?.({ block: 'center' })
    const focusable = field.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')
    focusable?.focus({ preventScroll: true })
  }, [scrollSeq])

  // ---- 5.7 草稿：新增頁有任何輸入時，輸入停止 500ms 後寫入；回到預帶值時刪除（編輯模式不讀寫） ----
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingDraft = useRef<(() => void) | null>(null)
  const draftWrite = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (isEdit) return
    const current = JSON.parse(valuesKey) as HandFormValues
    const write = () => {
      pendingDraft.current = null
      const op = dirty ? repos.settings.set('handDraft', toHandDraft(current)) : repos.settings.delete('handDraft')
      draftWrite.current = op.catch(() => undefined)
    }
    pendingDraft.current = write
    draftTimer.current = setTimeout(write, DRAFT_DEBOUNCE_MS)
    return () => clearTimeout(draftTimer.current)
  }, [isEdit, valuesKey, dirty, repos])

  // 切換分頁、App 進背景或離開頁面時立即寫入；8.10 更新前由 flushPendingDrafts() 寫入並等待完成
  useEffect(() => {
    const flush = () => pendingDraft.current?.()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    const unregister = registerDraftFlusher(async () => {
      clearTimeout(draftTimer.current)
      flush()
      await draftWrite.current
    })
    return () => {
      unregister()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      clearTimeout(draftTimer.current)
      flush()
    }
  }, [])
  const cancelPendingDraft = () => {
    clearTimeout(draftTimer.current)
    pendingDraft.current = null
  }

  // ---- 固定底部列高度寫入 --record-bar-offset（提示與頁面底部內距據此避開，9.2） ----
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--record-bar-offset', `${bar.offsetHeight}px`)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(bar)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--record-bar-offset')
    }
  }, [])

  // ---- 5.6 標籤建議：標籤輸入框第一次聚焦時才讀取所有手牌的標籤 ----
  const [tagHistory, setTagHistory] = useState<string[] | null>(null)
  const historyLoading = useRef(false)
  const requestTagHistory = () => {
    if (tagHistory !== null || historyLoading.current) return
    historyLoading.current = true
    repos.hands
      .list()
      .then(
        (hands) => setTagHistory(handTagHistory(hands)),
        () => setTagHistory([]),
      )
      .finally(() => {
        historyLoading.current = false
      })
  }

  const patch = (p: Partial<HandFormValues>) => setValues((v) => ({ ...v, ...p }))

  // ---- 5.8：牌局設定欄位的修改；已有行動時先確認「會清除所有已輸入的行動」 ----
  const onSetupChange = (update: (v: HandFormValues) => HandFormValues) => {
    if (values.actions.length > 0) {
      pendingSetup.current = update
      setSheet('setupConfirm')
      return
    }
    setValues((v) => ({ ...update(v), setupDone: false }))
  }
  const confirmSetupChange = () => {
    const update = pendingSetup.current
    pendingSetup.current = null
    setSheet(null)
    if (update) setValues((v) => ({ ...update(clearActions(v)), setupDone: false }))
  }

  // ---- 5.1 簡易 / 完整切換 ----
  const requestMode = (next: 'simple' | 'complete') => {
    if (next === values.mode) return
    clearErrors()
    if (next === 'simple' && values.actions.length > 0) return setSheet('switchSimple')
    patch({ mode: next })
  }

  // ---- 選牌器 ----
  const used = usedCards(values)
  const pickerSlots: readonly CardSlot[] = !picker
    ? []
    : picker.target.kind === 'hero'
      ? values.heroCards
      : picker.target.kind === 'board'
        ? values.board
        : (values.showdown[String(picker.target.seatNo)]?.cards ?? [null, null])
  const onPickerChange = (slots: CardSlot[]) => {
    if (!picker) return
    const target = picker.target
    if (target.kind === 'hero') patch({ heroCards: slots })
    else if (target.kind === 'board') patch({ board: slots })
    else setValues((v) => ({ ...v, showdown: { ...v.showdown, [String(target.seatNo)]: { cards: slots, mucked: false } } }))
  }
  const openHeroPicker = (index: number) =>
    setPicker({
      request: { title: t.cardPicker.titles.heroCards, label: values.mode === 'complete' ? t.fields.yourCards : t.fields.heroCards, indices: [0, 1], start: index },
      target: { kind: 'hero' },
    })
  const openBoardPicker = (indices: number[], start: number, pickerTitle: string, label: string) =>
    setPicker({ request: { title: pickerTitle, label, indices, start }, target: { kind: 'board' } })
  const openShowdownPicker = (seatNo: number, index: number, who: string) =>
    setPicker({ request: { title: t.cardPicker.titles.showdown(who), label: who, indices: [0, 1], start: index }, target: { kind: 'showdown', seatNo } })

  // ---- 完整模式的流程 ----
  const startPreflop = () => {
    if (!validate('setup')) return
    clearErrors()
    setViewStep(null)
    patch({ setupDone: true })
  }
  const startStreet = () => {
    if (!stage || !validate('board')) return
    clearErrors()
    setValues((v) => confirmBoard(v, deriveStage(v)))
  }
  const onAction = (choice: ActionChoice) => {
    if (!stage) return
    const next = addAction(values, stage, choice)
    if (next) setValues(next)
  }
  const undo = () => {
    clearErrors()
    setValues(undoStep)
  }

  // ---- 5.8 儲存 ----
  const persist = async (input: HandInput, setupToRemember: HandSetup | null) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    if (!isEdit) cancelPendingDraft()
    try {
      let saved: Hand
      if (isEdit && hand) {
        const { source: _source, ...rest } = input
        void _source
        const p: HandPatch = locked ? { sessionId: rest.sessionId ?? null, tags: rest.tags ?? [], note: rest.note ?? null } : rest
        saved = await repos.hands.update(hand.id, p)
      } else {
        saved = await db.transaction('rw', [db.hands, db.sessions, db.settings], async () => {
          const created = await repos.hands.create(input)
          if (setupToRemember) await repos.settings.set('lastHandSetup', setupToRemember)
          await repos.settings.delete('handDraft')
          return created
        })
        // 完整手牌加結果（例「已儲存手牌，你 +$16,800」）
        const text = saved.kind === 'complete' ? t.savedWithResult(formatSignedHandAmount(saved.heroNet, saved.amountUnit)) : t.saved
        showGlobalToast({ text, durationMs: SUCCESS_TOAST_MS })
      }
      setBaseline(values)
      onSaved(saved)
    } catch {
      showGlobalToast({ text: t.saveFailed, durationMs: ERROR_TOAST_MS })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const saveSimple = () => {
    if (!validate('simple')) return
    void persist(toSimpleInput(values), null)
  }
  const saveLocked = () => {
    if (!validate('locked')) return
    void persist(toSimpleInput(values), null)
  }
  const saveComplete = () => {
    if (!stage || stage.step !== 'result' || !validate('save')) return
    void persist(toCompleteInput(values, stage), toHandSetup(values, stage.setup))
  }
  // 5.3 任何步驟都可「暫存為簡易」：detail 必須通過結構驗證，否則提示「牌局設定還沒完成，無法暫存」
  const saveAsSimple = () => {
    setSheet(null)
    if (!stage || stage.step === 'setup') {
      showGlobalToast({ text: t.cannotSaveAsSimple, durationMs: ERROR_TOAST_MS })
      return
    }
    if (!validate('partial')) return
    const detail = buildDetail(values, stage)
    if (!analyzeDetail(detail, confirmedBoard(values)).ok) {
      showGlobalToast({ text: t.cannotSaveAsSimple, durationMs: ERROR_TOAST_MS })
      return
    }
    void persist(toCompleteInput(values, stage), toHandSetup(values, stage.setup))
  }

  // ---- 5.7「清除」 ----
  const clear = () => {
    cancelPendingDraft()
    repos.settings.delete('handDraft').catch(() => undefined)
    const fresh = makeEntry()
    setBaseline(fresh)
    setValues(fresh)
    clearErrors()
    setViewStep(null)
  }

  // ---- 各欄位 ----
  const timeAndSession = (
    <>
      <TimeField idPrefix="hand" value={values} onChange={(p) => patch(p)} error={errors[ERROR_KEYS.date]} now={now()} disabled={locked} />
      <SessionField
        id="hand-session"
        value={values.sessionId}
        gameType={values.gameType}
        sessions={data.sessions}
        onChange={(sessionId) => patch({ sessionId })}
        error={errors[ERROR_KEYS.sessionId]}
      />
    </>
  )

  const noteError = errors[ERROR_KEYS.note]
  const noteCount = charCount(values.note)
  const tagsAndNote = (
    <>
      <TagInput
        id="hand-tag-input"
        tags={values.tags}
        input={values.tagInput}
        onTagsChange={(tags) => patch({ tags })}
        onInputChange={(tagInput) => patch({ tagInput })}
        error={errors[ERROR_KEYS.tags]}
        history={tagHistory}
        requestHistory={requestTagHistory}
      />
      <Field errorKey={ERROR_KEYS.note} error={noteError}>
        <div className="flex items-baseline justify-between">
          <label htmlFor="hand-note" className={labelClass}>
            {t.fields.note}
          </label>
          <span id="hand-note-count" className={`num text-xs ${noteCount > MAX_HAND_NOTE_LENGTH ? 'text-(--color-danger)' : 'text-(--color-text-muted)'}`}>
            {t.charCount(noteCount, MAX_HAND_NOTE_LENGTH)}
          </span>
        </div>
        <textarea
          id="hand-note"
          rows={3}
          value={values.note}
          onChange={(e) => patch({ note: e.target.value })}
          aria-invalid={noteError ? true : undefined}
          aria-describedby={describedBy(noteError && 'hand-note-error', 'hand-note-count')}
          className={textareaClass}
        />
        <FieldError id="hand-note-error" message={noteError} />
      </Field>
    </>
  )

  const heroError = errors[ERROR_KEYS.heroCards]
  const boardError = errors[ERROR_KEYS.board]
  const simpleFields = (
    <div data-testid="simple-fields">
      {timeAndSession}
      <GameTypeField value={values.gameType} onChange={(gameType) => patch({ gameType })} />
      <div className="mt-4">
        <label htmlFor="hand-position" className={labelClass}>
          {t.fields.position}
        </label>
        <SelectBox id="hand-position" value={values.position} onChange={(e) => patch({ position: e.target.value as '' | Position })}>
          <option value="">{t.positionNone}</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {positionText(p)}
            </option>
          ))}
        </SelectBox>
      </div>
      {errors[ERROR_KEYS.simpleEmpty] && (
        <Field errorKey={ERROR_KEYS.simpleEmpty} error={errors[ERROR_KEYS.simpleEmpty]}>
          <p role="alert" className="text-sm text-(--color-danger)">
            {errors[ERROR_KEYS.simpleEmpty]}
          </p>
        </Field>
      )}
      <Field errorKey={ERROR_KEYS.heroCards} error={heroError}>
        <p className={labelClass}>{t.fields.heroCards}</p>
        <CardSlots
          label={t.fields.heroCards}
          slots={values.heroCards}
          onOpen={openHeroPicker}
          invalid={heroError !== undefined}
          describedBy={describedBy(heroError && 'hand-hero-error')}
          testId="hero-cards"
        />
        <FieldError id="hand-hero-error" message={heroError} />
      </Field>
      <Field errorKey={ERROR_KEYS.board} error={boardError}>
        <p className={labelClass}>{t.fields.board}</p>
        <CardSlots
          label={t.fields.board}
          slots={values.board}
          onOpen={(i) => openBoardPicker([0, 1, 2, 3, 4], i, t.cardPicker.titles.board, t.fields.board)}
          invalid={boardError !== undefined}
          describedBy={describedBy(boardError && 'hand-board-error')}
          testId="board-cards"
        />
        <FieldError id="hand-board-error" message={boardError} />
      </Field>
      <AmountField id="hand-bb" label={t.fields.bb} errorKey={ERROR_KEYS.bb} value={values.bb} onChange={(bb) => patch({ bb })} error={errors[ERROR_KEYS.bb]} />
      <Field errorKey={ERROR_KEYS.resultAmount} error={errors[ERROR_KEYS.resultAmount]}>
        <p className={labelClass}>{t.fields.result}</p>
        <SegmentedControl<ResultChoice>
          label={t.fields.result}
          options={RESULT_CHOICES.map((r) => ({ value: r, label: t.results[r] }))}
          value={values.result}
          onChange={(result) => patch({ result, resultAmount: result === 'even' ? '' : values.resultAmount })}
        />
        <AmountField
          id="hand-result-amount"
          label={t.fields.resultAmount}
          errorKey={ERROR_KEYS.resultAmount}
          value={values.result === 'even' ? '0' : values.resultAmount}
          onChange={(resultAmount) => patch({ resultAmount })}
          error={errors[ERROR_KEYS.resultAmount]}
          disabled={values.result === 'even'}
          className="mt-2 min-w-0"
        />
      </Field>
      {tagsAndNote}
    </div>
  )

  // ---- 完整模式各步驟 ----
  let stepContent: ReactNode = null
  if (stage && viewing) {
    if (viewing === 'setup') {
      // 新增模式：開始翻前後只能檢視（要修改請用「復原上一步」）；編輯模式可修改（已有行動時先確認，5.8）
      const readOnly = stage.step !== 'setup' && !isEdit
      stepContent = (
        <fieldset disabled={readOnly} className="min-w-0">
          <SetupStep
            values={values}
            errors={errors}
            timeAndSession={timeAndSession}
            onSetupChange={onSetupChange}
            openHeroPicker={openHeroPicker}
            gameTypeLocked={gameTypeLocked}
          />
        </fieldset>
      )
    } else if (isViewingPast && stage.step !== 'setup' && viewing !== 'result') {
      stepContent = <ActionLog values={values} setup={stage.setup} unit={unit} untilStreet={viewing} />
    } else if (stage.step === 'result') {
      stepContent = (
        <ResultStep
          values={values}
          stage={stage}
          errors={errors}
          gameType={values.gameType}
          onShowdownChange={(seatNo, sd: ShowdownValues) => setValues((v) => ({ ...v, showdown: { ...v.showdown, [String(seatNo)]: sd } }))}
          openShowdownPicker={(seatNo, index) => openShowdownPicker(seatNo, index, showdownWho(stage, seatNo))}
          onRakeChange={(rake) => patch({ rake })}
        >
          {tagsAndNote}
        </ResultStep>
      )
    } else if (stage.step !== 'setup') {
      stepContent = (
        <StreetStep values={values} stage={stage} errors={errors} gameType={values.gameType} openBoardPicker={openBoardPicker} />
      )
    }
  }

  // 編輯模式：已確認的公牌可直接修改（5.8，仍需符合牌不重複）
  const editableBoard =
    isEdit && stage && stage.step !== 'setup' && !isViewingPast && !(stage.step !== 'result' && stage.phase === 'board') && boardDone(values) > 0 ? (
      <Field errorKey={ERROR_KEYS.streetBoard} error={errors[ERROR_KEYS.streetBoard]}>
        <p className={labelClass}>{t.fields.board}</p>
        <CardSlots
          label={t.fields.board}
          slots={values.board}
          indices={Array.from({ length: boardDone(values) }, (_, i) => i)}
          invalid={errors[ERROR_KEYS.streetBoard] !== undefined}
          describedBy={describedBy(errors[ERROR_KEYS.streetBoard] && 'hand-edit-board-error')}
          onOpen={(i) =>
            openBoardPicker(
              Array.from({ length: boardDone(values) }, (_, j) => j),
              i,
              t.cardPicker.titles.board,
              t.fields.board,
            )
          }
          testId="edit-board-cards"
        />
        <FieldError id="hand-edit-board-error" message={errors[ERROR_KEYS.streetBoard]} />
      </Field>
    ) : null

  // ---- 固定在分頁列上方的底部列（9.2） ----
  const undoButton = (
    <button
      type="button"
      onClick={undo}
      disabled={!canUndo(values)}
      aria-label={t.actions.undo}
      className={`${secondaryButtonClass} size-12 shrink-0 px-0`}
    >
      <Undo2 aria-hidden="true" size={20} />
    </button>
  )
  let bar: ReactNode
  if (locked) bar = <SaveButton onClick={saveLocked} saving={saving} />
  else if (!stage) bar = <SaveButton onClick={saveSimple} saving={saving} />
  else if (isViewingPast)
    bar = (
      <button type="button" onClick={() => setViewStep(null)} className={`${secondaryButtonClass} w-full`}>
        {t.progress.backToCurrent}
      </button>
    )
  else if (stage.step === 'setup')
    bar = (
      <button type="button" onClick={startPreflop} className={`${primaryButtonClass} w-full`}>
        {t.startPreflop}
      </button>
    )
  else if (stage.step === 'result')
    bar = (
      <div className="flex gap-2">
        {undoButton}
        <div className="min-w-0 flex-1"><SaveButton onClick={saveComplete} saving={saving} /></div>
      </div>
    )
  else if (stage.phase === 'board')
    bar = (
      <div className="flex gap-2">
        {undoButton}
        <button type="button" onClick={startStreet} className={`${primaryButtonClass} min-w-0 flex-1`}>
          {stage.runout ? t.confirmRunout : t.startStreet[stage.step as 'flop' | 'turn' | 'river']}
        </button>
      </div>
    )
  else
    bar = (
      <div className="flex items-end gap-2">
        {undoButton}
        <div className="min-w-0 flex-1">
          <ActionBar state={stage.state} heroSeat={stage.setup.heroSeat} unit={unit} gameType={values.gameType} onAction={onAction} />
        </div>
      </div>
    )

  // ---- 標題列右上角：「清除」（新增模式、有輸入時）與選單（完整模式：暫存為簡易） ----
  const headerAction = (
    <div className="flex items-center">
      {!isEdit && dirty && (
        <button
          type="button"
          onClick={clear}
          className="flex min-h-(--touch-min) min-w-(--touch-min) items-center justify-center rounded-(--radius-control) px-2 text-base text-(--color-accent)"
        >
          {t.clear}
        </button>
      )}
      {values.mode === 'complete' && !locked && (
        <button
          type="button"
          onClick={() => setSheet('menu')}
          aria-label={t.menu}
          className="flex size-(--touch-min) items-center justify-center rounded-(--radius-control) text-(--color-accent)"
        >
          <MoreHorizontal aria-hidden="true" size={24} />
        </button>
      )}
    </div>
  )

  return (
    <Page title={title} backTo={backTo} action={headerAction}>
      <div ref={containerRef} data-testid="hand-form" aria-label={title} role="form">
        <fieldset disabled={saving} className="min-w-0">
          {locked && (
            <p role="note" className="mt-2 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm">
              {t.ggLocked}
            </p>
          )}
          {!isEdit && (
            <div className="mt-2">
              <SegmentedControl
                label={t.modeLabel}
                options={[
                  { value: 'simple', label: t.modes.simple },
                  { value: 'complete', label: t.modes.complete },
                ]}
                value={values.mode}
                onChange={requestMode}
              />
            </div>
          )}
          {isEdit && !locked && values.mode === 'simple' && (
            <button
              type="button"
              onClick={() => {
                clearErrors()
                setValues((v) => completeFromSimple(v, data.lastHandSetup))
              }}
              className={`${secondaryButtonClass} mt-2 w-full`}
            >
              {t.completeFromSimple}
            </button>
          )}

          {locked ? (
            <div data-testid="locked-fields">
              {timeAndSession}
              {tagsAndNote}
            </div>
          ) : !stage ? (
            simpleFields
          ) : (
            <>
              {statuses && viewing && <ProgressSteps statuses={statuses} viewing={viewing} onSelect={(s) => setViewStep(s === stage.step ? null : s)} />}
              {editableBoard}
              {stepContent}
            </>
          )}
        </fieldset>

        <div
          ref={barRef}
          {...{ [OBSCURES_BOTTOM_ATTR]: '' }}
          className="fixed inset-x-0 z-20 border-t border-(--color-border) bg-(--color-surface) bottom-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto max-w-(--page-max-width) px-4 py-2" data-testid="hand-bar">
            {bar}
          </div>
        </div>
      </div>

      <CardPicker request={picker?.request ?? null} slots={pickerSlots} used={used} onChange={onPickerChange} onClose={() => setPicker(null)} />

      <BottomSheet open={sheet === 'menu'} title={t.menu} onClose={() => setSheet(null)}>
        <button type="button" onClick={saveAsSimple} disabled={saving} className={`${secondaryButtonClass} w-full`}>
          {t.saveAsSimple}
        </button>
      </BottomSheet>

      <BottomSheet open={sheet === 'switchSimple'} title={t.switchToSimpleConfirm} onClose={() => setSheet(null)}>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setSheet(null)} className={secondaryButtonClass}>
            {strings.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              setSheet(null)
              setViewStep(null)
              setValues((v) => discardComplete(v, makeEntry()))
            }}
            className={dangerButtonClass}
          >
            {strings.common.confirm}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === 'setupConfirm'}
        title={t.setupChangeConfirm}
        onClose={() => {
          pendingSetup.current = null
          setSheet(null)
        }}
      >
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              pendingSetup.current = null
              setSheet(null)
            }}
            className={secondaryButtonClass}
          >
            {strings.common.cancel}
          </button>
          <button type="button" onClick={confirmSetupChange} className={dangerButtonClass}>
            {strings.common.confirm}
          </button>
        </div>
      </BottomSheet>
    </Page>
  )
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={saving} aria-busy={saving || undefined} className={`${primaryButtonClass} w-full`}>
      {saving ? t.saving : t.save}
    </button>
  )
}

/** 攤牌對手的稱呼（選牌器標題「選擇 BB（6）的手牌」） */
function showdownWho(stage: Extract<CompleteStage, { step: 'result' }>, seatNo: number): string {
  return actorLabeler(stage.setup)(seatNo)
}
