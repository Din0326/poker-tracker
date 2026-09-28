import { ChevronRight } from 'lucide-react'
import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useHref, useNavigate } from 'react-router'
import { sessionTypeIcons } from '../../components/sessionTypeIcons'
import { formatSignedMoney, profit, type Session } from '../../domain'
import { strings } from '../../strings'
import { SESSIONS_PATH } from './listUrl'
import { entriesBadge, profitColorClass, rowDate, sessionTitle, type MonthGroup, type RefLookup } from './sessionView'

const t = strings.sessions

type RowProps = { session: Session; lookup: RefLookup; hrefBase: string }

// 單列（7.1）：類型圖示、日期、標題（錦標賽進場 ≥ 2 加 ×N）、盈利、箭頭
const SessionRow = memo(function SessionRow({ session, lookup, hrefBase }: RowProps) {
  const Icon = sessionTypeIcons[session.type]
  const p = profit(session)
  const badge = entriesBadge(session)
  return (
    // content-visibility: auto：畫面外的列不做版面計算與繪製，載入下一批時只需處理進入畫面的列。
    // 預估高度等於實際內容高度 56px（contain-intrinsic-size 不含分隔線 border），返回列表時捲動位置才還原得準
    <li className="border-b border-(--color-border) [content-visibility:auto] [contain-intrinsic-size:auto_56px] last:border-b-0">
      <a
        href={`${hrefBase}${encodeURIComponent(session.id)}`}
        data-testid="session-row"
        data-session-id={session.id}
        className="flex min-h-14 items-center gap-3 px-3 py-2"
      >
        <Icon aria-hidden="true" size={20} className="shrink-0 text-(--color-text-muted)" />
        <span className="sr-only">{strings.sessionTypes[session.type]}</span>
        <span data-testid="row-date" className="num shrink-0 text-sm text-(--color-text-muted)">
          {rowDate(session)}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span data-testid="row-title" className="truncate">
            {sessionTitle(session, lookup)}
          </span>
          {badge && (
            <>
              <span
                aria-hidden="true"
                data-testid="row-badge"
                className="num shrink-0 rounded-full border border-(--color-border) px-1.5 text-xs text-(--color-text-muted)"
              >
                {badge}
              </span>
              <span className="sr-only">{t.entriesBadgeLabel(session.buyIns.length)}</span>
            </>
          )}
        </span>
        <span data-testid="row-profit" className={`num shrink-0 font-semibold ${profitColorClass(p)}`}>
          {formatSignedMoney(p)}
        </span>
        <ChevronRight aria-hidden="true" size={18} className="-mr-1 shrink-0 text-(--color-text-muted)" />
      </a>
    </li>
  )
})

type GroupProps = { group: MonthGroup; limit: number; lookup: RefLookup; hrefBase: string }

// 月份分組：標題列捲動時黏在頁首下方；場次數與盈利是整個月（符合篩選）的彙總，不受分批載入影響
const MonthSection = memo(function MonthSection({ group, limit, lookup, hrefBase }: GroupProps) {
  const headingId = `month-${group.key}`
  const visible = limit === group.sessions.length ? group.sessions : group.sessions.slice(0, limit)
  return (
    <section
      aria-labelledby={headingId}
      data-testid="month-group"
      data-month={group.key}
    >
      <h2
        id={headingId}
        data-testid="month-header"
        className="num sticky top-[calc(var(--header-height)+env(safe-area-inset-top))] z-[5] bg-(--color-bg) px-1 py-2 text-sm font-semibold text-(--color-text-muted)"
      >
        {t.monthHeader(group.year, group.month, group.count, '')}
        <span className={profitColorClass(group.profit)}>{formatSignedMoney(group.profit)}</span>
      </h2>
      <ul className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)">
        {visible.map((s) => (
          <SessionRow key={s.id} session={s} lookup={lookup} hrefBase={hrefBase} />
        ))}
      </ul>
    </section>
  )
})

/** 一批的 100 筆分幾個 frame 逐步加入畫面，每個 frame 的版面計算不會過長 */
const RENDER_CHUNK = 20

type Props = {
  groups: MonthGroup[]
  lookup: RefLookup
  /** 已載入的筆數（分批載入，每批 100 筆） */
  visibleCount: number
  total: number
  onLoadMore: () => void
}

// 7.1 列表：依月份分組，分批載入（每批 100 筆），接近底部時以 IntersectionObserver 載入下一批。
// 載入的一批以每 frame 20 筆逐步加入 DOM；初次渲染（含從詳情返回）則一次渲染已載入的筆數，捲動位置才能還原
export function SessionList({ groups, lookup, visibleCount, total, onLoadMore }: Props) {
  const [rendered, setRendered] = useState(visibleCount)
  let renderedCount = rendered
  if (visibleCount < rendered) {
    // 篩選改變等造成筆數減少：立即套用
    renderedCount = visibleCount
    setRendered(visibleCount)
  }
  useEffect(() => {
    if (rendered >= visibleCount) return
    const id = requestAnimationFrame(() => setRendered((n) => Math.min(n + RENDER_CHUNK, visibleCount)))
    return () => cancelAnimationFrame(id)
  }, [rendered, visibleCount])

  const sentinelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  // 列為一般 <a href>（不用 <Link>，5,000 筆時每列少掉 router hook 的成本），點擊由容器統一交給 router 導覽
  const hrefBase = useHref(`${SESSIONS_PATH}/`)
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[data-session-id]')
    const id = link?.dataset.sessionId
    if (!id) return
    e.preventDefault()
    void navigate(`${SESSIONS_PATH}/${encodeURIComponent(id)}`)
  }
  // 這一批全部加入畫面後才觀察下一批
  const hasMore = visibleCount < total
  const canLoadMore = hasMore && renderedCount >= visibleCount
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  })

  // 每次渲染筆數改變後重新 observe：observe 會立即回報一次目前狀態，
  // 所以哨兵仍在可視範圍附近時會繼續載入下一批
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMoreRef.current()
      },
      { rootMargin: '0px 0px 800px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visibleCount, canLoadMore])

  let remaining = renderedCount
  const sections = []
  for (const group of groups) {
    if (remaining <= 0) break
    // 完整顯示的月份 limit 固定為該月筆數，載入下一批時 memo 不會失效
    const limit = Math.min(remaining, group.sessions.length)
    sections.push(
      <MonthSection key={group.key} group={group} limit={limit} lookup={lookup} hrefBase={hrefBase} />,
    )
    remaining -= group.sessions.length
  }

  return (
    <div className="mt-2 space-y-2" onClick={onClick}>
      {sections}
      {hasMore && (
        <div ref={sentinelRef} className="py-4 text-center text-sm text-(--color-text-muted)">
          {t.loadingMore}
        </div>
      )}
    </div>
  )
}
