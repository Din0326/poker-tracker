import { useEffect, useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { DEFAULT_HERO_NAME, EXPORT_MIME } from '../../domain/hands'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { exportFile, type ExportOutcome } from '../../lib/shareFile'
import { strings } from '../../strings'
import { countText, exceedsExportLimit, prepareExport, type ExportRequest, type PreparedExport } from './handExportModel'

const t = strings.hands.export
const SUCCESS_TOAST_MS = 3000

type SheetState =
  | { status: 'preparing' }
  | { status: 'error' }
  /** 0 手完整手牌：不顯示匯出按鈕 */
  | { status: 'empty' }
  /** 超過 10,000 手：不顯示匯出按鈕 */
  | { status: 'tooMany' }
  | { status: 'ready'; prepared: PreparedExport }

/** 不需要讀取 DB 就能決定的狀態（0 手、超過上限）；其餘先顯示「準備中…」 */
function initialState(request: ExportRequest): SheetState {
  if (request.completeIds.length === 0) return { status: 'empty' }
  if (exceedsExportLimit(request)) return { status: 'tooMany' }
  return { status: 'preparing' }
}

/**
 * SPEC-v2-hands 7.1 匯出 sheet「匯出手牌」：開啟後非同步讀取完整手牌與匯出名稱並組好文字（顯示「準備中…」），
 * 按「分享 / 下載」時在 click 的同步路徑中建立 File 並呼叫 exportFile（其內同步呼叫 navigator.share），中間沒有任何 await。
 * 呼叫端以 key 讓每次開啟都是新的狀態。
 */
export function HandExportSheet({ request: requestProp, onClose }: { request: ExportRequest; onClose: () => void }) {
  const { repos } = useAppData()
  // 開啟當下的匯出範圍（之後父層重新渲染產生的新物件不影響這次匯出）
  const [request] = useState(requestProp)
  const [state, setState] = useState<SheetState>(() => initialState(request))
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'retry' | 'failed' | null>(null)

  useEffect(() => {
    if (initialState(request).status !== 'preparing') return
    let cancelled = false
    Promise.all([repos.hands.getMany(request.completeIds), repos.settings.get('handHeroName')]).then(
      ([hands, heroName]) => {
        if (cancelled) return
        const prepared = prepareExport(hands, heroName ?? DEFAULT_HERO_NAME, request.single)
        setState(prepared ? { status: 'ready', prepared } : { status: 'empty' })
      },
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, request, attempt])

  /** 同步建立檔案並呼叫 exportFile（之前不得有任何 await）；分享取消不提示，失去使用者手勢時提示再按一次 */
  const share = () => {
    if (busy || state.status !== 'ready') return
    const { prepared } = state
    let job: Promise<ExportOutcome>
    try {
      const file = new File([prepared.text], prepared.fileName(new Date()), { type: EXPORT_MIME })
      job = exportFile(file)
    } catch {
      setNotice('failed')
      return
    }
    setBusy(true)
    setNotice(null)
    void job
      .then((outcome) => {
        if (outcome === 'cancelled') return
        onClose()
        showGlobalToast({ text: t.done(countText(prepared.count)), durationMs: SUCCESS_TOAST_MS })
      })
      .catch((err: unknown) => setNotice(err instanceof DOMException && err.name === 'NotAllowedError' ? 'retry' : 'failed'))
      .finally(() => setBusy(false))
  }

  const skipped = request.skippedSimple > 0 && (
    <p data-testid="export-skipped" className="text-sm text-(--color-text-muted)">
      {t.skippedSimple(countText(request.skippedSimple))}
    </p>
  )

  let body
  switch (state.status) {
    case 'preparing':
      body = (
        <p role="status" data-testid="export-preparing" className="py-4 text-center text-(--color-text-muted)">
          {t.preparing}
        </p>
      )
      break
    case 'error':
      body = (
        <div role="alert" className="flex flex-col items-center gap-3 py-4 text-center">
          <p>{strings.common.loadFailed}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'preparing' })
              setAttempt((n) => n + 1)
            }}
            className={secondaryButtonClass}
          >
            {strings.common.retry}
          </button>
        </div>
      )
      break
    case 'empty':
      body = (
        <div className="space-y-2">
          <p data-testid="export-none" className="font-semibold">
            {t.none}
          </p>
          {skipped}
        </div>
      )
      break
    case 'tooMany':
      body = (
        <div className="space-y-2">
          <p data-testid="export-too-many" role="alert" className="font-semibold text-(--color-danger)">
            {t.tooMany}
          </p>
          {skipped}
        </div>
      )
      break
    case 'ready':
      body = (
        <div className="space-y-2">
          <p data-testid="export-count" className="num font-semibold">
            {t.willExport(countText(state.prepared.count))}
          </p>
          {skipped}
          {state.prepared.unsupported > 0 && (
            <p data-testid="export-gto-hint" role="note" className="text-sm text-(--color-text-muted)">
              {t.gtoHint(countText(state.prepared.unsupported))}
            </p>
          )}
          {notice !== null && (
            <p role="alert" data-testid="export-notice" className="text-sm font-semibold text-(--color-danger)">
              {notice === 'retry' ? t.retry : t.failed}
            </p>
          )}
        </div>
      )
      break
  }

  return (
    <BottomSheet open title={t.sheetTitle} onClose={() => !busy && onClose()}>
      <div data-testid="hand-export-sheet" data-status={state.status}>
        {body}
        <div className={`mt-4 grid gap-3 ${state.status === 'ready' ? 'grid-cols-2' : ''}`}>
          <button type="button" disabled={busy} onClick={onClose} className={secondaryButtonClass}>
            {strings.common.cancel}
          </button>
          {state.status === 'ready' && (
            <button type="button" disabled={busy} aria-busy={busy} onClick={share} className={primaryButtonClass}>
              {busy ? t.sharing : t.share}
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}
