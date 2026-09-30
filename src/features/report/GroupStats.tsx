import { ChevronRight } from 'lucide-react'
import { memo } from 'react'
import { SegmentedControl } from '../../components/SegmentedControl'
import { strings } from '../../strings'
import { profitColorClass } from '../sessions/sessionView'
import { GROUP_OPTIONS_BY_TAB, type GroupBy, type GroupRow } from './grouping'
import type { ReportTab } from './reportModel'

const t = strings.report.groups

type Props = {
  tab: ReportTab
  groupBy: GroupBy
  onGroupByChange: (by: GroupBy) => void
  rows: GroupRow[]
  onOpen: (row: GroupRow) => void
}

// 6.4 分組統計：分段選擇器 + 各組（整列為按鈕，點擊跳到紀錄列表並套用篩選）
export const GroupStats = memo(function GroupStats({ tab, groupBy, onGroupByChange, rows, onOpen }: Props) {
  const options = GROUP_OPTIONS_BY_TAB[tab].map((value) => ({ value, label: t.options[value] }))
  return (
    <section aria-labelledby="rp-groups-title" className="mt-6">
      <h2 id="rp-groups-title" className="px-1 pb-2 text-sm font-semibold text-(--color-text-muted)">
        {t.title}
      </h2>
      <SegmentedControl
        label={t.groupByLabel}
        options={options}
        value={groupBy}
        onChange={onGroupByChange}
        testId="group-by"
      />
      {rows.length === 0 ? (
        <p data-testid="groups-empty" className="py-8 text-center text-sm text-(--color-text-muted)">
          {strings.report.noRecordsInPeriod}
        </p>
      ) : (
        <ul className="mt-2 overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)">
          {rows.map((row) => (
            <li key={row.key} className="border-b border-(--color-border) last:border-b-0">
              <button
                type="button"
                data-testid="group-row"
                data-group-key={row.key}
                onClick={() => onOpen(row)}
                className="block w-full px-3 py-2.5 text-left"
              >
                <span className="flex min-h-6 items-center gap-2">
                  <span data-testid="group-label" className="min-w-0 flex-1 truncate font-semibold">
                    {row.label}
                  </span>
                  <ChevronRight aria-hidden="true" size={18} className="-mr-1 shrink-0 text-(--color-text-muted)" />
                </span>
                <span className={`mt-1 grid gap-x-3 gap-y-1 ${row.cells.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {row.cells.map((cell) => (
                    <span key={cell.key} data-testid="group-cell" data-cell={cell.key} className="flex min-w-0 flex-col">
                      <span className="text-xs text-(--color-text-muted)">{cell.label}</span>
                      <span className={`num truncate text-sm font-semibold ${profitColorClass(cell.value.tone)}`}>
                        {cell.value.text}
                      </span>
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
