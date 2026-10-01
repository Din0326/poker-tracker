import { Link, useNavigate } from 'react-router'
import { secondaryButtonClass } from '../../components/controlStyles'
import { strings } from '../../strings'
import { HandRow } from './HandRow'
import { useHandRowNavigation } from './handHooks'
import type { HandListItem } from './handListModel'
import { handNewPath, handsListPath } from './handPaths'

const t = strings.hands.sessionSection
/** 6.3：列出該場最新的 5 手 */
const SESSION_HANDS_LIMIT = 5

// 6.3 場次詳情的「手牌」區塊（v1 7.2 在「備註」之後）：標題「手牌（3）」、最新 5 手（列格式同 6.1）、
// 超過 5 手時「查看全部 12 手」、「＋ 新增手牌」。場次本身的數字不受手牌影響（4.13）
export function SessionHandsSection({ sessionId, hands }: { sessionId: string; hands: HandListItem[] | null }) {
  const { hrefBase, onClick } = useHandRowNavigation()
  const navigate = useNavigate()
  const count = hands?.length ?? 0
  return (
    <section aria-labelledby="session-hands-title" className="mt-4" data-testid="session-hands">
      <h2 id="session-hands-title" className="num px-1 pb-2 text-sm text-(--color-text-muted)">
        {t.title(count)}
      </h2>
      {hands === null ? (
        <p role="status" className="py-4 text-center text-sm text-(--color-text-muted)">
          {strings.common.loading}
        </p>
      ) : hands.length === 0 ? (
        <p data-testid="session-hands-empty" className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) px-4 py-3 text-(--color-text-muted)">
          {t.empty}
        </p>
      ) : (
        <ul onClick={onClick} className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)">
          {hands.slice(0, SESSION_HANDS_LIMIT).map((h) => (
            <HandRow key={h.id} hand={h} hrefBase={hrefBase} />
          ))}
        </ul>
      )}
      {count > SESSION_HANDS_LIMIT && (
        <Link to={handsListPath(sessionId)} className={`${secondaryButtonClass} mt-2 w-full`}>
          {t.viewAll(count)}
        </Link>
      )}
      <button type="button" onClick={() => void navigate(handNewPath(sessionId))} className={`${secondaryButtonClass} mt-2 w-full`}>
        {strings.hands.addHand}
      </button>
    </section>
  )
}
