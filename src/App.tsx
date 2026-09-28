import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router'
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

function AppLayout() {
  useScrollMemory()
  return (
    <>
      <div className="mx-auto min-h-dvh max-w-(--page-max-width) pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pb-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom)+16px)]">
        <Outlet />
      </div>
      <UpdatePrompt />
      <TabBar />
    </>
  )
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<RecordPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
          <Route path="sessions/:id/edit" element={<SessionEditPage />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/venues" element={<VenuesPage />} />
          <Route path="settings/stakes" element={<StakesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
