// 元件測試用的 virtual:pwa-register/react 替身（vitest.config.ts 以 alias 指向本檔）。
// 測試透過 pwaMock 控制 needRefresh 與觀察 updateServiceWorker 的呼叫。
import { useState } from 'react'

export const pwaMock: {
  needRefresh: boolean
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
} = {
  needRefresh: false,
  updateServiceWorker: async () => undefined,
}

export function useRegisterSW() {
  const needRefresh = useState(pwaMock.needRefresh)
  const offlineReady = useState(false)
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: (reloadPage?: boolean) => pwaMock.updateServiceWorker(reloadPage),
  }
}
