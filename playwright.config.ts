import { defineConfig, devices } from '@playwright/test'

// 10.1：WebKit + iPhone 14 viewport，模擬主要使用裝置
// 截圖只在 npm run screenshots 時執行
const screenshotsIgnore = process.env.SCREENSHOTS_DIR ? [] : ['**/screenshots.spec.ts']
// 效能量測（P3-3）另成一個 project，等其他測試跑完才執行，避免平行測試搶 CPU 影響數字
const perfSpec = '**/sessions-perf.spec.ts'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'webkit-iphone14',
      use: { ...devices['iPhone 14'] },
      testIgnore: [...screenshotsIgnore, perfSpec],
    },
    {
      name: 'webkit-iphone14-perf',
      use: { ...devices['iPhone 14'] },
      testMatch: [perfSpec],
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
