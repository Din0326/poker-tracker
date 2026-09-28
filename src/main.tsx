import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requestPersistentStorage } from './lib/platform'
import './styles/index.css'

void requestPersistentStorage()

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
