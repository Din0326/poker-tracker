import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Page } from '../../components/Page'
import { strings } from '../../strings'

const links = [
  { to: '/settings/venues', label: strings.pages.venues },
  { to: '/settings/stakes', label: strings.pages.stakes },
]

// 設定（第 8 節，P5 實作完整內容）；P0 先放兩個管理頁入口
export function SettingsPage() {
  return (
    <Page title={strings.pages.settings}>
      <section aria-labelledby="settings-lists" className="mt-2">
        <h2 id="settings-lists" className="px-1 pb-2 text-sm text-(--color-text-muted)">
          {strings.settings.listsSection}
        </h2>
        <ul className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)">
          {links.map(({ to, label }) => (
            <li key={to} className="border-b border-(--color-border) last:border-b-0">
              <Link to={to} className="flex min-h-12 items-center justify-between px-4">
                <span>{label}</span>
                <ChevronRight aria-hidden="true" size={20} className="text-(--color-text-muted)" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}
