import { X } from 'lucide-react'
import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { FieldError } from '../../components/FieldError'
import { inputClass, secondaryButtonClass } from '../../components/controlStyles'
import { filterTagSuggestions } from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { scrollIntoVisibleArea } from '../../lib/viewport'
import { strings } from '../../strings'
import { validateNewTag } from './handFormModel'

const t = strings.hands.tags
const labelClass = 'mb-1 block text-sm font-medium text-(--color-text-muted)'

type Props = {
  id: string
  tags: string[]
  input: string
  onTagsChange: (tags: string[]) => void
  onInputChange: (input: string) => void
  /** 儲存時的標籤錯誤（草稿還原等情況） */
  error: string | undefined
  /** 所有手牌的標籤歷史（5.6，依最近使用排序、已去重）；尚未載入時為 null */
  history: string[] | null
  requestHistory: () => void
  disabled?: boolean
}

// 5.6 標籤輸入：輸入文字後按 Enter 或「新增」成為一個標籤（chip），chip 右側刪除鈕。
// 新增時即檢查 5.5 的標籤規則（字數、重複、上限），不合法時不加入並顯示錯誤。
// 建議清單規則同 v1 5.3 出資者名稱建議（自製下拉、部分符合、排除本手已加的標籤、最多 8 筆）。
export function TagInput({ id, tags, input, onTagsChange, onInputChange, error, history, requestHistory, disabled }: Props) {
  const [addError, setAddError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const suggestions = open && history ? filterTagSuggestions(history, input, tags) : []
  const listOpen = suggestions.length > 0
  const message = addError ?? error

  useEffect(() => {
    if (!listOpen) return
    const active = document.activeElement
    if (active instanceof HTMLElement) scrollIntoVisibleArea(active)
  }, [listOpen])

  const add = (raw: string) => {
    if (raw.trim() === '') return
    const err = validateNewTag(tags, raw)
    setAddError(err)
    if (err) return
    onTagsChange([...tags, raw.trim()])
    onInputChange('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    add(input)
  }

  const closeOnBlur = (e: FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.closest('[data-tag-field]')?.contains(next)) return
    setOpen(false)
  }

  const errorId = `${id}-error`
  return (
    <div data-field data-tag-field data-error-key="tags" data-invalid={message ? 'true' : undefined} className="mt-4">
      <label htmlFor={id} className={labelClass}>
        {strings.hands.fields.tags}
      </label>
      {tags.length > 0 && (
        <ul aria-label={t.listLabel} className="mb-2 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={tag}
              data-testid="tag-chip"
              className="flex min-h-(--touch-min) items-center gap-1 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-raised) pl-3"
            >
              <span className="max-w-[12rem] truncate">{tag}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`${t.remove} ${tag}`}
                onClick={() => {
                  setAddError(null)
                  onTagsChange(tags.filter((x) => x !== tag))
                }}
                className="flex size-(--touch-min) items-center justify-center text-(--color-text-muted)"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          disabled={disabled}
          aria-label={t.inputLabel}
          value={input}
          onFocus={() => {
            requestHistory()
            setOpen(true)
          }}
          onChange={(e) => {
            setAddError(null)
            onInputChange(e.target.value)
            requestHistory()
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onBlur={closeOnBlur}
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy(message && errorId)}
          className={inputClass}
        />
        <button type="button" disabled={disabled} onClick={() => add(input)} className={`${secondaryButtonClass} shrink-0`}>
          {t.add}
        </button>
      </div>
      {listOpen && (
        // 自製下拉（不用 <datalist>）；pointerdown 不搶焦點，點選後加入標籤並收起；放在版面流內
        <div
          role="group"
          aria-label={t.suggestionsLabel}
          data-testid="tag-suggestions"
          className="mt-1 overflow-hidden rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-raised) shadow-sm"
        >
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              data-testid="tag-suggestion"
              onPointerDown={(e) => e.preventDefault()}
              onBlur={closeOnBlur}
              onClick={() => {
                add(tag)
                setOpen(false)
              }}
              className="flex min-h-(--touch-min) w-full items-center border-b border-(--color-border) px-3 text-left text-base last:border-b-0"
            >
              <span className="truncate">{tag}</span>
            </button>
          ))}
        </div>
      )}
      <FieldError id={errorId} message={message ?? undefined} />
    </div>
  )
}
