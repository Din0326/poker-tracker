import { Copy, Pencil, Trash } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BottomSheet } from '../../components/BottomSheet'
import { Page } from '../../components/Page'
import { dangerButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { sessionTypeIcons } from '../../components/sessionTypeIcons'
import { ToastBar } from '../../components/Toast'
import {
  averagePlacePercentile,
  bbProfit,
  buyInTotal,
  feeTotal,
  formatBbProfit,
  formatDuration,
  formatFieldSizeOnly,
  formatFinishPlace,
  formatHourly,
  formatMarkup,
  formatMoney,
  formatPermille,
  formatSignedMoney,
  formatTimestamp,
  stakeLabel,
  stakingBreakdown,
  summarize,
  type Session,
  type Stake,
  type Venue,
} from '../../domain'
import { useAppData } from '../../lib/appData'
import { hideGlobalToast, showGlobalToast } from '../../lib/globalToast'
import { strings } from '../../strings'
import { handNewPath } from '../hands/handPaths'
import { parseDraft } from '../record/formModel'
import { sessionToCopyDraft } from './copySession'
import { listMemory } from './listMemory'
import { SESSIONS_PATH } from './listUrl'
import { buildLookup, profitColorClass, sessionTitle, startAtText } from './sessionView'
import { removeCachedSession, upsertCachedSession } from './sessionsStore'

const t = strings.sessions.detail
const UNDO_TOAST_MS = 5000
const ERROR_TOAST_MS = 5000

type Loaded = { session: Session; venues: Venue[]; stakes: Stake[] }
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'notFound' } | { status: 'ready'; data: Loaded }

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3" data-testid={testId}>
      <dt className="shrink-0 text-sm text-(--color-text-muted)">{label}</dt>
      <dd className="num min-w-0 text-right break-words">{children}</dd>
    </div>
  )
}

/** 區塊內的整列文字（合計列）或小標題（全額結果、你的份額） */
function FullRow({ children, testId, heading }: { children: ReactNode; testId?: string; heading?: boolean }) {
  return (
    <div
      data-testid={testId}
      className={`num px-4 py-3 break-words ${heading ? 'text-sm font-semibold text-(--color-text-muted)' : 'text-sm'}`}
    >
      {children}
    </div>
  )
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  const id = `detail-${title}`
  return (
    <section aria-labelledby={id} className="mt-4" data-testid={testId}>
      <h2 id={id} className="px-1 pb-2 text-sm text-(--color-text-muted)">
        {title}
      </h2>
      <dl className="divide-y divide-(--color-border) overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)">
        {children}
      </dl>
    </section>
  )
}

// 場次詳情（7.2）與刪除（7.5）、複製為新紀錄（7.4）
export function SessionDetailPage() {
  const { id = '' } = useParams()
  const { repos } = useAppData()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [sheet, setSheet] = useState<'delete' | 'copy' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ id: number; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([repos.sessions.get(id), repos.venues.list(), repos.stakes.list()]).then(
      ([session, venues, stakes]) => {
        if (cancelled) return
        setState(session ? { status: 'ready', data: { session, venues, stakes } } : { status: 'notFound' })
      },
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, id, attempt])

  // 計時器只關閉自己那則提示，避免舊計時器清掉剛出現的新提示（P6 修正）
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError((current) => (current?.id === error.id ? null : current)), ERROR_TOAST_MS)
    return () => clearTimeout(timer)
  }, [error])
  const errorSeq = useRef(0)
  const showError = (text: string) => setError({ id: ++errorSeq.current, text })

  const page = (children: ReactNode) => (
    <Page title={strings.pages.sessionDetail} backTo={SESSIONS_PATH}>
      {children}
    </Page>
  )

  if (state.status === 'loading') {
    return page(
      <p role="status" className="py-10 text-center text-(--color-text-muted)">
        {strings.common.loading}
      </p>,
    )
  }
  if (state.status === 'error') {
    return page(
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
      </div>,
    )
  }
  if (state.status === 'notFound') {
    return page(
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{t.notFound}</p>
        <button type="button" onClick={() => void navigate(SESSIONS_PATH)} className={secondaryButtonClass}>
          {t.backToList}
        </button>
      </div>,
    )
  }

  const { session, venues, stakes } = state.data
  const lookup = buildLookup(venues, stakes)
  const venue = session.venueId === null ? undefined : lookup.venues.get(session.venueId)
  const stake = session.stakeId === null ? undefined : lookup.stakes.get(session.stakeId)
  // 數字一律來自 4.6 的純函式（與列表、報表、CSV 一致）
  const st = stakingBreakdown(session)
  const staked = st.lines.length > 0
  const p = st.myProfit
  const soldText = formatPermille(st.soldPermille)
  const title = sessionTitle(session, lookup)
  const TypeIcon = sessionTypeIcons[session.type]
  const hourly = summarize([session]).hourly
  const place = session.type === 'mtt' ? averagePlacePercentile([session]) : null
  const archived = (item: { archived: boolean } | undefined) => (item?.archived ? t.archivedSuffix : '')
  const empty = strings.format.empty

  // ---- 7.5 刪除：實體刪除 → 返回列表（replace，避免退回已刪除的詳情頁）→ 5 秒復原提示 ----
  const confirmDelete = async () => {
    setBusy(true)
    try {
      const removed = await repos.sessions.delete(session.id)
      removeCachedSession(removed.session.id)
      setSheet(null)
      void navigate(`${SESSIONS_PATH}${listMemory.search}`, { replace: true })
      const toastId = showGlobalToast({
        text: strings.sessions.undo.deleted,
        durationMs: UNDO_TOAST_MS,
        action: {
          label: strings.sessions.undo.restore,
          onPress: () => {
            hideGlobalToast(toastId)
            // 以原始 id、createdAt、updatedAt 原封不動寫回；刪除時轉為獨立的手牌重新掛回（SPEC-v2-hands 6.5）
            repos.sessions.restore(removed.session, removed.detachedHandIds).then(
              (s) => upsertCachedSession(s),
              () => showGlobalToast({ text: strings.sessions.undo.restoreFailed, durationMs: ERROR_TOAST_MS }),
            )
          },
        },
      })
    } catch {
      setBusy(false)
      setSheet(null)
      showError(strings.sessions.deleteSheet.failed)
    }
  }

  // ---- 7.4 複製為新紀錄：寫成新增頁草稿後切到新增頁；已有草稿時先確認覆蓋 ----
  const copyNow = async () => {
    setBusy(true)
    try {
      await repos.settings.set('recordDraft', sessionToCopyDraft(session, stakes, venues, new Date()))
      void navigate('/')
    } catch {
      setBusy(false)
      setSheet(null)
      showError(strings.sessions.copySheet.failed)
    }
  }
  const requestCopy = async () => {
    let hasDraft = false
    try {
      hasDraft = parseDraft(await repos.settings.get('recordDraft'), stakes, venues) !== null
    } catch {
      // 讀取草稿失敗時視為沒有草稿
    }
    if (hasDraft) setSheet('copy')
    else void copyNow()
  }

  const actionClass = `${secondaryButtonClass} w-full gap-2`

  return page(
    <>
      {/* 頂部：盈利（大字，你的盈利）、類型、標題；有出資者時大字標籤為「你的盈利」，下方小字全額與賣出比例 */}
      <div className="mt-2 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-4 py-5 text-center">
        {staked && (
          <p data-testid="detail-profit-label" className="mb-1 text-sm text-(--color-text-muted)">
            {t.myProfitLabel}
          </p>
        )}
        <p data-testid="detail-profit" className={`num text-4xl font-bold ${profitColorClass(p)}`}>
          {formatSignedMoney(p)}
        </p>
        {staked && (
          <p data-testid="detail-full-summary" className="num mt-1 text-sm text-(--color-text-muted)">
            {t.fullSummary(formatSignedMoney(st.fullProfit), soldText)}
          </p>
        )}
        <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-(--color-text-muted)">
          <TypeIcon aria-hidden="true" size={16} />
          <span data-testid="detail-type">{strings.sessionTypes[session.type]}</span>
        </p>
        <p data-testid="detail-title" className="mt-1 text-lg font-semibold break-words">
          {title}
        </p>
      </div>

      <Section title={t.basicSection}>
        <Row label={t.startAt} testId="detail-startAt">
          {startAtText(session)}
        </Row>
        <Row label={t.duration} testId="detail-duration">
          {formatDuration(session.durationMin)}
        </Row>
        <Row label={t.venue} testId="detail-venue">
          {venue ? `${venue.name}${archived(venue)}` : empty}
        </Row>
        <Row label={t.name} testId="detail-name">
          {session.name ?? empty}
        </Row>
        {session.type === 'cash' && (
          <Row label={t.stake} testId="detail-stake">
            {stake ? `${stakeLabel(stake)}${archived(stake)}` : empty}
          </Row>
        )}
      </Section>

      <Section title={t.amountSection}>
        {session.buyIns.map((b, i) => (
          <Row key={i} label={t.buyInRow(i + 1)} testId="detail-buyIn">
            {t.buyInDetail(formatMoney(b.amount), formatMoney(b.fee))}
          </Row>
        ))}
        <Row label={t.buyInTotal} testId="detail-buyInTotal">
          {formatMoney(buyInTotal(session))}
        </Row>
        <Row label={t.feeTotal} testId="detail-feeTotal">
          {formatMoney(feeTotal(session))}
        </Row>
        <Row label={t.cashOut} testId="detail-cashOut">
          {formatMoney(session.cashOut)}
        </Row>
      </Section>

      {/* 7.2 賣股份（只在有出資者時顯示） */}
      {staked && (
        <Section title={t.stakingSection} testId="detail-staking">
          {st.lines.map((line, i) => (
            <Row
              key={i}
              label={t.backerLabel(line.backer.name, formatPermille(line.backer.sharePermille), formatMarkup(line.backer.markupPermille))}
              testId="detail-backer"
            >
              {t.backerAmounts(formatMoney(line.pay), formatMoney(line.payout))}
            </Row>
          ))}
          <FullRow testId="detail-staking-total">
            {t.stakingTotal(soldText, formatMoney(st.payTotal), formatMoney(st.payoutTotal))}
          </FullRow>
          <FullRow heading>{t.fullResult}</FullRow>
          <Row label={t.buyInTotal} testId="detail-staking-buyInTotal">
            {formatMoney(st.buyInTotal)}
          </Row>
          <Row label={t.cashOut} testId="detail-staking-cashOut">
            {formatMoney(st.cashOut)}
          </Row>
          <Row label={t.fullProfit} testId="detail-staking-fullProfit">
            <span className={profitColorClass(st.fullProfit)}>{formatSignedMoney(st.fullProfit)}</span>
          </Row>
          <FullRow heading testId="detail-my-share">
            {t.myShare(formatPermille(st.myPermille))}
          </FullRow>
          <Row label={t.myCost} testId="detail-myCost">
            {formatMoney(st.myCost)}
          </Row>
          <Row label={t.myCashOut} testId="detail-myCashOut">
            {formatMoney(st.myCashOut)}
          </Row>
          <Row label={t.myProfit} testId="detail-myProfit">
            <span className={profitColorClass(st.myProfit)}>{formatSignedMoney(st.myProfit)}</span>
          </Row>
        </Section>
      )}

      <Section title={t.derivedSection}>
        <Row label={staked ? t.myHourly : t.hourly} testId="detail-hourly">
          <span className={profitColorClass(hourly)}>{formatHourly(hourly)}</span>
        </Row>
        {session.type === 'cash' && (
          <Row label={staked ? t.myBbProfit : t.bbProfit} testId="detail-bbProfit">
            {stake ? (
              <span className={profitColorClass(p)}>{formatBbProfit(bbProfit(session, stake))}</span>
            ) : (
              empty
            )}
          </Row>
        )}
        {place && place.value !== null && session.finishPlace !== null && session.fieldSize !== null && (
          <Row label={t.finish} testId="detail-finish">
            {formatFinishPlace(session.finishPlace, session.fieldSize, place.value)}
          </Row>
        )}
        {/* MTT 只填參賽人數、沒填名次時，於名次列位置顯示參賽人數 */}
        {session.type === 'mtt' && session.finishPlace === null && session.fieldSize !== null && (
          <Row label={t.fieldSize} testId="detail-fieldSize">
            {formatFieldSizeOnly(session.fieldSize)}
          </Row>
        )}
      </Section>

      <section aria-labelledby="detail-note" className="mt-4">
        <h2 id="detail-note" className="px-1 pb-2 text-sm text-(--color-text-muted)">
          {t.noteSection}
        </h2>
        <p
          data-testid="detail-note"
          className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-4 py-3 break-words whitespace-pre-wrap"
        >
          {session.note ?? empty}
        </p>
      </section>

      {/* SPEC-v2-hands 5.1、6.3：「＋ 新增手牌」→ 新增手牌並預先關聯該場（手牌區塊的列表於 H2 加入） */}
      <button type="button" onClick={() => void navigate(handNewPath(session.id))} className={`${secondaryButtonClass} mt-4 w-full`}>
        {strings.hands.addHand}
      </button>

      <div className="mt-6 grid gap-3">
        <button type="button" onClick={() => void navigate(`${SESSIONS_PATH}/${encodeURIComponent(session.id)}/edit`)} className={actionClass}>
          <Pencil aria-hidden="true" size={18} />
          {t.edit}
        </button>
        <button type="button" disabled={busy} onClick={() => void requestCopy()} className={actionClass}>
          <Copy aria-hidden="true" size={18} />
          {t.copy}
        </button>
        <button type="button" disabled={busy} onClick={() => setSheet('delete')} className={`${dangerButtonClass} w-full gap-2`}>
          <Trash aria-hidden="true" size={18} />
          {t.delete}
        </button>
      </div>

      <p className="num mt-6 text-center text-xs text-(--color-text-muted)" data-testid="detail-timestamps">
        <span className="block">{t.createdAt(formatTimestamp(session.createdAt))}</span>
        <span className="block">{t.updatedAt(formatTimestamp(session.updatedAt))}</span>
      </p>

      <BottomSheet open={sheet === 'delete'} title={strings.sessions.deleteSheet.title} onClose={() => setSheet(null)}>
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) px-4 py-3">
          <p className="num text-sm text-(--color-text-muted)">{startAtText(session)}</p>
          <p className="mt-1 font-semibold break-words">{title}</p>
          <p data-testid="delete-sheet-profit" className="num mt-1">
            <span className={`font-semibold ${profitColorClass(p)}`}>{formatSignedMoney(p)}</span>
            {staked && (
              <span className="ml-2 text-sm text-(--color-text-muted)">
                {strings.sessions.deleteSheet.soldNote(soldText)}
              </span>
            )}
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setSheet(null)} className={secondaryButtonClass}>
            {strings.common.cancel}
          </button>
          <button type="button" disabled={busy} onClick={() => void confirmDelete()} className={dangerButtonClass}>
            {strings.sessions.deleteSheet.confirm}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'copy'} title={strings.sessions.copySheet.title} onClose={() => setSheet(null)}>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setSheet(null)} className={secondaryButtonClass}>
            {strings.common.cancel}
          </button>
          <button type="button" disabled={busy} onClick={() => void copyNow()} className={dangerButtonClass}>
            {strings.common.confirm}
          </button>
        </div>
      </BottomSheet>

      {error && (
        <ToastBar key={error.id}>
          <span>{error.text}</span>
        </ToastBar>
      )}
    </>,
  )
}
