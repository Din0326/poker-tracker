// 分段選擇器：一組原生 <button>，以 aria-pressed 標示目前選項（9.4）。
// 外觀與紀錄頁的類型篩選一致；每個按鈕高 44px（9.2 觸控區域）。

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

type Props<T extends string> = {
  /** 群組的無障礙名稱 */
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  testId?: string
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, testId }: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) p-1"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-h-11 min-w-0 rounded-[calc(var(--radius-control)-4px)] px-1 text-sm font-semibold whitespace-nowrap ${
              active ? 'bg-(--color-accent) text-(--color-on-accent)' : 'text-(--color-text-muted)'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
