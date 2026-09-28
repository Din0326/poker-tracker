import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
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
    <App />
  </StrictMode>,
)
