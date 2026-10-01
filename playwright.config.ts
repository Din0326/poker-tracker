import { defineConfig, devices } from '@playwright/test'

// 10.1：WebKit + iPhone 14 viewport，模擬主要使用裝置
// 截圖只在 npm run screenshots 時執行
const screenshotsIgnore = process.env.SCREENSHOTS_DIR ? [] : ['**/screenshots.spec.ts']
// 效能量測（P3-3 列表、P4-5 報表、H2 手牌列表與詳情）另成一個 project，等其他測試跑完才執行，避免平行測試搶 CPU 影響數字
const perfSpec = ['**/sessions-perf.spec.ts', '**/report-perf.spec.ts', '**/hands-perf.spec.ts']

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
    },
    {
      name: 'webkit-iphone14-perf',
      use: { ...devices['iPhone 14'] },
      testMatch: perfSpec,
      dependencies: ['webkit-iphone14'],
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
