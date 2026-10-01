import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { CustomRangeFields, PeriodSelect } from '../../components/PeriodPicker'
import { SelectBox } from '../../components/SelectBox'
import { inputClass } from '../../components/controlStyles'
import type { PeriodError } from '../../domain'
import { positionText } from '../../domain/hands'
import { strings } from '../../strings'
import {
  KIND_FILTERS,
  LINK_FILTERS,
  POSITION_FILTERS,
  SOURCE_FILTERS,
  type HandListFilters,
  type PositionFilter,
} from './handListModel'

const t = strings.hands.list.filters
const labelClass = 'mb-1 block text-sm font-medium text-(--color-text-muted)'
/** 標籤選單「全部」的值（標籤本身不會是空字串，3.1） */
const TAG_ALL = ''

type Props = {
  filters: HandListFilters
  onChange: (patch: Partial<HandListFilters>) => void
  /** 標籤選單的選項（5.6 的最近使用排序） */
  tagOptions: readonly string[]
  /** 從場次詳情進入時的場次標籤「場次：09/27 6bet」；null 為沒有 */
  sessionTag: string | null
  onRemoveSessionTag: () => void
  periodError: PeriodError | null
  filtering: boolean
  onClear: () => void
}

function positionLabel(p: PositionFilter): string {
  if (p === 'all') return t.positionAll
  if (p === 'none') return t.positionNone
  return positionText(p)
}

function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <SelectBox id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </SelectBox>
    </div>
  )
}

// 6.1 篩選列：期間（同 v1 4.5，與紀錄列表共用 PeriodPicker）、關鍵字、紀錄類型、來源、位置、標籤、關聯場次；
// 場次標籤（可移除）與清除篩選
export function HandFilterBar({ filters, onChange, tagOptions, sessionTag, onRemoveSessionTag, periodError, filtering, onClear }: Props) {
  // 目前選的標籤不在選項中（例如該標籤的手牌剛被刪除）時仍列出，選單才能顯示目前的值
  const tags = filters.tag !== null && !tagOptions.includes(filters.tag) ? [filters.tag, ...tagOptions] : tagOptions
  return (
    <section aria-label={t.label} className="mt-2 space-y-3">
      <div className="grid grid-cols-[8.5rem_1fr] gap-3">
        <PeriodSelect idPrefix="hl" value={filters.period} onChange={(period) => onChange({ period })} />
        <div className="min-w-0">
          <label htmlFor="hl-keyword" className={labelClass}>
            {t.keyword}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
            />
            <input
              id="hl-keyword"
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

      {filters.period === 'custom' && <CustomRangeFields idPrefix="hl" value={filters} onChange={onChange} error={periodError} />}

      <div className="grid grid-cols-3 gap-3">
        <Select id="hl-kind" label={t.kind} value={filters.kind} onChange={(v) => onChange({ kind: v as HandListFilters['kind'] })}>
          {KIND_FILTERS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </Select>
        <Select id="hl-source" label={t.source} value={filters.source} onChange={(v) => onChange({ source: v as HandListFilters['source'] })}>
          {SOURCE_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t.sources[s]}
            </option>
          ))}
        </Select>
        <Select id="hl-position" label={t.position} value={filters.position} onChange={(v) => onChange({ position: v as PositionFilter })}>
          {POSITION_FILTERS.map((p) => (
            <option key={p} value={p}>
              {positionLabel(p)}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <Select id="hl-tag" label={t.tag} value={filters.tag ?? TAG_ALL} onChange={(v) => onChange({ tag: v === TAG_ALL ? null : v })}>
          <option value={TAG_ALL}>{t.tagAll}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
        <Select id="hl-link" label={t.link} value={filters.link} onChange={(v) => onChange({ link: v as HandListFilters['link'] })}>
          {LINK_FILTERS.map((l) => (
            <option key={l} value={l}>
              {t.links[l]}
            </option>
          ))}
        </Select>
      </div>

      {(sessionTag !== null || filtering) && (
        <div className="flex flex-wrap items-center gap-2">
          {sessionTag !== null && (
            <button
              type="button"
              onClick={onRemoveSessionTag}
              aria-label={strings.sessions.filters.removeTag(sessionTag)}
              data-testid="hand-filter-tag"
              className="flex min-h-(--touch-min) max-w-full items-center gap-1 rounded-full border border-(--color-border) bg-(--color-surface-raised) pl-3 pr-2 text-sm"
            >
              <span className="truncate">{sessionTag}</span>
              <X aria-hidden="true" size={16} className="shrink-0 text-(--color-text-muted)" />
            </button>
          )}
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
