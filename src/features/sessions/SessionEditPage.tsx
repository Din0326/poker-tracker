import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useBlocker, useNavigate, useParams, type BlockerFunction } from 'react-router'
import { BottomSheet } from '../../components/BottomSheet'
import { Page } from '../../components/Page'
import { dangerButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import type { Session } from '../../domain'
import { useAppData } from '../../lib/appData'
import { useGoBack } from '../../lib/useGoBack'
import { strings } from '../../strings'
import { loadRecordFormData } from '../record/loadRecordFormData'
import { RecordForm, type RecordFormData } from '../record/RecordForm'
import { SESSIONS_PATH } from './listUrl'
import { upsertCachedSession } from './sessionsStore'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'notFound' }
  | { status: 'ready'; session: Session; data: RecordFormData }

// 編輯場次（5.7）：沿用新增表單（mode="edit"），儲存後返回場次詳情。
// 有未儲存變更時，所有 App 內離開（返回鈕、分頁列、其他連結、瀏覽器返回）都先確認「放棄變更？」（Q1）
export function SessionEditPage() {
  const { id = '' } = useParams()
  const { repos } = useAppData()
  const navigate = useNavigate()
  const detailPath = `${SESSIONS_PATH}/${encodeURIComponent(id)}`
  const goBack = useGoBack(detailPath)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // 以 ref 判斷，儲存成功後立即返回時不會被攔截（state 更新尚未生效）
  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
    [],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    let cancelled = false
    Promise.all([repos.sessions.get(id), loadRecordFormData(repos)]).then(
      ([session, data]) => {
        if (cancelled) return
        setState(session ? { status: 'ready', session, data } : { status: 'notFound' })
      },
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, id, attempt])

  const onSaved = (session: Session) => {
    dirtyRef.current = false
    upsertCachedSession(session)
    goBack()
  }

  let body: ReactNode
  if (state.status === 'loading') {
    body = (
      <p role="status" className="py-10 text-center text-(--color-text-muted)">
        {strings.common.loading}
      </p>
    )
  } else if (state.status === 'error') {
    body = (
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
    )
  } else if (state.status === 'notFound') {
    body = (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{strings.sessions.detail.notFound}</p>
        <button type="button" onClick={() => void navigate(SESSIONS_PATH)} className={secondaryButtonClass}>
          {strings.sessions.detail.backToList}
        </button>
      </div>
    )
  } else {
    body = (
      <RecordForm
        key={state.session.id}
        mode="edit"
        data={state.data}
        initialSession={state.session}
        onDirtyChange={onDirtyChange}
        onSaved={onSaved}
      />
    )
  }

  return (
    <Page title={strings.pages.sessionEdit} backTo={detailPath}>
      {body}
      <BottomSheet
        open={blocker.state === 'blocked'}
        title={strings.sessions.editLeaveSheet.title}
        onClose={() => blocker.reset?.()}
      >
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => blocker.reset?.()} className={secondaryButtonClass}>
            {strings.common.cancel}
          </button>
          <button type="button" onClick={() => blocker.proceed?.()} className={dangerButtonClass}>
            {strings.common.confirm}
          </button>
        </div>
      </BottomSheet>
    </Page>
  )
}
