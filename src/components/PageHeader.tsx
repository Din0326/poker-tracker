import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useGoBack } from '../lib/useGoBack'
import { strings } from '../strings'

type Props = {
  title: string
  // 子頁才傳：返回的上一層路徑；直接開啟子頁網址（沒有上一頁）時使用
  backTo?: string
  // 右上角操作（例：新增頁的「清除」）
  action?: ReactNode
  // 標題旁的小標籤（例：匯入 GG 手牌的「實驗功能」，SPEC-v2-hands 8.2）；不屬於標題文字
  badge?: ReactNode
  // inline：返回鈕、標題（靠左）、右上角操作排成一列，操作較寬時標題自動縮短，不會與操作重疊
  // （手牌列表右上角有三個操作，SPEC-v2-hands 6.1）；預設 centered：標題置中
  layout?: 'centered' | 'inline'
}

// 頁面標題列；頂端以 safe-area 避開瀏海（9.2）
export function PageHeader({ title, backTo, action, badge, layout = 'centered' }: Props) {
  // location.key 為 'default' 代表這是進入 App 的第一頁，沒有歷史可退（見 useGoBack）
  const goBack = useGoBack(backTo)

  if (layout === 'inline') {
    return (
      <header className="sticky top-0 z-10 bg-(--color-bg) pt-[env(safe-area-inset-top)]">
        <div className={`flex h-(--header-height) items-center gap-1 pr-1 ${backTo !== undefined ? 'pl-1' : 'pl-4'}`}>
          {backTo !== undefined && (
            <button
              type="button"
              onClick={goBack}
              aria-label={strings.common.back}
              className="flex size-(--touch-min) shrink-0 items-center justify-center rounded-(--radius-control) text-(--color-accent)"
            >
              <ChevronLeft aria-hidden="true" size={28} />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {badge}
          {action !== undefined && action !== null && <div className="shrink-0">{action}</div>}
        </div>
      </header>
    )
  }

  return (
    <header className="sticky top-0 z-10 bg-(--color-bg) pt-[env(safe-area-inset-top)]">
      <div className="relative flex h-(--header-height) items-center justify-center px-16">
        {backTo !== undefined && (
          <button
            type="button"
            onClick={goBack}
            aria-label={strings.common.back}
            className="absolute left-1 top-1/2 flex size-(--touch-min) -translate-y-1/2 items-center justify-center rounded-(--radius-control) text-(--color-accent)"
          >
            <ChevronLeft aria-hidden="true" size={28} />
          </button>
        )}
        {badge !== undefined && badge !== null ? (
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {badge}
          </div>
        ) : (
          <h1 className="truncate text-lg font-semibold">{title}</h1>
        )}
        {action !== undefined && action !== null && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2">{action}</div>
        )}
      </div>
    </header>
  )
}
