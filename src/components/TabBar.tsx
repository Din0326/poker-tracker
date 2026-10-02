import { ChartColumn, CirclePlus, List, Settings, Spade, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router'
import { OBSCURES_BOTTOM_ATTR } from '../lib/viewport'
import { strings } from '../strings'

type Tab = { to: string; label: string; icon: LucideIcon; end?: boolean }

const tabs: Tab[] = [
  { to: '/', label: strings.tabs.record, icon: CirclePlus, end: true },
  { to: '/sessions', label: strings.tabs.sessions, icon: List },
  // SPEC-v2-hands 5.1：第五個頁籤「手牌」位於紀錄與報表之間；#/hands 開頭的路由（列表、新增、詳情、編輯）皆為作用中
  { to: '/hands', label: strings.tabs.hands, icon: Spade },
  { to: '/report', label: strings.tabs.report, icon: ChartColumn },
  { to: '/settings', label: strings.tabs.settings, icon: Settings },
]

// 底部固定分頁列（9.1；v2 起五個頁籤，SPEC-v2-hands 5.1），子頁中仍顯示。
// 五個頁籤平分寬度（flex-1）：375px 寬時每個約 75px，高度 --tab-bar-height，觸控區仍 ≥ 44×44px
export function TabBar() {
  return (
    <nav
      aria-label={strings.tabs.navLabel}
      {...{ [OBSCURES_BOTTOM_ATTR]: '' }}
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
