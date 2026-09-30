import { useRef, useState, type FormEvent } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { FieldError } from '../../components/FieldError'
import { NumberInput } from '../../components/NumberInput'
import { DuplicateStakeError, InUseError } from '../../db'
import type { Stake } from '../../domain'
import { describedBy } from '../../lib/aria'
import { useAppData } from '../../lib/appData'
import { parseDigits } from './formModel'
import { strings } from '../../strings'

const t = strings.addStake

type Props = {
  open: boolean
  onClose: () => void
  /** 新增或修改成功後呼叫（新增時由呼叫端自動選取） */
  onCreated: (stake: Stake) => void
  /** 指定時為修改模式（8.2，僅限未被參照的盲注）：標題改為「修改盲注」，預填目前的 sb、bb */
  stake?: Stake | undefined
}

// 5.3 行內新增盲注：輸入小盲、大盲，儲存後由呼叫端自動選取；8.2 盲注管理的新增與修改共用
export function AddStakeSheet({ open, onClose, onCreated, stake }: Props) {
  return (
    <BottomSheet open={open} title={stake ? strings.manage.stakes.editTitle : t.title} onClose={onClose}>
      {/* 每次開啟都重新建立內容，輸入與錯誤從空白（或目前的值）開始 */}
      {open && <AddStakeForm onCancel={onClose} onCreated={onCreated} stake={stake} />}
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

function AddStakeForm({
  onCancel,
  onCreated,
  stake,
}: {
  onCancel: () => void
  onCreated: (stake: Stake) => void
  stake: Stake | undefined
}) {
  const { repos } = useAppData()
  const [sb, setSb] = useState(stake ? String(stake.sb) : '')
  const [bb, setBb] = useState(stake ? String(stake.bb) : '')
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
      const saved = stake
        ? await repos.stakes.update(stake.id, Number(sb), Number(bb))
        : await repos.stakes.create(Number(sb), Number(bb))
      onCreated(saved)
    } catch (err) {
      setSaving(false)
      const message =
        err instanceof DuplicateStakeError
          ? t.errors.duplicate
          : err instanceof InUseError
            ? strings.manage.inUseError
            : strings.record.saveFailed
      setErrors({ bb: message })
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
