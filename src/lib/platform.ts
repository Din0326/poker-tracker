// 執行環境偵測（第 2 節資料儲存注意事項）

export type RunMode = 'standalone' | 'browser'

// iOS 主畫面 App 與 Safari 分頁的儲存空間分開，需讓使用者知道目前在哪一種模式
export function getRunMode(): RunMode {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  const displayStandalone = window.matchMedia('(display-mode: standalone)').matches
  return iosStandalone || displayStandalone ? 'standalone' : 'browser'
}

let persistPromise: Promise<boolean> | null = null

// App 啟動時申請持久儲存；結果於 P5 顯示在設定頁
export function requestPersistentStorage(): Promise<boolean> {
  persistPromise ??= (async () => {
    try {
      if (!navigator.storage?.persist) return false
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    } catch {
      return false
    }
  })()
  return persistPromise
}
