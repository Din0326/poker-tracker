import { ChevronRight } from 'lucide-react'
import { strings } from '../../strings'
import { PROGRESS_STEPS, type ProgressStep, type StepStatus } from './handFormModel'

const t = strings.hands.progress

type Props = {
  statuses: Record<ProgressStep, StepStatus>
  /** 目前檢視的步驟（回看時不等於目前步驟） */
  viewing: ProgressStep
  onSelect: (step: ProgressStep) => void
}

// 5.3 進度「設定 › 翻前 › 翻牌 › 轉牌 › 河牌 › 結果」：已完成的步驟可點擊回看，
// 尚未到達或因手牌提早結束而不會到達的步驟停用
export function ProgressSteps({ statuses, viewing, onSelect }: Props) {
  return (
    <nav aria-label={t.label} className="mt-3">
      <ol className="flex items-center justify-between">
        {PROGRESS_STEPS.map((step, i) => {
          const status = statuses[step]
          const isViewing = step === viewing
          return (
            <li key={step} className="flex min-w-0 items-center">
              {i > 0 && <ChevronRight aria-hidden="true" size={14} className="shrink-0 text-(--color-text-muted)" />}
                <button
                  type="button"
                  disabled={status === 'disabled'}
                  aria-current={status === 'current' ? 'step' : undefined}
                  aria-pressed={isViewing}
                  data-status={status}
                  onClick={() => onSelect(step)}
                  className={`flex min-h-(--touch-min) min-w-(--touch-min) items-center justify-center rounded-(--radius-control) px-1 text-sm whitespace-nowrap disabled:opacity-40 ${
                    isViewing ? 'bg-(--color-accent) font-semibold text-(--color-on-accent)' : status === 'done' ? 'text-(--color-text) underline underline-offset-4' : 'text-(--color-text-muted)'
                  }`}
                >
                  {t.steps[step]}
                </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
