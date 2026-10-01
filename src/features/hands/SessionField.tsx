import { useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { FieldError } from '../../components/FieldError'
import { SelectBox } from '../../components/SelectBox'
import { inputClass } from '../../components/controlStyles'
import { isSessionTypeCompatible, type SessionType } from '../../domain'
import type { HandGameType } from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { strings } from '../../strings'

const t = strings.hands
const OTHER = '__other__'
/** 5.2：選單列出最近 30 場 */
export const RECENT_SESSION_COUNT = 30

/** 關聯場次的選項（已依 startAt 新到舊排序，label 為「09/27 · 標題」） */
export interface SessionChoice {
  id: string
  type: SessionType
  label: string
}

type Props = {
  id: string
  value: string
  gameType: HandGameType
  /** 全部場次（新到舊） */
  sessions: readonly SessionChoice[]
  onChange: (sessionId: string) => void
  error: string | undefined
  disabled?: boolean
}

// 5.2 關聯場次：「不指定」+ 最近 30 場（只列與 gameType 相容者，3.11），最後一項「選擇其他場次…」開啟可搜尋的場次清單。
// 目前選取的場次不在最近 30 場（或類型已不相容）時仍列出，讓選取狀態與 5.5 的相容錯誤可以顯示。
export function SessionField({ id, value, gameType, sessions, onChange, error, disabled }: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const compatible = sessions.filter((s) => isSessionTypeCompatible(gameType, s.type))
  const recent = compatible.slice(0, RECENT_SESSION_COUNT)
  const selected = value === '' ? undefined : sessions.find((s) => s.id === value)
  const options = selected && !recent.some((s) => s.id === selected.id) ? [selected, ...recent] : recent
  const q = query.trim().toLowerCase()
  const matches = q === '' ? compatible : compatible.filter((s) => s.label.toLowerCase().includes(q))
  const errorId = `${id}-error`

  return (
    <div data-field data-error-key="sessionId" data-invalid={error ? 'true' : undefined} className="mt-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-(--color-text-muted)">
        {t.fields.session}
      </label>
      <SelectBox
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setQuery('')
            setSearchOpen(true)
          } else onChange(e.target.value)
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && errorId)}
      >
        <option value="">{t.sessionNone}</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
        <option value={OTHER}>{t.sessionOther}</option>
      </SelectBox>
      <FieldError id={errorId} message={error} />

      <BottomSheet open={searchOpen} title={t.sessionSearch.title} onClose={() => setSearchOpen(false)}>
        <label htmlFor={`${id}-search`} className="mb-1 block text-sm font-medium text-(--color-text-muted)">
          {t.sessionSearch.label}
        </label>
        <input
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          placeholder={t.sessionSearch.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={inputClass}
        />
        {matches.length === 0 ? (
          <p className="py-6 text-center text-(--color-text-muted)">{t.sessionSearch.empty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-(--color-border) rounded-(--radius-card) border border-(--color-border)">
            {matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(s.id)
                    setSearchOpen(false)
                  }}
                  aria-pressed={s.id === value}
                  className="flex min-h-(--touch-min) w-full items-center px-3 text-left text-base"
                >
                  <span className="num truncate">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    </div>
  )
}
