import { memo, useEffect, useRef, useState } from 'react'
import { strings } from '../../strings'
import { HandRow } from './HandRow'
import { useHandRowNavigation } from './handHooks'
import type { HandListItem, HandMonthGroup } from './handListModel'

const t = strings.hands.list

type GroupProps = { group: HandMonthGroup<HandListItem>; limit: number; hrefBase: string }

// 月份分組：標題列「2026 年 9 月 · 42 手」捲動時黏在頁首下方；手數是整個月（符合篩選）的數量，不受分批載入影響
const MonthSection = memo(function MonthSection({ group, limit, hrefBase }: GroupProps) {
  const headingId = `hand-month-${group.key}`
  const visible = limit === group.hands.length ? group.hands : group.hands.slice(0, limit)
  return (
    <section aria-labelledby={headingId} data-testid="hand-month-group" data-month={group.key}>
      <h2
        id={headingId}
        data-testid="hand-month-header"
        className="num sticky top-[calc(var(--header-height)+env(safe-area-inset-top))] z-[5] bg-(--color-bg) px-1 py-2 text-sm font-semibold text-(--color-text-muted)"
      >
        {t.monthHeader(group.year, group.month, group.hands.length)}
      </h2>
      <ul className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)">
        {visible.map((h) => (
          <HandRow key={h.id} hand={h} hrefBase={hrefBase} />
        ))}
      </ul>
    </section>
  )
})

/** 一批的 100 筆分幾個 frame 逐步加入畫面，每個 frame 的版面計算不會過長 */
const RENDER_CHUNK = 20

type Props = {
  groups: HandMonthGroup<HandListItem>[]
  /** 已載入的筆數（分批載入，每批 100 筆） */
  visibleCount: number
  total: number
  onLoadMore: () => void
}

// 6.1 列表：依月份分組，分批載入（每批 100 筆，同 v1 7.1），接近底部時以 IntersectionObserver 載入下一批。
// 載入的一批以每 frame 20 筆逐步加入 DOM；初次渲染（含從詳情返回）則一次渲染已載入的筆數，捲動位置才能還原
export function HandList({ groups, visibleCount, total, onLoadMore }: Props) {
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
  const { hrefBase, onClick } = useHandRowNavigation()
  // 這一批全部加入畫面後才觀察下一批
  const hasMore = visibleCount < total
  const canLoadMore = hasMore && renderedCount >= visibleCount
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  })

  // 每次渲染筆數改變後重新 observe：observe 會立即回報一次目前狀態，哨兵仍在可視範圍附近時會繼續載入下一批
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
    const limit = Math.min(remaining, group.hands.length)
    sections.push(<MonthSection key={group.key} group={group} limit={limit} hrefBase={hrefBase} />)
    remaining -= group.hands.length
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
