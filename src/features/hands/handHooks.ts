// 手牌列表與場次詳情手牌區塊共用的 hooks
import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { useHref, useNavigate } from 'react-router'
import { useAppData } from '../../lib/appData'
import { sortHandsNewestFirst, toHandListItem, type HandListItem } from './handListModel'
import { HANDS_PATH, handDetailPath } from './handPaths'
import { useHandsVersion } from './handsStore'

/**
 * 列為一般 <a href>（不用 <Link>，10,000 手時每列少掉 router hook 的成本），點擊由容器統一交給 router 導覽。
 * 回傳每列 href 的前綴與容器的 onClick。
 */
export function useHandRowNavigation(): { hrefBase: string; onClick: (e: MouseEvent<HTMLElement>) => void } {
  const navigate = useNavigate()
  const hrefBase = useHref(`${HANDS_PATH}/`)
  const onClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as Element).closest<HTMLAnchorElement>('a[data-hand-id]')
      const id = link?.dataset.handId
      if (!id) return
      e.preventDefault()
      void navigate(handDetailPath(id))
    },
    [navigate],
  )
  return { hrefBase, onClick }
}

/**
 * 某場次底下的手牌（以 sessionId 索引查詢，依 6.1 排序）；讀取中為 null、讀取失敗為 []。
 * 手牌資料改變時（新增、編輯、刪除、復原、刪除場次轉為獨立）重新查詢。
 */
export function useSessionHands(sessionId: string): HandListItem[] | null {
  const { repos } = useAppData()
  const version = useHandsVersion()
  const [state, setState] = useState<{ key: string; hands: HandListItem[] } | null>(null)
  const key = `${sessionId}|${version}`
  useEffect(() => {
    let cancelled = false
    repos.hands.listBySession(sessionId).then(
      (hands) => !cancelled && setState({ key, hands: sortHandsNewestFirst(hands.map(toHandListItem)) }),
      () => !cancelled && setState({ key, hands: [] }),
    )
    return () => {
      cancelled = true
    }
  }, [repos, sessionId, key])
  // 重新查詢期間沿用上一次的結果，避免區塊閃爍
  return state === null ? null : state.hands
}
