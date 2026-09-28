import { useEffect, useRef, useState } from 'react'
import { InstallBanner } from '../../components/InstallBanner'
import { Page } from '../../components/Page'
import { secondaryButtonClass } from '../../components/controlStyles'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'
import { loadRecordFormData } from './loadRecordFormData'
import { RecordForm, type RecordFormData, type RecordFormHandle } from './RecordForm'

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: RecordFormData }

// 新增場次（第 5 節）；App 首頁
export function RecordPage() {
  const { repos } = useAppData()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [dirty, setDirty] = useState(false)
  const formRef = useRef<RecordFormHandle>(null)

  // 讀取盲注、場地、設定與草稿；完成前顯示載入中，失敗顯示錯誤狀態（9.4）
  useEffect(() => {
    let cancelled = false
    loadRecordFormData(repos).then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, attempt])

  // Q6：「清除」只在表單與預設值不同時顯示
  const clearButton =
    state.status === 'ready' && dirty ? (
      <button
        type="button"
        onClick={() => formRef.current?.clear()}
        className="flex min-h-(--touch-min) min-w-(--touch-min) items-center justify-center rounded-(--radius-control) px-2 text-base text-(--color-accent)"
      >
        {strings.record.clear}
      </button>
    ) : null

  return (
    <Page title={strings.pages.record} action={clearButton}>
      <InstallBanner />
      {state.status === 'loading' && (
        <p role="status" className="py-10 text-center text-(--color-text-muted)">
          {strings.common.loading}
        </p>
      )}
      {state.status === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <p>{strings.common.loadFailed}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' })
              setAttempt((n) => n + 1)
            }}
            className={secondaryButtonClass}
          >
            {strings.common.retry}
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <RecordForm ref={formRef} mode="create" data={state.data} onDirtyChange={setDirty} />
      )}
    </Page>
  )
}
