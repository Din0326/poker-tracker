import { defineConfig, devices } from '@playwright/test'

// 10.1：WebKit + iPhone 14 viewport，模擬主要使用裝置
// 截圖只在 npm run screenshots 時執行
const screenshotsIgnore = process.env.SCREENSHOTS_DIR ? [] : ['**/screenshots.spec.ts']
// 效能量測（P3-3 列表、P4-5 報表、H2 手牌列表與詳情、H4 GG 匯入）另成一個 project，等其他測試跑完才執行，避免平行測試搶 CPU 影響數字
const perfSpec = ['**/sessions-perf.spec.ts', '**/report-perf.spec.ts', '**/hands-perf.spec.ts', '**/gg-import-perf.spec.ts']
// 需要寫入大量資料（≥ 1,000 筆）的測試加上 @heavy tag，移出平行的主 project，在主 project 之後以單一 worker 序列執行，
// 避免大量寫入與渲染造成 CPU 尖峰，讓同時執行的其他測試偶發逾時
const HEAVY_TAG = /@heavy/

// E2E 固定在 Asia/Taipei（主要使用者所在時區），任何機器（含 UTC 的 CI）結果一致：
// - 瀏覽器：use.timezoneId；App 以瀏覽器本地時間為準（規格行為），顯示的時間戳、預設開始時間等都依此
// - Node：測試程式也會以本地時間計算期望值或假時鐘（dayjs()、new Date(y, m, d, h)、page.clock），
//   必須與瀏覽器同一時區；設定 process.env.TZ 後 Node 立即套用，worker 與 webServer 子行程也會繼承
// 程式在不同時區的行為由 vitest 以多時區執行驗證（npm run test:tz），E2E 不負責這部分
const E2E_TIMEZONE = 'Asia/Taipei'
process.env.TZ = E2E_TIMEZONE

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 本機限制 worker 數：預設為 CPU 核心數的一半（24 核心機器約 24 個 worker），WebKit 同時開太多時 CPU 爭用嚴重，
  // 每次都有不同的測試在 click 等操作上 30 秒逾時（單獨重跑皆通過）。
  // 實測（24 核心，完整 npm run e2e，皆全數通過）：12 → 8.5m、8 → 8.6m、6 → 9.0m；
  // 總耗時主要由序列的 heavy / perf project（約 6.3m）決定，主 project 約 2.2m / 2.3m / 2.7m。
  // 取 8：耗時與 12 幾乎相同，但同時執行的瀏覽器少三分之一，爭用餘裕較大。CI 維持 Playwright 預設（2 核心 → 1 worker）。
  workers: process.env.CI ? undefined : 8,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    timezoneId: E2E_TIMEZONE,
  },
  projects: [
    {
      name: 'webkit-iphone14',
      use: { ...devices['iPhone 14'] },
      testIgnore: [...screenshotsIgnore, ...perfSpec],
      grepInvert: HEAVY_TAG,
    },
    {
      name: 'webkit-iphone14-heavy',
      use: { ...devices['iPhone 14'] },
      testIgnore: [...screenshotsIgnore, ...perfSpec],
      grep: HEAVY_TAG,
      fullyParallel: false,
      workers: 1,
      dependencies: ['webkit-iphone14'],
    },
    {
      name: 'webkit-iphone14-perf',
      use: { ...devices['iPhone 14'] },
      testMatch: perfSpec,
      // 排在 heavy 之後，避免兩者同時執行影響效能數字
      dependencies: ['webkit-iphone14-heavy'],
    },
  ],
  // 以正式建置測試，service worker 與 manifest 才與部署版本一致
  webServer: {
    command: 'npx vite build && npx vite preview',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
