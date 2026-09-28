import { ChartColumn, CirclePlus, List, Settings, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router'
import { strings } from '../strings'

type Tab = { to: string; label: string; icon: LucideIcon; end?: boolean }

const tabs: Tab[] = [
  { to: '/', label: strings.tabs.record, icon: CirclePlus, end: true },
  { to: '/sessions', label: strings.tabs.sessions, icon: List },
  { to: '/report', label: strings.tabs.report, icon: ChartColumn },
  { to: '/settings', label: strings.tabs.settings, icon: Settings },
]

// 底部固定分頁列（9.1），子頁中仍顯示
export function TabBar() {
  return (
    <nav
      aria-label={strings.tabs.navLabel}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-(--page-max-width) px-[env(safe-area-inset-left)]">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              {...(end ? { end } : {})}
              className={({ isActive }) =>
                `flex h-(--tab-bar-height) min-w-(--touch-min) flex-col items-center justify-center gap-0.5 text-xs ${
                  isActive ? 'font-semibold text-(--color-accent)' : 'text-(--color-text-muted)'
                }`
              }
            >
              <Icon aria-hidden="true" size={24} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
