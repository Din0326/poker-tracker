import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { BottomSheet } from '../../components/BottomSheet'
import { Page } from '../../components/Page'
import { dangerButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import type { Session, Stake } from '../../domain'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { useGoBack } from '../../lib/useGoBack'
import { strings } from '../../strings'
import { SESSIONS_PATH } from '../sessions/listUrl'
import { HandForm, type HandFormData } from './HandForm'
import { createEntryValues, parseHandDraft, type HandFormValues } from './handFormModel'
import { loadHandFormData } from './loadHandFormData'
import { HANDS_PATH } from './handPaths'
import { upsertCachedHand } from './handsStore'

const t = strings.hands
const TOAST_MS = 5000

type Ready = {
  /** 每次載入（含網址的 sessionId 改變）遞增，讓表單以新的預帶值重新掛載 */
  loadId: number
  data: HandFormData
  session: Session | null
  stake: Stake | null
  entry: HandFormValues
  initial: HandFormValues
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  /** 5.7：草稿的關聯場次與這次進入帶的 sessionId 不同，先詢問 */
  | { status: 'prompt'; ready: Ready; draft: HandFormValues; actionsDropped: boolean }
  | { status: 'ready'; ready: Ready }

// 新增手牌（SPEC-v2-hands 5.1–5.7）：#/hands/new（可帶 ?sessionId=）。
// 入口：手牌列表右上角與空狀態（不關聯場次）、場次詳情的「＋ 新增手牌」（預先關聯該場）
export function HandNewPage() {
  const { repos } = useAppData()
  const [params] = useSearchParams()
  const sessionParam = params.get('sessionId')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const loadSeq = useRef(0)
  useEffect(() => {
    let cancelled = false
    const loadId = ++loadSeq.current
    Promise.all([loadHandFormData(repos), repos.settings.get('handDraft')]).then(
      ([loaded, rawDraft]) => {
        if (cancelled) return
        // 帶入的 sessionId 不存在時視為不帶（關聯場次為「不指定」）
        const session = sessionParam === null ? null : (loaded.sessions.find((s) => s.id === sessionParam) ?? null)
        const stake = session?.stakeId ? (loaded.stakes.find((s) => s.id === session.stakeId) ?? null) : null
        const entry = createEntryValues({ now: new Date(), lastHandSetup: loaded.data.lastHandSetup, session, stake })
        const base: Ready = { loadId, data: loaded.data, session, stake, entry, initial: entry }
        const draft = parseHandDraft(rawDraft)
        if (!draft) return setState({ status: 'ready', ready: base })
        if (draft.values.sessionId === entry.sessionId) {
          if (draft.actionsDropped) showGlobalToast({ text: t.draft.actionsDropped, durationMs: TOAST_MS })
          return setState({ status: 'ready', ready: { ...base, initial: draft.values } })
        }
        setState({ status: 'prompt', ready: base, draft: draft.values, actionsDropped: draft.actionsDropped })
      },
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, sessionParam, attempt])

  // 5.8 儲存後：從場次詳情進入者返回場次詳情；其餘返回手牌列表（皆為返回上一頁；直接開啟網址時前往 backTo）
  const fromSession = state.status === 'ready' || state.status === 'prompt' ? state.ready.session : null
  const backTo = fromSession ? `${SESSIONS_PATH}/${encodeURIComponent(fromSession.id)}` : HANDS_PATH
  const goBack = useGoBack(backTo)

  if (state.status === 'ready') {
    const { ready } = state
    return (
      <HandForm
        key={ready.loadId}
        mode="create"
        data={ready.data}
        initial={ready.initial}
        baseline={ready.entry}
        makeEntry={() => createEntryValues({ now: new Date(), lastHandSetup: ready.data.lastHandSetup, session: ready.session, stake: ready.stake })}
        title={strings.pages.handNew}
        backTo={backTo}
        onSaved={(hand) => {
          upsertCachedHand(hand)
          goBack()
        }}
      />
    )
  }

  return (
    <Page title={strings.pages.handNew} backTo={backTo}>
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
      <BottomSheet open={state.status === 'prompt'} title={t.draft.title} onClose={() => undefined}>
        {state.status === 'prompt' && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                // 還原草稿，忽略這次帶的 sessionId
                if (state.actionsDropped) showGlobalToast({ text: t.draft.actionsDropped, durationMs: TOAST_MS })
                setState({ status: 'ready', ready: { ...state.ready, initial: state.draft } })
              }}
              className={secondaryButtonClass}
            >
              {t.draft.resume}
            </button>
            <button
              type="button"
              onClick={() => {
                // 刪除草稿，依這次的入口預帶
                repos.settings.delete('handDraft').catch(() => undefined)
                setState({ status: 'ready', ready: state.ready })
              }}
              className={dangerButtonClass}
            >
              {t.draft.discard}
            </button>
          </div>
        )}
      </BottomSheet>
    </Page>
  )
}
