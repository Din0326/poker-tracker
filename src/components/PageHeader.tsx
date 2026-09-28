import { ChevronLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { strings } from '../strings'

type Props = {
  title: string
  // 子頁才傳：返回的上一層路徑；直接開啟子頁網址（沒有上一頁）時使用
  backTo?: string
}

// 頁面標題列；頂端以 safe-area 避開瀏海（9.2）
export function PageHeader({ title, backTo }: Props) {
  const navigate = useNavigate()
  const location = useLocation()

  const goBack = () => {
    // location.key 為 'default' 代表這是進入 App 的第一頁，沒有歷史可退
    if (location.key !== 'default') navigate(-1)
    else if (backTo) navigate(backTo, { replace: true })
  }

  return (
    <header className="sticky top-0 z-10 bg-(--color-bg) pt-[env(safe-area-inset-top)]">
      <div className="relative flex h-(--header-height) items-center justify-center px-12">
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
        <h1 className="truncate text-lg font-semibold">{title}</h1>
      </div>
    </header>
  )
}
