import { test } from '@playwright/test'

// 10.1：新增或修改的畫面以 iPhone 14 viewport 截圖，深淺色各一張，附在 MR。
// 只在 npm run screenshots 時執行（見 playwright.config.ts testIgnore），避免一般測試改動 docs/
const outDir = process.env.SCREENSHOTS_DIR

const screens = [
  { name: 'record', hash: '#/' },
  { name: 'sessions', hash: '#/sessions' },
  { name: 'report', hash: '#/report' },
  { name: 'settings', hash: '#/settings' },
  { name: 'venues', hash: '#/settings/venues' },
]

for (const scheme of ['dark', 'light'] as const) {
  for (const screen of screens) {
    test(`截圖 ${screen.name}-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.goto(`./${screen.hash}`)
      await page.getByRole('heading', { level: 1 }).waitFor()
      await page.screenshot({ path: `${outDir}/${screen.name}-${scheme}.png` })
    })
  }
}
