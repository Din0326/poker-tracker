import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DbGate } from './components/DbGate'
import { defaultAppData } from './lib/appData'
import { requestPersistentStorage } from './lib/platform'
import { applyStoredProfitScheme } from './lib/profitScheme'
import './styles/index.css'

void requestPersistentStorage()

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

// 3.7「升級前的備份提示」第 7 步：啟動時任何會開啟 Dexie 的讀取（套用盈虧顏色，8.3）都等資料庫開啟之後才執行，
// 否則 Dexie 會在提示出現前就執行升級
const onDbReady = () => applyStoredProfitScheme(defaultAppData.repos)

createRoot(root).render(
  <StrictMode>
    {/* 3.7：資料庫開啟（含遷移）成功後才渲染 App；舊版且有資料時先顯示升級前的備份提示；失敗時只顯示錯誤狀態 */}
    <DbGate db={defaultAppData.db} onReady={onDbReady}>
      <App />
    </DbGate>
  </StrictMode>,
)
