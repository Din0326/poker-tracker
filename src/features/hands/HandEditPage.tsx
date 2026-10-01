import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBlocker, useNavigate, useParams, type BlockerFunction } from 'react-router'
import { BottomSheet } from '../../components/BottomSheet'
import { Page } from '../../components/Page'
import { dangerButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import type { Hand } from '../../domain/hands'
import { useAppData } from '../../lib/appData'
import { useGoBack } from '../../lib/useGoBack'
import { strings } from '../../strings'
import { HandForm, type HandFormData } from './HandForm'
import { handToValues } from './handFormModel'
import { loadHandFormData } from './loadHandFormData'

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'notFound' } | { status: 'ready'; hand: Hand; data: HandFormData }

// 編輯手牌（SPEC-v2-hands 5.8）：#/hands/:id/edit。沿用新增的元件；不讀寫草稿、不更新 lastHandSetup。
// 簡易備忘手牌開啟簡易模式（可「補齊為完整手牌」）；有 detail 的手牌開啟完整模式，進度停在最後狀態。
// 有未儲存變更時，所有 App 內離開都先確認「放棄變更？」（同 v1 5.7 的 useBlocker 做法）。
// 手牌詳情（#/hands/:id）於 H2 實作；儲存後返回上一頁，直接開啟網址時回到首頁。
export function HandEditPage() {
  const { id = '' } = useParams()
  const { repos } = useAppData()
  const navigate = useNavigate()
  const backTo = '/'
  const goBack = useGoBack(backTo)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
    [],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    let cancelled = false
    Promise.all([repos.hands.get(id), loadHandFormData(repos)]).then(
      ([hand, loaded]) => {
        if (cancelled) return
        setState(hand ? { status: 'ready', hand, data: loaded.data } : { status: 'notFound' })
      },
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, id, attempt])

  const editValues = useMemo(() => (state.status === 'ready' ? handToValues(state.hand, state.data.lastHandSetup) : null), [state])

  const leaveSheet = (
    <BottomSheet open={blocker.state === 'blocked'} title={strings.sessions.editLeaveSheet.title} onClose={() => blocker.reset?.()}>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => blocker.reset?.()} className={secondaryButtonClass}>
          {strings.common.cancel}
        </button>
        <button type="button" onClick={() => blocker.proceed?.()} className={dangerButtonClass}>
          {strings.common.confirm}
        </button>
      </div>
    </BottomSheet>
  )

  if (state.status === 'ready' && editValues) {
    const values = editValues
    return (
      <>
        <HandForm
          key={state.hand.id}
          mode="edit"
          data={state.data}
          initial={values}
          baseline={values}
          makeEntry={() => values}
          hand={state.hand}
          title={strings.pages.handEdit}
          backTo={backTo}
          onDirtyChange={onDirtyChange}
          onSaved={() => {
            dirtyRef.current = false
            goBack()
          }}
        />
        {leaveSheet}
      </>
    )
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
  } else {
    body = (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{strings.hands.notFound}</p>
        <button type="button" onClick={() => void navigate('/', { replace: true })} className={secondaryButtonClass}>
          {strings.common.back}
        </button>
      </div>
    )
  }
  return <Page title={strings.pages.handEdit} backTo={backTo}>{body}</Page>
}
