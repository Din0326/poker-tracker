import { test, type Page } from '@playwright/test'
import {
  addStakeInline,
  addVenueInline,
  buyInInput,
  feeInput,
  openRecordPage,
  saveButton,
  setDuration,
  typeButton,
} from './helpers/record'

// 10.1：新增或修改的畫面以 iPhone 14 viewport 截圖，深淺色各一張，附在 MR。
// 只在 npm run screenshots 時執行（見 playwright.config.ts testIgnore），避免一般測試改動 docs/
const outDir = process.env.SCREENSHOTS_DIR

const screens = [
  { name: 'sessions', hash: '#/sessions' },
  { name: 'report', hash: '#/report' },
  { name: 'settings', hash: '#/settings' },
  { name: 'venues', hash: '#/settings/venues' },
]

/** 關閉加入主畫面提示，讓表單內容完整入鏡 */
async function dismissInstallBanner(page: Page) {
  const close = page.getByRole('note').getByRole('button', { name: '關閉' })
  if (await close.isVisible()) await close.click()
}

// P2 新增頁的各種狀態
const recordStates: { name: string; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'record-cash',
    setup: async (page) => {
      await addStakeInline(page, '50', '100')
      await addVenueInline(page, 'A 俱樂部')
      await page.getByLabel('買入（含服務費）', { exact: true }).fill('10000')
      await page.getByLabel('服務費', { exact: true }).fill('300')
      await page.getByLabel('到手金額').fill('12400')
      await setDuration(page, 3, 30)
    },
  },
  {
    name: 'record-mtt-2-buyins',
    setup: async (page) => {
      await typeButton(page, 'MTT').click()
      await buyInInput(page, 1).fill('3400')
      await feeInput(page, 1).fill('400')
      await page.getByRole('button', { name: '＋ 再買入' }).click()
      await buyInInput(page, 2).fill('3200')
      await feeInput(page, 2).fill('200')
      await page.getByLabel('到手金額').fill('9000')
      await page.getByLabel('名次').fill('12')
      await page.getByLabel('參賽人數').fill('180')
      await page.evaluate(() => window.scrollTo(0, 0))
    },
  },
  {
    // 捲到下半部：名次列、開始時間、時長、場地、名稱
    name: 'record-mtt-lower',
    setup: async (page) => {
      await typeButton(page, 'MTT').click()
      await buyInInput(page, 1).fill('3400')
      await page.getByLabel('到手金額').fill('9000')
      await page.getByLabel('名次').fill('12')
      await page.getByLabel('參賽人數').fill('180')
      await setDuration(page, 6, 15)
      await addVenueInline(page, 'Ace Club')
      await page.getByLabel('名稱', { exact: true }).fill('週日主賽')
      await page.getByLabel('備註').fill('第 3 個級別後 re-entry')
      await page
        .getByLabel('名次')
        .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140))
    },
  },
  {
    name: 'record-timed-mtt',
    setup: async (page) => {
      await typeButton(page, '限時 MTT').click()
      await buyInInput(page, 1).fill('2000')
      await page.getByLabel('到手金額').fill('0')
      await setDuration(page, 1, 45)
      await page.evaluate(() => window.scrollTo(0, 0))
    },
  },
  {
    name: 'record-errors',
    setup: async (page) => {
      await typeButton(page, 'MTT').click()
      await feeInput(page, 1).fill('500')
      await page.getByLabel('名次').fill('3')
      await saveButton(page).click()
      await page.getByText('請填寫買入金額').waitFor()
      await page.evaluate(() => window.scrollTo(0, 0))
    },
  },
  {
    name: 'sheet-add-stake',
    setup: async (page) => {
      await page.getByRole('button', { name: /請先新增盲注/ }).click()
      await page.getByRole('dialog').getByLabel('小盲').fill('100')
      await page.getByRole('dialog').getByRole('button', { name: '儲存' }).click()
      await page.getByRole('dialog').getByText('大盲不可小於小盲').waitFor()
    },
  },
  {
    name: 'sheet-switch-confirm',
    setup: async (page) => {
      await typeButton(page, 'MTT').click()
      await buyInInput(page, 1).fill('3400')
      await page.getByRole('button', { name: '＋ 再買入' }).click()
      await typeButton(page, '現金桌').click()
      await page.getByRole('dialog').waitFor()
    },
  },
  {
    name: 'record-saved-toast',
    setup: async (page) => {
      await typeButton(page, '限時 MTT').click()
      await buyInInput(page, 1).fill('3400')
      await feeInput(page, 1).fill('400')
      await page.getByLabel('到手金額').fill('5800')
      await setDuration(page, 2, 0)
      await saveButton(page).click()
      await page.getByText('已儲存，盈利 +$2,400').waitFor()
      await page.evaluate(() => window.scrollTo(0, 0))
    },
  },
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
