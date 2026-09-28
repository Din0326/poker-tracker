import { useRef, useState, type FormEvent } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { FieldError } from '../../components/FieldError'
import { DuplicateNameError } from '../../db'
import { MAX_VENUE_NAME_LENGTH, charCount, type Venue } from '../../domain'
import { describedBy } from '../../lib/aria'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'

const t = strings.addVenue

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (venue: Venue) => void
}

// 5.3 行內新增場地：儲存後由呼叫端自動選取
export function AddVenueSheet({ open, onClose, onCreated }: Props) {
  return (
    <BottomSheet open={open} title={t.title} onClose={onClose}>
      {open && <AddVenueForm onCancel={onClose} onCreated={onCreated} />}
    </BottomSheet>
  )
}

/** 3.3：去除前後空白後 1–30 字（code point）；重複由 repository 檢查 */
function validate(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return t.errors.required
  if (charCount(trimmed) > MAX_VENUE_NAME_LENGTH) return t.errors.tooLong
  return undefined
}

function AddVenueForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (venue: Venue) => void }) {
  const { repos } = useAppData()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSubmitted(true)
    const found = validate(name)
    setError(found)
    if (found) return inputRef.current?.focus()
    setSaving(true)
    try {
      onCreated(await repos.venues.create(name))
    } catch (err) {
      setSaving(false)
      setError(err instanceof DuplicateNameError ? t.errors.duplicate : strings.record.saveFailed)
      inputRef.current?.focus()
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)}>
      <label htmlFor="add-venue-name" className="mb-1 block text-sm text-(--color-text-muted)">
        {t.name}
      </label>
      <input
        ref={inputRef}
        id="add-venue-name"
        type="text"
        autoComplete="off"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          if (submitted) setError(validate(e.target.value))
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && 'add-venue-name-error')}
        className={inputClass}
      />
      <FieldError id="add-venue-name-error" message={error} />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          {strings.common.cancel}
        </button>
        <button type="submit" disabled={saving} className={primaryButtonClass}>
          {strings.common.save}
        </button>
      </div>
    </form>
  )
}
