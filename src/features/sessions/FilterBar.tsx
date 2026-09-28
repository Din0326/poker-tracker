import { Search, X } from 'lucide-react'
import { FieldError } from '../../components/FieldError'
import { inputClass } from '../../components/controlStyles'
import { SelectBox } from '../../components/SelectBox'
import type { PeriodError } from '../../domain'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'
import { PERIOD_KINDS, TYPE_FILTERS, type ExtraFilters, type ListFilters, type PeriodKind, type TypeFilter } from './listFilters'

const t = strings.sessions.filters
const labelClass = 'mb-1 block text-sm font-medium text-(--color-text-muted)'

export interface ExtraTag {
  key: keyof ExtraFilters
  label: string
}

type Props = {
  filters: ListFilters
  onChange: (patch: Partial<ListFilters>) => void
  tags: ExtraTag[]
  onRemoveTag: (key: keyof ExtraFilters) => void
  periodError: PeriodError | null
  filtering: boolean
  onClear: () => void
}

function typeLabel(type: TypeFilter): string {
  return type === 'all' ? t.typeAll : strings.sessionTypes[type]
}

// 7.1 篩選列：類型分段選擇器、期間選單（自訂時展開起迄日期）、關鍵字、額外篩選標籤、清除篩選
export function FilterBar({ filters, onChange, tags, onRemoveTag, periodError, filtering, onClear }: Props) {
  const rangeError = periodError === 'fromAfterTo' ? t.fromAfterTo : undefined

  return (
    <section aria-label={t.label} className="mt-2 space-y-3">
      <div
        role="group"
        aria-label={t.type}
        className="grid grid-cols-4 gap-1 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) p-1"
      >
        {TYPE_FILTERS.map((type) => {
          const active = filters.type === type
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ type })}
              className={`min-h-11 rounded-[calc(var(--radius-control)-4px)] px-1 text-sm font-semibold whitespace-nowrap ${
                active ? 'bg-(--color-accent) text-(--color-on-accent)' : 'text-(--color-text-muted)'
              }`}
            >
              {typeLabel(type)}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-[8.5rem_1fr] gap-3">
        <div className="min-w-0">
          <label htmlFor="sl-period" className={labelClass}>
            {t.period}
          </label>
          <SelectBox
            id="sl-period"
            value={filters.period}
            onChange={(e) => onChange({ period: e.target.value as PeriodKind })}
          >
            {PERIOD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t.periodOptions[kind]}
              </option>
            ))}
          </SelectBox>
        </div>
        <div className="min-w-0">
          <label htmlFor="sl-keyword" className={labelClass}>
            {t.keyword}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
            />
            <input
              id="sl-keyword"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              value={filters.keyword}
              placeholder={t.keywordPlaceholder}
              onChange={(e) => onChange({ keyword: e.target.value })}
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
      </div>

      {filters.period === 'custom' && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="sl-from" className={labelClass}>
                {t.from}
              </label>
              <input
                id="sl-from"
                type="date"
                value={filters.from}
                onChange={(e) => onChange({ from: e.target.value })}
                aria-invalid={rangeError ? true : undefined}
                aria-describedby={describedBy(rangeError && 'sl-range-error')}
                className={`num ${inputClass}`}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="sl-to" className={labelClass}>
                {t.to}
              </label>
              <input
                id="sl-to"
                type="date"
                value={filters.to}
                onChange={(e) => onChange({ to: e.target.value })}
                aria-invalid={rangeError ? true : undefined}
                aria-describedby={describedBy(rangeError && 'sl-range-error')}
                className={`num ${inputClass}`}
              />
            </div>
          </div>
          <FieldError id="sl-range-error" message={rangeError} />
        </div>
      )}

      {(tags.length > 0 || filtering) && (
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <button
              key={tag.key}
              type="button"
              onClick={() => onRemoveTag(tag.key)}
              aria-label={t.removeTag(tag.label)}
              data-testid="filter-tag"
              className="flex min-h-(--touch-min) max-w-full items-center gap-1 rounded-full border border-(--color-border) bg-(--color-surface-raised) pl-3 pr-2 text-sm"
            >
              <span className="truncate">{tag.label}</span>
              <X aria-hidden="true" size={16} className="shrink-0 text-(--color-text-muted)" />
            </button>
          ))}
          {filtering && (
            <button
              type="button"
              onClick={onClear}
              className="ml-auto min-h-(--touch-min) rounded-(--radius-control) px-2 text-sm font-semibold text-(--color-accent)"
            >
              {t.clear}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
