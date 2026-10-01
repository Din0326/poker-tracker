import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DbGate } from './components/DbGate'
import { defaultAppData } from './lib/appData'
import { requestPersistentStorage } from './lib/platform'
import { applyStoredProfitScheme } from './lib/profitScheme'
import './styles/index.css'

void requestPersistentStorage()
void applyStoredProfitScheme(defaultAppData.repos)

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    {/* 3.7：資料庫開啟（含遷移）成功後才渲染 App；失敗時只顯示錯誤狀態 */}
    <DbGate db={defaultAppData.db}>
      <App />
    </DbGate>
  </StrictMode>,
)
