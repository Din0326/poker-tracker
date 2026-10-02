import { Suspense, lazy } from 'react'
import { Navigate, Outlet, RouterProvider, createHashRouter, type RouteObject } from 'react-router'
import { Page } from './components/Page'
import { GlobalToast } from './components/GlobalToast'
import { TabBar } from './components/TabBar'
import { UpdatePrompt } from './components/UpdatePrompt'
import { HandDetailPage } from './features/hands/HandDetailPage'
import { HandsRoute } from './features/hands/HandsPage'
import { RecordPage } from './features/record/RecordPage'
import { SessionDetailPage } from './features/sessions/SessionDetailPage'
import { SessionEditPage } from './features/sessions/SessionEditPage'
import { SessionsPage } from './features/sessions/SessionsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StakesPage } from './features/settings/StakesPage'
import { VenuesPage } from './features/settings/VenuesPage'
import { useScrollMemory } from './lib/useScrollMemory'
import { useKeyboardInset } from './lib/viewport'
import { strings } from './strings'

// 報表頁（含 Recharts）拆成獨立 chunk，進入報表時才載入；PWA 預先快取包含此 chunk，離線照常可用
const ReportPage = lazy(() => import('./features/report/ReportPage').then((m) => ({ default: m.ReportPage })))

// v2 手牌的新增 / 編輯頁（SPEC-v2-hands 第 5 節）同樣拆成獨立 chunk，不增加首頁（新增場次）的載入量
const HandNewPage = lazy(() => import('./features/hands/HandNewPage').then((m) => ({ default: m.HandNewPage })))
const HandEditPage = lazy(() => import('./features/hands/HandEditPage').then((m) => ({ default: m.HandEditPage })))

function LoadingPage({ title, backTo }: { title: string; backTo?: string }) {
  return (
    <Page title={title} {...(backTo !== undefined ? { backTo } : {})}>
      <p role="status" className="py-10 text-center text-(--color-text-muted)">
        {strings.common.loading}
      </p>
    </Page>
  )
}

function ReportFallback() {
  return <LoadingPage title={strings.pages.report} />
}

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
      // v2 手牌（SPEC-v2-hands 5.1）：列表為「手牌」頁籤的根畫面，新增、詳情、編輯為推入式子頁；匯入頁於 H4 加入
      { path: 'hands', element: <HandsRoute /> },
      { path: 'hands/:id', element: <HandDetailPage /> },
      {
        path: 'hands/new',
        element: (
          <Suspense fallback={<LoadingPage title={strings.pages.handNew} backTo="/hands" />}>
            <HandNewPage />
          </Suspense>
        ),
      },
      {
        path: 'hands/:id/edit',
        element: (
          <Suspense fallback={<LoadingPage title={strings.pages.handEdit} backTo="/hands" />}>
            <HandEditPage />
          </Suspense>
        ),
      },
      {
        path: 'report',
        element: (
          <Suspense fallback={<ReportFallback />}>
            <ReportPage />
          </Suspense>
        ),
      },
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
