import { useRef, useState, type FormEvent } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { FieldError } from '../../components/FieldError'
import { NumberInput } from '../../components/NumberInput'
import { DuplicateStakeError } from '../../db'
import type { Stake } from '../../domain'
import { describedBy } from '../../lib/aria'
import { useAppData } from '../../lib/appData'
import { parseDigits } from './formModel'
import { strings } from '../../strings'

const t = strings.addStake

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (stake: Stake) => void
}

// 5.3 行內新增盲注：輸入小盲、大盲，儲存後由呼叫端自動選取
export function AddStakeSheet({ open, onClose, onCreated }: Props) {
  return (
    <BottomSheet open={open} title={t.title} onClose={onClose}>
      {/* 每次開啟都重新建立內容，輸入與錯誤從空白開始 */}
      {open && <AddStakeForm onCancel={onClose} onCreated={onCreated} />}
    </BottomSheet>
  )
}

type Errors = { sb?: string; bb?: string }

function validate(sb: string, bb: string): Errors {
  const errors: Errors = {}
  const s = parseDigits(sb)
  const b = parseDigits(bb)
  if (s === null || s < 1) errors.sb = t.errors.sbMin
  if (b === null || b < 1 || (s !== null && s >= 1 && b < s)) errors.bb = t.errors.bbLessThanSb
  return errors
}

function AddStakeForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (stake: Stake) => void }) {
  const { repos } = useAppData()
  const [sb, setSb] = useState('')
  const [bb, setBb] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const sbRef = useRef<HTMLInputElement>(null)
  const bbRef = useRef<HTMLInputElement>(null)

  // 按過儲存後，修改即時重新驗證
  const update = (nextSb: string, nextBb: string) => {
    setSb(nextSb)
    setBb(nextBb)
    if (submitted) setErrors(validate(nextSb, nextBb))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSubmitted(true)
    const found = validate(sb, bb)
    setErrors(found)
    if (found.sb) return sbRef.current?.focus()
    if (found.bb) return bbRef.current?.focus()
    setSaving(true)
    try {
      const stake = await repos.stakes.create(Number(sb), Number(bb))
      onCreated(stake)
    } catch (err) {
      setSaving(false)
      setErrors({ bb: err instanceof DuplicateStakeError ? t.errors.duplicate : strings.record.saveFailed })
      bbRef.current?.focus()
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="add-stake-sb" className="mb-1 block text-sm text-(--color-text-muted)">
            {t.sb}
          </label>
          <NumberInput
            ref={sbRef}
            id="add-stake-sb"
            grouping={false}
            value={sb}
            onValueChange={(v) => update(v, bb)}
            aria-invalid={errors.sb ? true : undefined}
            aria-describedby={describedBy(errors.sb && 'add-stake-sb-error')}
          />
          <FieldError id="add-stake-sb-error" message={errors.sb} />
        </div>
        <div>
          <label htmlFor="add-stake-bb" className="mb-1 block text-sm text-(--color-text-muted)">
            {t.bb}
          </label>
          <NumberInput
            ref={bbRef}
            id="add-stake-bb"
            grouping={false}
            value={bb}
            onValueChange={(v) => update(sb, v)}
            aria-invalid={errors.bb ? true : undefined}
            aria-describedby={describedBy(errors.bb && 'add-stake-bb-error')}
          />
          <FieldError id="add-stake-bb-error" message={errors.bb} />
        </div>
      </div>
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
