import { zodResolver } from '@hookform/resolvers/zod'
import { Trash, X } from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form'
import { BottomSheet } from '../../components/BottomSheet'
import {
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  textareaClass,
} from '../../components/controlStyles'
import { FieldError } from '../../components/FieldError'
import { NumberInput } from '../../components/NumberInput'
import { SelectBox } from '../../components/SelectBox'
import { sessionTypeIcons } from '../../components/sessionTypeIcons'
import { ToastBar } from '../../components/Toast'
import {
  MAX_BUY_INS,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  SESSION_TYPES,
  charCount,
  backerNameHistory,
  formatMoney,
  formatPermille,
  formatSignedMoney,
  hasBackers,
  myProfit,
  stakeLabel,
  type Session,
  type SessionType,
  type Stake,
  type Venue,
} from '../../domain'
import { describedBy } from '../../lib/aria'
import { useAppData } from '../../lib/appData'
import { registerDraftFlusher } from '../../lib/draftFlush'
import { OBSCURES_BOTTOM_ATTR, useKeepFocusedVisible } from '../../lib/viewport'
import { strings } from '../../strings'
import { AddStakeSheet } from './AddStakeSheet'
import { AddVenueSheet } from './AddVenueSheet'
import { StakingSection } from './StakingSection'
import {
  BACKERS_TOTAL_ERROR_KEY,
  DURATION_HOURS,
  DURATION_MINUTES,
  START_HOURS,
  computePreview,
  createDefaults,
  createRecordSchema,
  formatStartAt,
  isTournament,
  localDate,
  needsSwitchConfirm,
  parseDraft,
  resetAfterSave,
  sessionToValues,
  switchType,
  toDraft,
  toSessionInput,
  valuesEqual,
  type RecordFormSettings,
  type RecordFormValues,
} from './formModel'

const t = strings.record
const f = t.fields

/** 新增頁載入的資料：盲注與場地含已封存（編輯舊場次時需顯示已封存選項，3.6） */
export interface RecordFormData {
  stakes: Stake[]
  venues: Venue[]
  settings: RecordFormSettings
  /** Settings.recordDraft 原始值（未驗證） */
  draft: unknown
}

export interface RecordFormHandle {
  /** 5.6「清除」：刪除草稿並回到剛進頁面的狀態 */
  clear: () => void
}

type Props = {
  mode: 'create' | 'edit'
  data: RecordFormData
  /** 編輯模式必填：要編輯的場次 */
  initialSession?: Session
  /** 表單值與初始值（新增：剛進頁面的預設值；編輯：場次原值）是否不同 */
  onDirtyChange?: (dirty: boolean) => void
  onSaved?: (session: Session) => void
  /** 測試用：注入現在時間 */
  now?: () => Date
  ref?: Ref<RecordFormHandle>
}

type Toast = { id: number; kind: 'success' | 'error'; text: string }

const ADD_OPTION = '__add__'
const SUCCESS_TOAST_MS = 3000
const ERROR_TOAST_MS = 5000
const DRAFT_DEBOUNCE_MS = 500
const systemNow = () => new Date()

const labelClass = 'mb-1 block text-sm font-medium text-(--color-text-muted)'
const hintClass = 'mt-1 text-xs text-(--color-text-muted)'

function profitClass(value: number | null): string {
  if (value === null || value === 0) return ''
  return value > 0 ? 'text-(--color-gain)' : 'text-(--color-loss)'
}

// 新增 / 編輯場次共用表單（第 5 節；編輯模式差異見 5.7）
export function RecordForm({ mode, data, initialSession, onDirtyChange, onSaved, now = systemNow, ref }: Props) {
  const { db, repos } = useAppData()
  const isEdit = mode === 'edit'

  const [init] = useState(() => {
    if (isEdit && initialSession) {
      const v = sessionToValues(initialSession)
      return { baseline: v, values: v, venueTouched: true }
    }
    const baseline = createDefaults(data.settings, data.stakes, data.venues, now())
    const draft = parseDraft(data.draft, data.stakes, data.venues)
    return { baseline, values: draft?.values ?? baseline, venueTouched: draft?.venueTouched ?? false }
  })
  const [baseline, setBaseline] = useState(init.baseline)
  const [venueTouched, setVenueTouched] = useState(init.venueTouched)
  const [stakes, setStakes] = useState(data.stakes)
  const [venues, setVenues] = useState(data.venues)
  const [settings, setSettings] = useState(data.settings)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [pendingType, setPendingType] = useState<SessionType | null>(null)
  const [sheet, setSheet] = useState<'stake' | 'venue' | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const nowRef = useRef(now)
  useEffect(() => {
    nowRef.current = now
  })

  // 5.4：按儲存時驗證；已顯示錯誤的欄位修改後即時重驗（reValidateMode: onChange）
  const resolver: Resolver<RecordFormValues> = (values, context, options) =>
    zodResolver(createRecordSchema(nowRef.current()))(values, context, options)
  const { control, handleSubmit, getValues, setValue, reset, clearErrors, trigger, formState } = useForm<RecordFormValues>({
    defaultValues: init.values,
    resolver,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  })
  const { errors, isSubmitted, submitCount } = formState
  const buyInArray = useFieldArray({ control, name: 'buyIns' })
  const backerArray = useFieldArray({ control, name: 'backers' })
  useWatch({ control })
  const values = getValues()
  const valuesKey = JSON.stringify(values)
  const dirty = !valuesEqual(values, baseline)
  const tournament = isTournament(values.type)
  const preview = computePreview(values)
  const staked = preview.backerRows > 0

  useKeepFocusedVisible(formRef)

  // ---- 5.3 出資者名稱建議：名稱輸入框第一次聚焦時才讀取全部場次（不拖慢新增頁開啟），儲存新場次後重新讀取 ----
  const [nameHistory, setNameHistory] = useState<string[] | null>(null)
  const historyLoading = useRef(false)
  const requestNameHistory = () => {
    if (nameHistory !== null || historyLoading.current) return
    historyLoading.current = true
    repos.sessions.list().then(
      (sessions) => setNameHistory(backerNameHistory(sessions)),
      () => setNameHistory([]),
    ).finally(() => {
      historyLoading.current = false
    })
  }
  // 已按過儲存時，出資者列數改變後重新驗證出資者與比例合計（5.4 即時重新驗證）
  const revalidateBackers = () => {
    if (isSubmitted) void trigger(['backers', BACKERS_TOTAL_ERROR_KEY as 'backers'])
  }

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // ---- 5.6 草稿：與預設值不同時，輸入停止 500ms 後寫入；回到預設值時刪除（編輯模式不讀寫） ----
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingDraft = useRef<(() => void) | null>(null)
  // 進行中的草稿寫入；8.10 更新前的 flush 要等它完成
  const draftWrite = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (isEdit) return
    const current = JSON.parse(valuesKey) as RecordFormValues
    const write = () => {
      pendingDraft.current = null
      const op = dirty
        ? repos.settings.set('recordDraft', toDraft(current, venueTouched))
        : repos.settings.delete('recordDraft')
      // 草稿寫入失敗不影響表單操作
      draftWrite.current = op.catch(() => undefined)
    }
    pendingDraft.current = write
    draftTimer.current = setTimeout(write, DRAFT_DEBOUNCE_MS)
    return () => clearTimeout(draftTimer.current)
  }, [isEdit, valuesKey, dirty, venueTouched, repos])

  // 切換分頁、App 進背景或離開新增頁時，立即寫入尚未寫入的草稿
  useEffect(() => {
    const flush = () => pendingDraft.current?.()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    // 8.10：按「重新載入」更新前，UpdatePrompt 透過 flushPendingDrafts() 立即寫入並等待完成
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

  // ---- 提示：成功 3 秒、失敗 5 秒（可手動關閉） ----
  // 計時器只關閉自己那則提示：舊提示的計時器若在新提示 commit 前觸發，不可把新提示一起清掉（P6 修正）
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      toast.kind === 'success' ? SUCCESS_TOAST_MS : ERROR_TOAST_MS,
    )
    return () => clearTimeout(timer)
  }, [toast])
  const toastSeq = useRef(0)
  const showToast = (kind: Toast['kind'], text: string) => setToast({ id: ++toastSeq.current, kind, text })

  // ---- 固定底部列高度寫入 --record-bar-offset，提示與頁面底部內距據此避開（9.2） ----
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

  // ---- 驗證失敗：捲動到第一個錯誤欄位並 focus ----
  // react-hook-form 在同一次更新中送出 submitCount 與 errors，等錯誤渲染到畫面後再找第一個錯誤欄位（DOM 順序即畫面順序）
  const handledSubmitCount = useRef(0)
  useEffect(() => {
    if (submitCount === handledSubmitCount.current) return
    handledSubmitCount.current = submitCount
    if (Object.keys(errors).length === 0) return
    const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (!el) return
    el.scrollIntoView?.({ block: 'center' })
    el.focus({ preventScroll: true })
  }, [submitCount, errors])

  // ---- 5.1 類型切換 ----
  const applyType = (type: SessionType) => {
    const current = getValues()
    const next = switchType(current, type, { settings, stakes, venues, venueTouched })
    if (next.buyIns.length < current.buyIns.length) {
      buyInArray.remove(
        Array.from({ length: current.buyIns.length - next.buyIns.length }, (_, i) => i + next.buyIns.length),
      )
    }
    for (const key of ['type', 'stakeId', 'fieldSize', 'finishPlace', 'venueId'] as const) {
      if (next[key] !== current[key]) setValue(key, next[key])
    }
    clearErrors(['stakeId', 'fieldSize', 'finishPlace'])
  }
  const requestType = (type: SessionType) => {
    if (isEdit || type === values.type) return
    if (needsSwitchConfirm(getValues(), type)) setPendingType(type)
    else applyType(type)
  }

  // ---- 5.6 清除 ----
  const clear = () => {
    cancelPendingDraft()
    repos.settings.delete('recordDraft').catch(() => undefined)
    const fresh = createDefaults(settings, stakes, venues, nowRef.current())
    setBaseline(fresh)
    setVenueTouched(false)
    reset(fresh)
  }
  useImperativeHandle(ref, () => ({ clear }))

  // ---- 5.5 儲存 ----
  const saveNew = async (v: RecordFormValues): Promise<Session> =>
    db.transaction('rw', [db.sessions, db.venues, db.stakes, db.settings], async () => {
      const session = await repos.sessions.create(toSessionInput(v))
      const lastVenueByType = {
        ...((await repos.settings.get('lastVenueByType')) ?? {}),
        [session.type]: session.venueId,
      }
      await repos.settings.set('lastType', session.type)
      await repos.settings.set('lastVenueByType', lastVenueByType)
      if (session.stakeId !== null) await repos.settings.set('lastStakeId', session.stakeId)
      await repos.settings.delete('recordDraft')
      return session
    })

  const onValid = async (v: RecordFormValues) => {
    savingRef.current = true
    setSaving(true)
    if (!isEdit) cancelPendingDraft()
    try {
      if (isEdit && initialSession) {
        const session = await repos.sessions.update(initialSession.id, toSessionInput(v))
        setBaseline(v)
        reset(v)
        onSaved?.(session)
      } else {
        const session = await saveNew(v)
        setSettings((s) => ({
          lastType: session.type,
          lastVenueByType: { ...s.lastVenueByType, [session.type]: session.venueId },
          lastStakeId: session.stakeId ?? s.lastStakeId,
        }))
        const next = resetAfterSave(v)
        setBaseline(next)
        setVenueTouched(false)
        reset(next)
        // 有出資者時提示你的盈利（5.5）
        const savedText = formatSignedMoney(myProfit(session))
        showToast('success', hasBackers(session) ? t.savedMine(savedText) : t.saved(savedText))
        setNameHistory(null)
        onSaved?.(session)
      }
    } catch {
      showToast('error', t.saveFailed)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return
    void handleSubmit(onValid)(e)
  }

  // ---- 行內新增盲注、場地（儲存後自動選取） ----
  const focusLater = (id: string) => setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), 0)
  const onStakeCreated = (stake: Stake) => {
    setStakes((list) => [...list, stake])
    setValue('stakeId', stake.id, { shouldValidate: isSubmitted })
    setSheet(null)
    focusLater('rf-stake')
  }
  const onVenueCreated = (venue: Venue) => {
    setVenues((list) => [...list, venue])
    setValue('venueId', venue.id, { shouldValidate: isSubmitted })
    setVenueTouched(true)
    setSheet(null)
    focusLater('rf-venue')
  }

  const stakeOptions = stakes.filter((s) => !s.archived || s.id === values.stakeId)
  const venueOptions = venues.filter((v) => !v.archived || v.id === values.venueId)
  const err = (message: string | undefined, id: string) => ({
    'aria-invalid': message ? (true as const) : undefined,
    'aria-describedby': describedBy(message && id),
  })

  // ---- 各欄位 ----
  const typeSelector = (
    <div className="mt-2">
      <div
        role="group"
        aria-label={t.typeLabel}
        aria-describedby={isEdit ? 'rf-type-hint' : undefined}
        className="grid grid-cols-3 gap-1 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) p-1"
      >
        {SESSION_TYPES.map((type) => {
          const Icon = sessionTypeIcons[type]
          const active = values.type === type
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              disabled={isEdit}
              onClick={() => requestType(type)}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-4px)] text-base font-semibold disabled:cursor-not-allowed ${
                active ? 'bg-(--color-accent) text-(--color-on-accent)' : 'text-(--color-text-muted)'
              } ${isEdit && !active ? 'opacity-60' : ''}`}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{strings.sessionTypes[type]}</span>
            </button>
          )
        })}
      </div>
      {isEdit && (
        <p id="rf-type-hint" className={hintClass}>
          {t.typeLocked}
        </p>
      )}
    </div>
  )

  const stakeField = (
    <div data-field className="mt-4">
      <label id="rf-stake-label" htmlFor="rf-stake" className={labelClass}>
        {f.stake}
      </label>
      {stakeOptions.length === 0 ? (
        // Q4：沒有任何可選盲注時，點擊欄位直接開啟新增視窗
        <button
          type="button"
          id="rf-stake"
          onClick={() => setSheet('stake')}
          aria-labelledby="rf-stake-label rf-stake"
          {...err(errors.stakeId?.message, 'rf-stake-error')}
          className={`${inputClass} flex items-center text-left text-(--color-text-muted)`}
        >
          {t.noStakes}
        </button>
      ) : (
        <Controller
          control={control}
          name="stakeId"
          render={({ field }) => (
            <SelectBox
              id="rf-stake"
              value={field.value}
              onBlur={field.onBlur}
              onChange={(e) => (e.target.value === ADD_OPTION ? setSheet('stake') : field.onChange(e.target.value))}
              {...err(errors.stakeId?.message, 'rf-stake-error')}
            >
              <option value="" disabled>
                {t.selectPlaceholder}
              </option>
              {stakeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {stakeLabel(s)}
                  {s.archived ? t.archivedSuffix : ''}
                </option>
              ))}
              <option value={ADD_OPTION}>{t.addStakeOption}</option>
            </SelectBox>
          )}
        />
      )}
      <FieldError id="rf-stake-error" message={errors.stakeId?.message} />
    </div>
  )

  const buyInInputs = (index: number, rowLabelId: string | undefined) => {
    const amountId = `rf-buyIn-${index}-amount`
    const feeId = `rf-buyIn-${index}-fee`
    const amountError = errors.buyIns?.[index]?.amount?.message
    const feeError = errors.buyIns?.[index]?.fee?.message
    return (
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <div className="min-w-0">
          <label id={`${amountId}-label`} htmlFor={amountId} className={labelClass}>
            {f.buyIn}
          </label>
          <Controller
            control={control}
            name={`buyIns.${index}.amount`}
            rules={{ deps: [`buyIns.${index}.fee`] }}
            render={({ field }) => (
              <NumberInput
                id={amountId}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                aria-labelledby={rowLabelId ? `${rowLabelId} ${amountId}-label` : undefined}
                {...err(amountError, `${amountId}-error`)}
              />
            )}
          />
          <FieldError id={`${amountId}-error`} message={amountError} />
        </div>
        <div className="min-w-0">
          <label id={`${feeId}-label`} htmlFor={feeId} className={labelClass}>
            {f.fee}
          </label>
          <Controller
            control={control}
            name={`buyIns.${index}.fee`}
            render={({ field }) => (
              <NumberInput
                id={feeId}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                placeholder="0"
                aria-labelledby={rowLabelId ? `${rowLabelId} ${feeId}-label` : undefined}
                aria-invalid={feeError ? true : undefined}
                aria-describedby={describedBy(feeError && `${feeId}-error`, `${feeId}-hint`)}
              />
            )}
          />
          <p id={`${feeId}-hint`} className={hintClass}>
            {f.feeHint}
          </p>
          <FieldError id={`${feeId}-error`} message={feeError} />
        </div>
      </div>
    )
  }

  const cashBuyInField = (
    <div data-field className="mt-4">
      {buyInInputs(0, undefined)}
    </div>
  )

  const buyInListField = (
    <section aria-label={t.buyInsLabel} className="mt-4">
      <ol className="space-y-3">
        {buyInArray.fields.map((row, index) => {
          const rowLabelId = `rf-buyIn-${index}-index`
          return (
            <li
              key={row.id}
              data-field
              className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 pb-3 pt-1"
            >
              <div className="flex min-h-(--touch-min) items-center justify-between">
                <span id={rowLabelId} className="text-sm font-semibold">
                  {t.buyInIndex(index + 1)}
                </span>
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => buyInArray.remove(index)}
                    aria-label={t.removeBuyIn(index + 1)}
                    className="-mr-2 flex size-(--touch-min) items-center justify-center rounded-(--radius-control) text-(--color-text-muted)"
                  >
                    <Trash aria-hidden="true" size={20} />
                  </button>
                )}
              </div>
              {buyInInputs(index, rowLabelId)}
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        onClick={() => {
          const last = getValues(`buyIns.${buyInArray.fields.length - 1}`)
          buyInArray.append({ amount: last?.amount ?? '', fee: last?.fee ?? '' }, { shouldFocus: false })
        }}
        disabled={buyInArray.fields.length >= MAX_BUY_INS}
        className={`${secondaryButtonClass} mt-3 w-full`}
      >
        {t.addBuyIn}
      </button>
    </section>
  )

  const cashOutField = (
    <div data-field className="mt-4">
      <label htmlFor="rf-cashOut" className={labelClass}>
        {f.cashOut}
      </label>
      <Controller
        control={control}
        name="cashOut"
        render={({ field }) => (
          <NumberInput
            id="rf-cashOut"
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            {...err(errors.cashOut?.message, 'rf-cashOut-error')}
          />
        )}
      />
      <FieldError id="rf-cashOut-error" message={errors.cashOut?.message} />
    </div>
  )

  // 「第 [ ] 名 / 共 [ ] 人」
  const placeField = (
    <div data-field className="mt-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label htmlFor="rf-finishPlace" className={labelClass}>
            {f.finishPlace}
          </label>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="shrink-0 whitespace-nowrap">
              {t.placePrefix}
            </span>
            <Controller
              control={control}
              name="finishPlace"
              render={({ field }) => (
                <NumberInput
                  id="rf-finishPlace"
                  grouping={false}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  {...err(errors.finishPlace?.message, 'rf-finishPlace-error')}
                />
              )}
            />
            <span aria-hidden="true" className="shrink-0 whitespace-nowrap">
              {t.placeSuffix}
            </span>
          </div>
          <FieldError id="rf-finishPlace-error" message={errors.finishPlace?.message} />
        </div>
        <div className="min-w-0">
          <label htmlFor="rf-fieldSize" className={labelClass}>
            {f.fieldSize}
          </label>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="shrink-0 whitespace-nowrap">
              {t.placeSeparator} {t.fieldSizePrefix}
            </span>
            <Controller
              control={control}
              name="fieldSize"
              rules={{ deps: ['finishPlace'] }}
              render={({ field }) => (
                <NumberInput
                  id="rf-fieldSize"
                  grouping={false}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  {...err(errors.fieldSize?.message, 'rf-fieldSize-error')}
                />
              )}
            />
            <span aria-hidden="true" className="shrink-0 whitespace-nowrap">
              {t.fieldSizeSuffix}
            </span>
          </div>
          <FieldError id="rf-fieldSize-error" message={errors.fieldSize?.message} />
        </div>
      </div>
    </div>
  )

  const startAtError = errors.startDate?.message
  const startAtText = formatStartAt(values.startDate, values.startHour)
  const startAtField = (
    <fieldset data-field className="mt-4" aria-describedby={describedBy(startAtError && 'rf-startAt-error')}>
      <legend className="mb-1 flex w-full items-baseline justify-between text-sm">
        <span className="font-medium text-(--color-text-muted)">{f.startAt}</span>
      </legend>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Controller
          control={control}
          name="startDate"
          render={({ field }) => (
            <input
              id="rf-startDate"
              type="date"
              max={localDate(now())}
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              aria-label={f.startDate}
              {...err(startAtError, 'rf-startAt-error')}
              className={`num ${inputClass}`}
            />
          )}
        />
        <Controller
          control={control}
          name="startHour"
          rules={{ deps: ['startDate'] }}
          render={({ field }) => (
            <SelectBox
              id="rf-startHour"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              aria-label={f.startHour}
              {...err(startAtError, 'rf-startAt-error')}
            >
              {START_HOURS.map((h) => (
                <option key={h} value={String(h)}>
                  {t.hourOption(h)}
                </option>
              ))}
            </SelectBox>
          )}
        />
      </div>
      {startAtText && (
        <p className={`num ${hintClass}`} data-testid="start-at-display">
          {startAtText}
        </p>
      )}
      <FieldError id="rf-startAt-error" message={startAtError} />
    </fieldset>
  )

  const durationError = errors.durationH?.message
  const durationField = (
    <fieldset data-field className="mt-4" aria-describedby={describedBy(durationError && 'rf-duration-error')}>
      <legend className={labelClass}>{f.duration}</legend>
      <div className="grid grid-cols-2 gap-3">
        <Controller
          control={control}
          name="durationH"
          render={({ field }) => (
            <SelectBox
              id="rf-durationH"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              aria-label={f.durationHours}
              {...err(durationError, 'rf-duration-error')}
            >
              <option value="">{t.notSelected}</option>
              {DURATION_HOURS.map((h) => (
                <option key={h} value={String(h)}>
                  {t.durationHourOption(h)}
                </option>
              ))}
            </SelectBox>
          )}
        />
        <Controller
          control={control}
          name="durationM"
          rules={{ deps: ['durationH'] }}
          render={({ field }) => (
            <SelectBox
              id="rf-durationM"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              aria-label={f.durationMinutes}
              {...err(durationError, 'rf-duration-error')}
            >
              <option value="">{t.notSelected}</option>
              {DURATION_MINUTES.map((m) => (
                <option key={m} value={String(m)}>
                  {t.durationMinuteOption(m)}
                </option>
              ))}
            </SelectBox>
          )}
        />
      </div>
      <FieldError id="rf-duration-error" message={durationError} />
    </fieldset>
  )

  const venueField = (
    <div data-field className="mt-4">
      <label htmlFor="rf-venue" className={labelClass}>
        {f.venue}
      </label>
      <Controller
        control={control}
        name="venueId"
        render={({ field }) => (
          <SelectBox
            id="rf-venue"
            value={field.value}
            onBlur={field.onBlur}
            onChange={(e) => {
              if (e.target.value === ADD_OPTION) return setSheet('venue')
              setVenueTouched(true)
              field.onChange(e.target.value)
            }}
          >
            <option value="">{t.venueNone}</option>
            {venueOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.archived ? t.archivedSuffix : ''}
              </option>
            ))}
            <option value={ADD_OPTION}>{t.addVenueOption}</option>
          </SelectBox>
        )}
      />
    </div>
  )

  const nameError = errors.name?.message
  const nameCount = charCount(values.name)
  const nameField = (
    <div data-field className="mt-4">
      <div className="flex items-baseline justify-between">
        <label htmlFor="rf-name" className={labelClass}>
          {f.name}
        </label>
        <span
          id="rf-name-count"
          className={`num text-xs ${nameCount > MAX_NAME_LENGTH ? 'text-(--color-danger)' : 'text-(--color-text-muted)'}`}
        >
          {t.charCount(nameCount, MAX_NAME_LENGTH)}
        </span>
      </div>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <input
            id="rf-name"
            type="text"
            autoComplete="off"
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy(nameError && 'rf-name-error', 'rf-name-count')}
            className={inputClass}
          />
        )}
      />
      <FieldError id="rf-name-error" message={nameError} />
    </div>
  )

  const noteError = errors.note?.message
  const noteCount = charCount(values.note)
  const noteField = (
    <div data-field className="mt-4">
      <div className="flex items-baseline justify-between">
        <label htmlFor="rf-note" className={labelClass}>
          {f.note}
        </label>
        <span
          id="rf-note-count"
          className={`num text-xs ${noteCount > MAX_NOTE_LENGTH ? 'text-(--color-danger)' : 'text-(--color-text-muted)'}`}
        >
          {t.charCount(noteCount, MAX_NOTE_LENGTH)}
        </span>
      </div>
      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <textarea
            id="rf-note"
            rows={3}
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={describedBy(noteError && 'rf-note-error', 'rf-note-count')}
            className={textareaClass}
          />
        )}
      />
      <FieldError id="rf-note-error" message={noteError} />
    </div>
  )

  const stakingField = (
    <StakingSection
      control={control}
      values={values}
      errors={errors}
      fieldArray={backerArray}
      setValue={setValue}
      revalidate={revalidateBackers}
      nameHistory={nameHistory}
      requestNameHistory={requestNameHistory}
    />
  )

  // 5.2 欄位順序（賣股份緊接在到手金額之後）
  const fieldNodes = {
    stake: stakeField,
    cashBuyIn: cashBuyInField,
    buyInList: buyInListField,
    cashOut: cashOutField,
    staking: stakingField,
    place: placeField,
    startAt: startAtField,
    duration: durationField,
    venue: venueField,
    name: nameField,
    note: noteField,
  } satisfies Record<string, ReactNode>
  const fieldsByType: Record<SessionType, (keyof typeof fieldNodes)[]> = {
    cash: ['stake', 'cashBuyIn', 'cashOut', 'staking', 'startAt', 'duration', 'venue', 'name', 'note'],
    mtt: ['buyInList', 'cashOut', 'staking', 'place', 'startAt', 'duration', 'venue', 'name', 'note'],
    timed_mtt: ['buyInList', 'cashOut', 'staking', 'startAt', 'duration', 'venue', 'name', 'note'],
  }

  const empty = strings.format.empty
  const p = t.preview

  // bottom sheet 以 portal 渲染，但 React 事件仍沿元件樹冒泡，所以放在 <form> 之外，
  // 避免面板內表單的 submit 觸發新增表單的送出
  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={submit}
        aria-label={isEdit ? strings.pages.sessionEdit : strings.pages.record}
      >
        <fieldset disabled={saving} className="min-w-0">
          {typeSelector}
          {fieldsByType[values.type].map((key) => (
            <div key={key}>{fieldNodes[key]}</div>
          ))}
        </fieldset>

        {/* 固定在分頁列上方的即時預覽 + 儲存列（5.2、9.2） */}
        <div
          ref={barRef}
          {...{ [OBSCURES_BOTTOM_ATTR]: '' }}
          className="fixed inset-x-0 z-20 border-t border-(--color-border) bg-(--color-surface) bottom-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto max-w-(--page-max-width) px-4 py-2">
            {/* 沒有出資者列時一行（與 v1.1 相同）；有出資者列時兩行：第一行全額盈利，第二行賣出比例與你的盈利（5.2） */}
            <div data-testid="record-preview" data-lines={staked ? 2 : 1} className="num text-center text-sm">
              <p data-testid="record-preview-line1">
                <span>
                  {p.buyIn} {preview.buyInTotal === null ? empty : formatMoney(preview.buyInTotal)}
                  {tournament ? p.entries(preview.entries) : ''}
                </span>
                {tournament ? p.separatorAfterParen : p.separator}
                <span>
                  {p.fee} {preview.feeTotal === null ? empty : formatMoney(preview.feeTotal)}
                </span>
                {p.separator}
                <span>
                  {staked ? p.full : p.profit}{' '}
                  <span className={`font-semibold ${profitClass(preview.profit)}`}>
                    {formatSignedMoney(preview.profit)}
                  </span>
                </span>
              </p>
              {staked && (
                <p data-testid="record-preview-line2">
                  <span>{p.sold(formatPermille(preview.soldPermille))}</span>
                  {p.separator}
                  <span>
                    {p.myProfit}{' '}
                    <span className={`font-semibold ${profitClass(preview.myProfit)}`}>
                      {formatSignedMoney(preview.myProfit)}
                    </span>
                  </span>
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving || undefined}
              className={`${primaryButtonClass} mt-2 w-full`}
            >
              {saving ? t.saving : t.save}
            </button>
          </div>
        </div>
      </form>

      {toast && (
        <ToastBar key={toast.id}>
          <span className="num">{toast.text}</span>
          {toast.kind === 'error' && (
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label={strings.common.close}
              className="flex size-(--touch-min) shrink-0 items-center justify-center text-(--color-text-muted)"
            >
              <X aria-hidden="true" size={20} />
            </button>
          )}
        </ToastBar>
      )}

      {/* 5.1 錦標賽切到現金桌的確認 */}
      <BottomSheet open={pendingType !== null} title={t.switchToCashConfirm} onClose={() => setPendingType(null)}>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setPendingType(null)} className={secondaryButtonClass}>
            {strings.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              if (pendingType) applyType(pendingType)
              setPendingType(null)
            }}
            className={dangerButtonClass}
          >
            {strings.common.confirm}
          </button>
        </div>
      </BottomSheet>

      <AddStakeSheet open={sheet === 'stake'} onClose={() => setSheet(null)} onCreated={onStakeCreated} />
      <AddVenueSheet open={sheet === 'venue'} onClose={() => setSheet(null)} onCreated={onVenueCreated} />
    </>
  )
}
