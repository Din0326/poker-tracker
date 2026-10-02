import { ChevronRight, FileCode, FileText, Pencil, Share, Trash } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { BottomSheet } from '../../components/BottomSheet'
import { Page } from '../../components/Page'
import { dangerButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { formatTimestamp } from '../../domain'
import { DEFAULT_HERO_NAME, exportPokerStars, formatHandAmount, isExportable, positionText, type Hand } from '../../domain/hands'
import { useAppData } from '../../lib/appData'
import { hideGlobalToast, showGlobalToast } from '../../lib/globalToast'
import { strings } from '../../strings'
import { buildLookup, rowDate, sessionTitle } from '../sessions/sessionView'
import { CardList } from './CardFace'
import { HandExportSheet } from './HandExportSheet'
import { HandExportTextSheet } from './HandExportTextSheet'
import { exportRequestFor } from './handExportModel'
import { buildHandDetailView, handHeadlineResult, handSummaryText, playedAtText, type HandDetailView } from './handDetailView'
import { handResultText, handRowBadges, signedTextClass } from './handListModel'
import { HANDS_PATH, handCompletePath, handEditPath } from './handPaths'
import { removeCachedHand, upsertCachedHand } from './handsStore'

const t = strings.hands
const d = t.detail
const UNDO_TOAST_MS = 5000
const ERROR_TOAST_MS = 5000

/** heroName：Settings.handHeroName（未設定時為 Hero），供「查看匯出文字」使用（7.3） */
type Loaded = { hand: Hand; sessionLabel: string | null; heroName: string }
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'notFound' } | { status: 'ready'; data: Loaded }

const cardClass = 'rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)'
const sectionTitleClass = 'px-1 pb-2 text-sm text-(--color-text-muted)'

function Section({ id, title, children, testId }: { id: string; title: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section aria-labelledby={id} className="mt-4" data-testid={testId}>
      <h2 id={id} className={sectionTitleClass}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3" data-testid={testId}>
      <dt className="shrink-0 text-sm text-(--color-text-muted)">{label}</dt>
      <dd className="num min-w-0 text-right break-words">{children}</dd>
    </div>
  )
}

/** 6.2「座位」區與逐街區塊 */
function StreetSections({ view, hand }: { view: HandDetailView; hand: Hand }) {
  return (
    <>
      <Section id="hand-detail-seats" title={d.seatsSection} testId="detail-seats">
        <ul className={`divide-y divide-(--color-border) ${cardClass}`}>
          {view.seats.map((s) => (
            <li key={s.seatNo} data-testid="detail-seat" className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="num block">
                  {t.list.join(s.label, s.position)}
                  {s.isHero && (
                    <span data-testid="seat-hero" className="ml-2 rounded-full border border-(--color-border) px-1.5 text-xs text-(--color-text-muted)">
                      {d.you}
                    </span>
                  )}
                </span>
                {s.cards.length > 0 && <CardList cards={s.cards} className="text-sm" />}
              </span>
              <span data-testid="seat-stack" className="num shrink-0 text-right text-sm">
                {s.stack}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {view.streets.map((st) => (
        <section key={st.street} aria-labelledby={`hand-detail-${st.street}`} className="mt-4" data-testid={`detail-street-${st.street}`}>
          <h2 id={`hand-detail-${st.street}`} data-testid="street-title" className={`flex flex-wrap items-baseline gap-x-1.5 ${sectionTitleClass}`}>
            <span className="font-semibold text-(--color-text)">{st.name}</span>
            {st.cards.length > 0 && <CardList cards={st.cards} />}
            {st.pot !== null && <span className="num">· {st.pot}</span>}
            {st.runout && <span>{t.runoutNote}</span>}
          </h2>
          {st.lines.length > 0 && (
            <ol className={`num space-y-1 px-4 py-3 text-sm ${cardClass}`}>
              {st.lines.map((line, i) => (
                <li key={i} data-testid="street-line">
                  {line}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      {view.unfinished && (
        <div className="mt-4 flex flex-col items-stretch gap-3 text-center">
          <p data-testid="detail-unfinished" className="text-sm text-(--color-text-muted)">
            {d.unfinished}
          </p>
          {hand.source === 'manual' && (
            <Link to={handEditPath(hand.id)} className={`${secondaryButtonClass} w-full`}>
              {d.continue}
            </Link>
          )}
        </div>
      )}

      {view.result && (
        <Section id="hand-detail-result" title={d.resultSection} testId="detail-result-section">
          <div className={`num space-y-3 px-4 py-3 text-sm ${cardClass}`}>
            {view.result.showdown.length > 0 && (
              <div>
                <h3 className="text-(--color-text-muted)">{d.showdownTitle}</h3>
                <ul className="mt-1 space-y-1">
                  {view.result.showdown.map((s) => (
                    <li key={s.who} data-testid="result-showdown" className="flex flex-wrap items-baseline gap-x-2">
                      <span>{s.who}</span>
                      {s.cards.length > 0 && <CardList cards={s.cards} />}
                      <span>{s.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h3 className="text-(--color-text-muted)">{d.potsTitle}</h3>
              <ul className="mt-1 space-y-1">
                {view.result.pots.map((p, i) => (
                  <li key={i} data-testid="result-pot">
                    {p.line}
                  </li>
                ))}
                {view.result.rake !== null && <li data-testid="result-rake">{view.result.rake}</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-(--color-text-muted)">{d.netTitle}</h3>
              <ul className="mt-1 space-y-0.5">
                {view.result.nets.map((n) => (
                  <li key={n.who} data-testid="result-net" className="flex justify-between gap-2">
                    <span>{n.who}</span>
                    <span className={signedTextClass(n.text)}>{n.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      )}
    </>
  )
}

/** 簡易備忘手牌：依序顯示位置、手牌、公牌、大盲、結果，沒有值的欄位不顯示（6.2） */
function MemoSection({ hand }: { hand: Hand }) {
  const result = handResultText(hand)
  const rows: ReactNode[] = []
  if (hand.heroPosition !== null) rows.push(<Row key="pos" label={d.position} testId="memo-position">{positionText(hand.heroPosition)}</Row>)
  if (hand.heroCards.length > 0) rows.push(<Row key="cards" label={d.heroCards} testId="memo-cards"><CardList cards={hand.heroCards} /></Row>)
  if (hand.board.length > 0) rows.push(<Row key="board" label={d.board} testId="memo-board"><CardList cards={hand.board} /></Row>)
  if (hand.bb !== null) rows.push(<Row key="bb" label={d.bb} testId="memo-bb">{formatHandAmount(hand.bb, hand.amountUnit)}</Row>)
  if (hand.heroNet !== null) rows.push(<Row key="result" label={d.result} testId="memo-result"><span className={signedTextClass(result)}>{result}</span></Row>)
  if (rows.length === 0) return null
  return (
    <Section id="hand-detail-memo" title={d.memoSection} testId="detail-memo">
      <dl className={`divide-y divide-(--color-border) overflow-hidden ${cardClass}`}>{rows}</dl>
    </Section>
  )
}

/** 路由元件：以 id 作為 key，直接改網址切換到另一手時重新載入（不先顯示上一手的內容） */
export function HandDetailPage() {
  const { id = '' } = useParams()
  return <HandDetail key={id} id={id} />
}

// 手牌詳情（SPEC-v2-hands 6.2）與刪除（6.4）。#/hands/:id，「手牌」頁籤的推入式子頁（5.1）
function HandDetail({ id }: { id: string }) {
  const { repos } = useAppData()
  const navigate = useNavigate()
  const location = useLocation()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  // 7.1「匯出這手」、6.2「查看匯出文字」
  const [exportOpen, setExportOpen] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  // 6.2「原始文字」（source 為 gg）
  const [rawOpen, setRawOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<Loaded | null> => {
      const [hand, savedHeroName] = await Promise.all([repos.hands.get(id), repos.settings.get('handHeroName')])
      if (!hand) return null
      const heroName = savedHeroName ?? DEFAULT_HERO_NAME
      if (hand.sessionId === null) return { hand, sessionLabel: null, heroName }
      const [session, venues, stakes] = await Promise.all([repos.sessions.get(hand.sessionId), repos.venues.list(), repos.stakes.list()])
      const sessionLabel = session ? t.sessionOption(rowDate(session), sessionTitle(session, buildLookup(venues, stakes))) : null
      return { hand, sessionLabel, heroName }
    }
    load().then(
      (data) => !cancelled && setState(data ? { status: 'ready', data } : { status: 'notFound' }),
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, id, attempt])

  const page = (children: ReactNode) => (
    <Page title={strings.pages.handDetail} backTo={HANDS_PATH}>
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
        <button type="button" onClick={() => void navigate(HANDS_PATH)} className={secondaryButtonClass}>
          {strings.sessions.detail.backToList}
        </button>
      </div>,
    )
  }

  const { hand, sessionLabel, heroName } = state.data
  const exportable = isExportable(hand)
  const view = buildHandDetailView(hand)
  const headline = handHeadlineResult(hand)
  const badges = handRowBadges({ ...hand, hasDetail: hand.detail !== null })
  if (hand.source === 'gg') badges.push(t.list.badges.experimental)
  const isMemo = hand.detail === null

  // ---- 6.4 刪除：實體刪除 → 返回上一頁（列表或場次詳情）→ 5 秒復原提示 ----
  const confirmDelete = async () => {
    setBusy(true)
    try {
      const removed = await repos.hands.delete(hand.id)
      removeCachedHand(removed.id)
      setSheet(false)
      // 直接開啟網址（沒有上一頁）時回到手牌列表
      if (location.key !== 'default') void navigate(-1)
      else void navigate(HANDS_PATH, { replace: true })
      const toastId = showGlobalToast({
        text: strings.sessions.undo.deleted,
        durationMs: UNDO_TOAST_MS,
        action: {
          label: strings.sessions.undo.restore,
          onPress: () => {
            hideGlobalToast(toastId)
            // 以原始 id、exportSeq、createdAt、updatedAt 及所有欄位原封不動寫回；關聯場次已刪除時 sessionId 改為 null
            repos.hands.restore(removed).then(
              (h) => upsertCachedHand(h),
              () => showGlobalToast({ text: strings.sessions.undo.restoreFailed, durationMs: ERROR_TOAST_MS }),
            )
          },
        },
      })
    } catch {
      setBusy(false)
      setSheet(false)
      showGlobalToast({ text: t.deleteSheet.failed, durationMs: ERROR_TOAST_MS })
    }
  }

  const actionClass = `${secondaryButtonClass} w-full gap-2`
  const result = handResultText(hand)

  return page(
    <>
      {/* 頂部：Hero 手牌（大牌面）、結果（大字）、牌局摘要、小標籤 */}
      <div className={`mt-2 px-4 py-5 text-center ${cardClass}`}>
        <p data-testid="detail-hero-cards" className="text-4xl">
          {hand.heroCards.length > 0 ? <CardList cards={hand.heroCards} className="gap-x-3" /> : <span className="text-(--color-text-muted)">{strings.format.empty}</span>}
        </p>
        <p data-testid="detail-result" className={`num mt-3 text-3xl font-bold ${signedTextClass(headline.main)}`}>
          {headline.main}
        </p>
        {headline.secondary !== null && (
          <p data-testid="detail-result-amount" className={`num mt-1 text-sm ${signedTextClass(headline.secondary)}`}>
            {headline.secondary}
          </p>
        )}
        <p data-testid="detail-summary" className="num mt-2 text-sm text-(--color-text-muted)">
          {handSummaryText(hand)}
        </p>
        {badges.length > 0 && (
          <p className="mt-2 flex flex-wrap justify-center gap-1.5">
            {badges.map((b) => (
              <span key={b} data-testid="detail-badge" className="rounded-full border border-(--color-border) px-2 text-xs leading-5 text-(--color-text-muted)">
                {b}
              </span>
            ))}
          </p>
        )}
      </div>

      <dl className={`mt-4 divide-y divide-(--color-border) overflow-hidden ${cardClass}`}>
        {!isMemo && hand.heroPosition !== null && (
          <Row label={d.position} testId="detail-position">
            {positionText(hand.heroPosition)}
          </Row>
        )}
        <Row label={d.time} testId="detail-time">
          {playedAtText(hand)}
        </Row>
        {hand.sessionId !== null && sessionLabel !== null ? (
          <div className="flex items-center justify-between gap-4 px-4" data-testid="detail-session">
            <dt className="shrink-0 text-sm text-(--color-text-muted)">{d.session}</dt>
            <dd className="min-w-0">
              <Link
                to={`/sessions/${encodeURIComponent(hand.sessionId)}`}
                aria-label={d.openSession(sessionLabel)}
                className="num flex min-h-12 items-center justify-end gap-1 text-right font-semibold text-(--color-accent)"
              >
                <span className="truncate">{sessionLabel}</span>
                <ChevronRight aria-hidden="true" size={18} className="shrink-0" />
              </Link>
            </dd>
          </div>
        ) : (
          <Row label={d.session} testId="detail-session">
            {d.standalone}
          </Row>
        )}
      </dl>

      {isMemo ? <MemoSection hand={hand} /> : view && <StreetSections view={view} hand={hand} />}

      {hand.tags.length > 0 && (
        <Section id="hand-detail-tags" title={d.tagsSection} testId="detail-tags">
          <ul className="flex flex-wrap gap-2">
            {hand.tags.map((tag) => (
              <li key={tag} data-testid="detail-tag" className="max-w-full truncate rounded-full border border-(--color-border) bg-(--color-surface) px-3 py-1 text-sm">
                {tag}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hand.note !== null && (
        <Section id="hand-detail-note" title={d.noteSection}>
          <p data-testid="detail-note" className={`px-4 py-3 break-words whitespace-pre-wrap ${cardClass}`}>
            {hand.note}
          </p>
        </Section>
      )}

      <div className="mt-6 grid gap-3">
        <Link to={handEditPath(hand.id)} className={actionClass}>
          <Pencil aria-hidden="true" size={18} />
          {d.edit}
        </Link>
        {/* 5.8 補齊為完整手牌：簡易備忘手牌（手動紀錄）；未完成的手牌以上方「繼續補齊」進入 */}
        {isMemo && hand.source === 'manual' && (
          <Link to={handCompletePath(hand.id)} className={actionClass}>
            {t.completeFromSimple}
          </Link>
        )}
        {/* 6.2：匯出這手、查看匯出文字只在完整手牌顯示（7.1） */}
        {exportable && (
          <button type="button" onClick={() => setExportOpen(true)} className={actionClass}>
            <Share aria-hidden="true" size={18} />
            {t.export.exportThis}
          </button>
        )}
        {exportable && (
          <button type="button" onClick={() => setTextOpen(true)} className={actionClass}>
            <FileText aria-hidden="true" size={18} />
            {t.export.viewText}
          </button>
        )}
        {/* 6.2：原始文字只在 source 為 gg 時顯示（rawText，等寬字型、「複製」按鈕） */}
        {hand.source === 'gg' && hand.rawText !== null && (
          <button type="button" onClick={() => setRawOpen(true)} className={actionClass}>
            <FileCode aria-hidden="true" size={18} />
            {t.ggImport.rawText}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setSheet(true)} className={`${dangerButtonClass} w-full gap-2`}>
          <Trash aria-hidden="true" size={18} />
          {d.delete}
        </button>
      </div>

      <p className="num mt-6 text-center text-xs text-(--color-text-muted)" data-testid="detail-timestamps">
        {hand.sourceHandId !== null && (
          <span className="block" data-testid="detail-source-hand-id">
            {d.sourceHandId(hand.sourceHandId)}
          </span>
        )}
        <span className="block">{strings.sessions.detail.createdAt(formatTimestamp(hand.createdAt))}</span>
        <span className="block">{strings.sessions.detail.updatedAt(formatTimestamp(hand.updatedAt))}</span>
      </p>

      {exportOpen && <HandExportSheet request={exportRequestFor([hand], true)} onClose={() => setExportOpen(false)} />}
      {textOpen && <HandExportTextSheet text={exportPokerStars([hand], heroName)} onClose={() => setTextOpen(false)} />}
      {rawOpen && hand.rawText !== null && (
        <HandExportTextSheet
          text={hand.rawText}
          title={t.ggImport.rawText}
          label={t.ggImport.rawTextLabel}
          testId="raw-text"
          onClose={() => setRawOpen(false)}
        />
      )}

      {/* 6.4 刪除確認：時間、Hero 手牌、位置、結果 */}
      <BottomSheet open={sheet} title={t.deleteSheet.title} onClose={() => setSheet(false)}>
        <div className={`px-4 py-3 ${cardClass} bg-(--color-surface-raised)`} data-testid="hand-delete-summary">
          <p className="num text-sm text-(--color-text-muted)">{playedAtText(hand)}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
            {hand.heroCards.length > 0 ? <CardList cards={hand.heroCards} /> : <span className="text-(--color-text-muted)">{strings.format.empty}</span>}
            {hand.heroPosition !== null && <span>{positionText(hand.heroPosition)}</span>}
            <span className={`num font-semibold ${signedTextClass(result)}`}>{result}</span>
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setSheet(false)} className={secondaryButtonClass}>
            {strings.common.cancel}
          </button>
          <button type="button" disabled={busy} onClick={() => void confirmDelete()} className={dangerButtonClass}>
            {t.deleteSheet.confirm}
          </button>
        </div>
      </BottomSheet>
    </>,
  )
}
