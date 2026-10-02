import { test } from '@playwright/test'
import { openRecordPage } from './helpers/record'
import {
  dismissInstallBanner,
  handExportStates,
  handListStates,
  handStates,
  p6States,
  recordStates,
  reportStates,
  scrollToHeading,
  sessionStates,
  settingsStates,
  stakingStates,
} from './helpers/screenStates'

// 10.1：新增或修改的畫面以 iPhone 14 viewport 截圖，深淺色各一張，附在 MR。
// 只在 npm run screenshots 時執行（見 playwright.config.ts testIgnore），避免一般測試改動 docs/
// 各畫面狀態的 setup 定義在 helpers/screenStates.ts（P6-2 對比度檢查共用）
const outDir = process.env.SCREENSHOTS_DIR

for (const scheme of ['dark', 'light'] as const) {
  for (const state of [...stakingStates, ...settingsStates, ...p6States, ...handStates, ...handListStates, ...handExportStates]) {
    test(`截圖 ${state.name}-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await state.setup(page)
      await page.screenshot({ path: `${outDir}/${state.name}-${scheme}.png` })
    })
  }

  for (const state of reportStates) {
    test(`截圖 ${state.name}-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await state.setup(page)
      await page.screenshot({ path: `${outDir}/${state.name}-${scheme}.png` })
      if (state.lower) {
        await scrollToHeading(page, '累積盈利曲線')
        await page.screenshot({ path: `${outDir}/${state.name}-lower-${scheme}.png` })
      }
    })
  }

  for (const state of sessionStates) {
    test(`截圖 ${state.name}-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await state.setup(page)
      await page.screenshot({ path: `${outDir}/${state.name}-${scheme}.png` })
      // 詳情頁較長：另拍捲到底部的畫面（不用 fullPage，固定的分頁列才會在正確位置）
      if (state.bottom) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.screenshot({ path: `${outDir}/${state.name}-bottom-${scheme}.png` })
      }
    })
  }

  test(`截圖 record-empty-${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await openRecordPage(page)
    await page.screenshot({ path: `${outDir}/record-empty-${scheme}.png` })
  })

  for (const state of recordStates) {
    test(`截圖 ${state.name}-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await openRecordPage(page)
      await dismissInstallBanner(page)
      await state.setup(page)
      await page.screenshot({ path: `${outDir}/${state.name}-${scheme}.png` })
    })
  }
}
