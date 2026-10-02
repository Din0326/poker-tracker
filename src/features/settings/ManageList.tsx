import { ChevronDown, ChevronRight, ChevronUp, Ellipsis } from 'lucide-react'
import type { ReactNode } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import type { MoveDirection } from '../../db'
import { strings } from '../../strings'

const t = strings.manage

// 8.1 場地管理、8.2 盲注管理共用的列表與操作面板。
// 每列：名稱、使用場次數、上移 / 下移圖示鈕、「更多操作」圖示鈕（開啟操作 sheet，列出該項可用的動作）。
// 已封存項目收在原生 <details>「已封存」折疊區（預設收合），區內同樣可上下移（只在同一封存狀態內交換）。

export interface ManageItem {
  id: string
  label: string
  archived: boolean
  usage: number
}

/** 操作面板中的危險動作（刪除）：外觀同次要按鈕，文字為 danger 色 */
const dangerActionClass = secondaryButtonClass.replace('text-(--color-text)', 'text-(--color-danger)')

const iconButtonClass =
  'flex size-(--touch-min) shrink-0 items-center justify-center rounded-(--radius-control) text-(--color-text-muted) disabled:opacity-30'

function Rows({
  testId,
  items,
  busy,
  onMove,
  onMore,
}: {
  testId: string
  items: ManageItem[]
  busy: boolean
  onMove: (item: ManageItem, direction: MoveDirection) => void
  onMore: (item: ManageItem) => void
}) {
  return (
    <ul
      data-testid={testId}
      className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)"
    >
      {items.map((item, i) => (
        <li
          key={item.id}
          data-testid="manage-row"
          data-id={item.id}
          className="flex min-h-14 items-center gap-0.5 border-b border-(--color-border) pr-1 pl-4 last:border-b-0"
        >
          <div className="min-w-0 flex-1 py-2">
            <p data-testid="manage-label" className="num truncate font-semibold">
              {item.label}
            </p>
            <p data-testid="manage-usage" className="num text-sm text-(--color-text-muted)">
              {t.usage(item.usage)}
            </p>
          </div>
          <button
            type="button"
            aria-label={t.moveUp(item.label)}
            disabled={busy || i === 0}
            onClick={() => onMove(item, 'up')}
            className={iconButtonClass}
          >
            <ChevronUp aria-hidden="true" size={22} />
          </button>
          <button
            type="button"
            aria-label={t.moveDown(item.label)}
            disabled={busy || i === items.length - 1}
            onClick={() => onMove(item, 'down')}
            className={iconButtonClass}
          >
            <ChevronDown aria-hidden="true" size={22} />
          </button>
          <button
            type="button"
            aria-label={t.more(item.label)}
            disabled={busy}
            onClick={() => onMore(item)}
            className={iconButtonClass}
          >
            <Ellipsis aria-hidden="true" size={22} />
          </button>
        </li>
      ))}
    </ul>
  )
}

type ListProps = {
  items: ManageItem[]
  busy: boolean
  emptyText: string
  onAdd: () => void
  onMove: (item: ManageItem, direction: MoveDirection) => void
  onMore: (item: ManageItem) => void
}

export function ManageList({ items, busy, emptyText, onAdd, onMove, onMore }: ListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{emptyText}</p>
        <button type="button" onClick={onAdd} className={primaryButtonClass}>
          {t.add}
        </button>
      </div>
    )
  }
  const active = items.filter((i) => !i.archived)
  const archived = items.filter((i) => i.archived)
  return (
    <div className="mt-2">
      {active.length > 0 ? (
        <Rows testId="active-list" items={active} busy={busy} onMove={onMove} onMore={onMore} />
      ) : (
        <p className="py-6 text-center text-(--color-text-muted)">{t.noActive}</p>
      )}
      {archived.length > 0 && (
        <details data-testid="archived-section" className="group mt-4">
          <summary className="flex min-h-(--touch-min) cursor-pointer list-none items-center gap-1 px-1 text-sm font-semibold text-(--color-text-muted) [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" size={18} className="transition-transform duration-(--motion-duration) motion-reduce:transition-none group-open:rotate-90" />
            {t.archivedSection(archived.length)}
          </summary>
          <div className="mt-1">
            <Rows testId="archived-list" items={archived} busy={busy} onMove={onMove} onMore={onMore} />
          </div>
        </details>
      )}
    </div>
  )
}

export interface ManageAction {
  key: string
  label: string
  danger?: boolean
  onPress: () => void
}

/** 某一項的操作面板：列出可用的動作（不可用的動作不顯示） */
export function ManageActionSheet({
  item,
  hint,
  actions,
  onClose,
}: {
  item: ManageItem | null
  hint: string | null
  actions: ManageAction[]
  onClose: () => void
}) {
  return (
    <BottomSheet open={item !== null} title={item?.label ?? ''} onClose={onClose}>
      {hint && <p className="mb-3 text-sm text-(--color-text-muted)">{hint}</p>}
      <div className="flex flex-col gap-2">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={a.onPress}
            className={a.danger ? dangerActionClass : secondaryButtonClass}
          >
            {a.label}
          </button>
        ))}
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {strings.common.cancel}
        </button>
      </div>
    </BottomSheet>
  )
}

/** 危險操作的確認面板：確認鈕紅色（9.2） */
export function DangerConfirmSheet({
  open,
  title,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean
  title: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {children}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {strings.common.cancel}
        </button>
        <button type="button" disabled={busy} onClick={onConfirm} className={dangerButtonClass}>
          {confirmLabel}
        </button>
      </div>
    </BottomSheet>
  )
}
