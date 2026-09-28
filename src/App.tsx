import { Navigate, Outlet, RouterProvider, createHashRouter, type RouteObject } from 'react-router'
import { GlobalToast } from './components/GlobalToast'
import { TabBar } from './components/TabBar'
import { UpdatePrompt } from './components/UpdatePrompt'
import { RecordPage } from './features/record/RecordPage'
import { ReportPage } from './features/report/ReportPage'
import { SessionDetailPage } from './features/sessions/SessionDetailPage'
import { SessionEditPage } from './features/sessions/SessionEditPage'
import { SessionsPage } from './features/sessions/SessionsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StakesPage } from './features/settings/StakesPage'
import { VenuesPage } from './features/settings/VenuesPage'
import { useScrollMemory } from './lib/useScrollMemory'
import { useKeyboardInset } from './lib/viewport'

function AppLayout() {
  useScrollMemory()
  useKeyboardInset()
  // overflow-x-clip：子頁推入動效（translateX）期間不產生橫向捲動；clip 不建立捲動容器，sticky 標題列不受影響
  return (
    <>
      <div className="mx-auto min-h-dvh overflow-x-clip max-w-(--page-max-width) pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pb-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom)+var(--record-bar-offset)+var(--keyboard-inset)+16px)]">
        <Outlet />
      </div>
      <UpdatePrompt />
      <GlobalToast />
      <TabBar />
    </>
  )
}

// 路由表；網址格式（hash 路徑）與 P0 相同
const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <RecordPage /> },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'sessions/:id', element: <SessionDetailPage /> },
      { path: 'sessions/:id/edit', element: <SessionEditPage /> },
      { path: 'report', element: <ReportPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/venues', element: <VenuesPage /> },
      { path: 'settings/stakes', element: <StakesPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

// data router（createHashRouter）：編輯頁有未儲存變更時以 useBlocker 攔截所有 App 內離開（Q1）
const router = createHashRouter(routes)

export function App() {
  return <RouterProvider router={router} />
}
