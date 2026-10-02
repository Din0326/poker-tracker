import { ChevronRight } from 'lucide-react'
import { memo } from 'react'
import { strings } from '../../strings'
import { CardList } from './CardFace'
import {
  handResultText,
  handRowBadges,
  handRowTags,
  handRowTime,
  handRowTitle,
  signedTextClass,
  type HandListItem,
} from './handListModel'

const t = strings.hands.list
const badgeClass = 'shrink-0 rounded-full border border-(--color-border) px-1.5 text-xs leading-5 text-(--color-text-muted)'
const tagClass = 'min-w-0 truncate rounded-full bg-(--color-surface-raised) px-1.5 text-xs leading-5 text-(--color-text-muted)'

/**
 * 6.1 單列（左到右）：Hero 手牌、中間兩行（位置 + 盲注與小標籤；時間與前 2 個標籤）、結果、箭頭。
 * 標題過長時省略文字，小標籤不省略（shrink-0）。列高固定 64px（h-16），與 contain-intrinsic-size 一致，
 * 畫面外的列不做版面計算（content-visibility: auto），返回列表時捲動位置才還原得準。
 */
export const HandRow = memo(function HandRow({ hand, hrefBase }: { hand: HandListItem; hrefBase: string }) {
  const badges = handRowBadges(hand)
  const tags = handRowTags(hand)
  const result = handResultText(hand)
  return (
    <li className="border-b border-(--color-border) [content-visibility:auto] [contain-intrinsic-size:auto_64px] last:border-b-0">
      <a
        href={`${hrefBase}${encodeURIComponent(hand.id)}`}
        data-testid="hand-row"
        data-hand-id={hand.id}
        className="flex h-16 items-center gap-3 px-3"
      >
        <span data-testid="row-cards" className="w-15 shrink-0 text-sm whitespace-nowrap">
          {hand.heroCards.length > 0 ? (
            <CardList cards={hand.heroCards} />
          ) : (
            <>
              <span aria-hidden="true" className="text-(--color-text-muted)">
                {strings.format.empty}
              </span>
              <span className="sr-only">{t.noHeroCards}</span>
            </>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span data-testid="row-title" className="num truncate">
              {handRowTitle(hand)}
            </span>
            {badges.map((b) => (
              <span key={b} data-testid="row-badge" className={badgeClass}>
                {b}
              </span>
            ))}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-(--color-text-muted)">
            <span data-testid="row-time" className="num shrink-0">
              {handRowTime(hand)}
            </span>
            {tags.shown.map((tag) => (
              <span key={tag} data-testid="row-tag" className={tagClass}>
                {tag}
              </span>
            ))}
            {tags.more > 0 && (
              <>
                <span aria-hidden="true" data-testid="row-more-tags" className="num shrink-0 text-xs">
                  {t.moreTags(tags.more)}
                </span>
                <span className="sr-only">{t.moreTagsLabel(tags.more)}</span>
              </>
            )}
          </span>
        </span>
        <span data-testid="row-result" className={`num shrink-0 font-semibold ${signedTextClass(result)}`}>
          {result}
        </span>
        <ChevronRight aria-hidden="true" size={18} className="-mr-1 shrink-0 text-(--color-text-muted)" />
      </a>
    </li>
  )
})
