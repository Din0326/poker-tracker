import { Trash } from 'lucide-react'
import { useEffect, useState, type FocusEvent } from 'react'
import {
  Controller,
  type Control,
  type FieldError as RhfFieldError,
  type FieldErrors,
  type UseFieldArrayReturn,
  type UseFormSetValue,
} from 'react-hook-form'
import { DecimalInput } from '../../components/DecimalInput'
import { FieldError } from '../../components/FieldError'
import { inputClass, secondaryButtonClass } from '../../components/controlStyles'
import { FULL_PERMILLE, MAX_BACKERS, filterBackerSuggestions, formatMoney, formatPermille } from '../../domain'
import { describedBy } from '../../lib/aria'
import { scrollIntoVisibleArea } from '../../lib/viewport'
import { strings } from '../../strings'
import {
  BACKERS_TOTAL_ERROR_KEY,
  computeBackerRowPreview,
  newBackerRow,
  validShareTotal,
  type RecordFormValues,
} from './formModel'

const t = strings.record.staking
const labelClass = 'mb-1 block text-sm font-medium text-(--color-text-muted)'
const hintClass = 'mt-1 text-xs text-(--color-text-muted)'
const TOTAL_ERROR_ID = 'rf-backers-total-error'

/** 出資者欄位修改後要一起重新驗證的欄位：整個出資者列表（名稱重複跨列）與比例合計（5.4） */
// BACKERS_TOTAL_ERROR_KEY 不是表單值的欄位（只承載錯誤），型別上以 'backers' 斷言
const BACKER_DEPS: 'backers'[] = ['backers', BACKERS_TOTAL_ERROR_KEY as 'backers']

type Props = {
  control: Control<RecordFormValues>
  values: RecordFormValues
  errors: FieldErrors<RecordFormValues>
  fieldArray: UseFieldArrayReturn<RecordFormValues, 'backers'>
  setValue: UseFormSetValue<RecordFormValues>
  /** 已按過儲存時，列數改變後重新驗證出資者（合計錯誤即時更新） */
  revalidate: () => void
  /** 出資者名稱歷史（依最近使用排序、已去重；5.3）；尚未載入時為 null */
  nameHistory: string[] | null
  /** 名稱輸入框第一次聚焦時載入名稱歷史 */
  requestNameHistory: () => void
}

// 5.3 賣股份區塊（三種類型共用）：預設收合；有出資者列時展開，標題列右側顯示摘要。
// 每列：名稱（含歷史建議）＋ 刪除鈕；比例（%）、加價倍數（×）；小字「付你 · 分走」即時計算（4.6）。
export function StakingSection({
  control,
  values,
  errors,
  fieldArray,
  setValue,
  revalidate,
  nameHistory,
  requestNameHistory,
}: Props) {
  const [suggestFor, setSuggestFor] = useState<number | null>(null)
  const rows = fieldArray.fields
  const expanded = rows.length > 0
  const sold = validShareTotal(values.backers)
  const totalError = (errors as Record<string, RhfFieldError | undefined>)[BACKERS_TOTAL_ERROR_KEY]?.message
  const empty = strings.format.empty

  // 建議清單出現時（名稱歷史為非同步載入），把整列（含清單）捲到固定底部列與鍵盤之上（9.2）
  const suggestionCount =
    suggestFor !== null && nameHistory
      ? filterBackerSuggestions(
          nameHistory,
          values.backers[suggestFor]?.name ?? '',
          values.backers.filter((_, i) => i !== suggestFor).map((b) => b.name),
        ).length
      : 0
  const listOpen = suggestionCount > 0
  useEffect(() => {
    if (!listOpen) return
    const active = document.activeElement
    if (active instanceof HTMLElement) scrollIntoVisibleArea(active)
  }, [listOpen, suggestFor])

  const addRow = () => {
    fieldArray.append(newBackerRow(), { shouldFocus: true })
    revalidate()
  }
  const removeRow = (index: number) => {
    setSuggestFor(null)
    fieldArray.remove(index)
    revalidate()
  }

  const openSuggestions = (index: number) => {
    requestNameHistory()
    setSuggestFor(index)
  }
  const closeSuggestionsOnBlur = (e: FocusEvent<HTMLElement>) => {
    // 焦點移到建議清單內（鍵盤操作）時不收起
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.parentElement?.contains(next)) return
    setSuggestFor(null)
  }

  if (!expanded) {
    return (
      <section aria-labelledby="rf-staking-title" data-testid="staking-section" data-expanded="false" className="mt-4">
        <div className="flex min-h-(--touch-min) items-center gap-2">
          <h2 id="rf-staking-title" className="text-sm font-medium text-(--color-text-muted)">
            {t.title}
          </h2>
          <span className="min-w-0 flex-1 text-xs text-(--color-text-muted)">{t.skipHint}</span>
          <button type="button" onClick={addRow} className={`${secondaryButtonClass} shrink-0`}>
            {t.add}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="rf-staking-title" data-testid="staking-section" data-expanded="true" className="mt-4">
      <div className="flex min-h-(--touch-min) items-center justify-between gap-2">
        <h2 id="rf-staking-title" className="text-sm font-medium text-(--color-text-muted)">
          {t.title}
        </h2>
        <span data-testid="staking-summary" className="num text-sm text-(--color-text-muted)">
          {t.summary(formatPermille(sold), formatPermille(FULL_PERMILLE - sold))}
        </span>
      </div>
      <FieldError id={TOTAL_ERROR_ID} message={totalError} />

      <ol aria-label={t.listLabel} className="mt-2 space-y-3">
        {rows.map((row, index) => {
          const nameId = `rf-backer-${index}-name`
          const shareId = `rf-backer-${index}-share`
          const markupId = `rf-backer-${index}-markup`
          const rowErrors = errors.backers?.[index]
          const nameError = rowErrors?.name?.message
          const shareError = rowErrors?.share?.message
          const markupError = rowErrors?.markup?.message
          const preview = computeBackerRowPreview(values, index)
          const otherNames = values.backers.filter((_, i) => i !== index).map((b) => b.name)
          const suggestions =
            suggestFor === index && nameHistory
              ? filterBackerSuggestions(nameHistory, values.backers[index]?.name ?? '', otherNames)
              : []
          return (
            <li
              key={row.id}
              data-field
              data-testid="backer-row"
              aria-label={t.rowLabel(index + 1)}
              className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-3 pb-3 pt-2"
            >
              <label htmlFor={nameId} className={labelClass}>
                {t.name}
              </label>
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <Controller
                    control={control}
                    name={`backers.${index}.name`}
                    rules={{ deps: BACKER_DEPS }}
                    render={({ field }) => (
                      <input
                        ref={field.ref}
                        id={nameId}
                        type="text"
                        autoComplete="off"
                        placeholder={t.namePlaceholder}
                        value={field.value}
                        onFocus={() => openSuggestions(index)}
                        onChange={(e) => {
                          field.onChange(e.target.value)
                          openSuggestions(index)
                        }}
                        onBlur={(e) => {
                          field.onBlur()
                          closeSuggestionsOnBlur(e)
                        }}
                        aria-invalid={nameError ? true : undefined}
                        aria-describedby={describedBy(nameError && `${nameId}-error`)}
                        className={inputClass}
                      />
                    )}
                  />
                  {suggestions.length > 0 && (
                    // 自製下拉（不用 <datalist>，iOS Safari 支援不一致）；pointerdown 不搶焦點，點選後填入並收起。
                    // 放在版面流內（不浮在下方欄位上），避免點比例欄時誤點到建議
                    <div
                      role="group"
                      aria-label={t.suggestionsLabel}
                      data-testid="backer-suggestions"
                      className="mt-1 overflow-hidden rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-raised) shadow-sm"
                    >
                      {suggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          data-testid="backer-suggestion"
                          onPointerDown={(e) => e.preventDefault()}
                          onBlur={closeSuggestionsOnBlur}
                          onClick={() => {
                            setValue(`backers.${index}.name`, name, { shouldDirty: true })
                            setSuggestFor(null)
                            revalidate()
                          }}
                          className="flex min-h-(--touch-min) w-full items-center border-b border-(--color-border) px-3 text-left text-base last:border-b-0"
                        >
                          <span className="truncate">{name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  aria-label={t.remove}
                  className="-mr-2 flex size-12 shrink-0 items-center justify-center rounded-(--radius-control) text-(--color-text-muted)"
                >
                  <Trash aria-hidden="true" size={20} />
                </button>
              </div>
              <FieldError id={`${nameId}-error`} message={nameError} />

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label htmlFor={shareId} className={labelClass}>
                    {t.share}
                  </label>
                  <div className="flex items-center gap-2">
                    <Controller
                      control={control}
                      name={`backers.${index}.share`}
                      rules={{ deps: BACKER_DEPS }}
                      render={({ field }) => (
                        <DecimalInput
                          id={shareId}
                          value={field.value}
                          onValueChange={field.onChange}
                          onBlur={field.onBlur}
                          aria-invalid={shareError || totalError ? true : undefined}
                          aria-describedby={describedBy(shareError && `${shareId}-error`, totalError && TOTAL_ERROR_ID)}
                        />
                      )}
                    />
                    <span aria-hidden="true" className="shrink-0">
                      {t.percentSuffix}
                    </span>
                  </div>
                  <FieldError id={`${shareId}-error`} message={shareError} />
                </div>
                <div className="min-w-0">
                  <label htmlFor={markupId} className={labelClass}>
                    {t.markup}
                  </label>
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="shrink-0">
                      {t.markupPrefix}
                    </span>
                    <Controller
                      control={control}
                      name={`backers.${index}.markup`}
                      rules={{ deps: BACKER_DEPS }}
                      render={({ field }) => (
                        <DecimalInput
                          id={markupId}
                          value={field.value}
                          onValueChange={field.onChange}
                          onBlur={field.onBlur}
                          aria-invalid={markupError ? true : undefined}
                          aria-describedby={describedBy(markupError && `${markupId}-error`)}
                        />
                      )}
                    />
                  </div>
                  <FieldError id={`${markupId}-error`} message={markupError} />
                </div>
              </div>
              <p data-testid="backer-row-amounts" className={`num ${hintClass}`}>
                {t.rowAmounts(
                  preview.pay === null ? empty : formatMoney(preview.pay),
                  preview.payout === null ? empty : formatMoney(preview.payout),
                )}
              </p>
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        onClick={addRow}
        disabled={rows.length >= MAX_BACKERS}
        className={`${secondaryButtonClass} mt-3 w-full`}
      >
        {t.addBacker}
      </button>
    </section>
  )
}
