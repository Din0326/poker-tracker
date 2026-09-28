import { defineConfig, devices } from '@playwright/test'

// 10.1：WebKit + iPhone 14 viewport，模擬主要使用裝置
export default defineConfig({
  testDir: 'tests/e2e',
  // 截圖只在 npm run screenshots 時執行
  testIgnore: process.env.SCREENSHOTS_DIR ? [] : ['**/screenshots.spec.ts'],
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
