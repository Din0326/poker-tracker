import { test, type Page } from '@playwright/test'
import dayjs from 'dayjs'
import { generateSeedData } from '../../src/dev/seed'
import { groupByButton, openReport, reportTab } from './helpers/report'
import { V_6BET, fixture, openDetail, openList, seed } from './helpers/sessions'
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

// P3 紀錄列表、詳情、編輯、刪除與復原
const sessionStates: { name: string; bottom?: boolean; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'sessions-empty',
    setup: async (page) => {
      await page.goto('./#/sessions')
      await page.getByText('還沒有紀錄').waitFor()
    },
  },
  {
    name: 'sessions-list',
    setup: async (page) => {
      await seed(page)
      await openList(page)
    },
  },
  {
    name: 'sessions-filtered',
    setup: async (page) => {
      await seed(page)
      await page.goto(
        `./#/sessions?type=mtt&period=custom&from=2026-08-01&to=2026-09-30&venue=${V_6BET}&name=${encodeURIComponent('週日賽')}`,
      )
      await page.getByTestId('filter-tag').first().waitFor()
      await page.getByLabel('關鍵字').fill('entry')
      await page.getByTestId('session-row').first().waitFor()
    },
  },
  {
    name: 'sessions-no-match',
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await page.getByLabel('關鍵字').fill('不存在的關鍵字')
      await page.getByText('沒有符合條件的紀錄').waitFor()
    },
  },
  {
    name: 'detail-cash',
    bottom: true,
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await openDetail(page, fixture.c1.id)
    },
  },
  {
    name: 'detail-mtt',
    bottom: true,
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await openDetail(page, fixture.m1.id)
    },
  },
  {
    name: 'detail-archived',
    bottom: true,
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await openDetail(page, fixture.a1.id)
    },
  },
  {
    name: 'detail-not-found',
    setup: async (page) => {
      await seed(page)
      await page.goto('./#/sessions/00000000-0000-4000-8000-00000000dead')
      await page.getByText('找不到這筆紀錄').waitFor()
    },
  },
  {
    name: 'edit',
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await openDetail(page, fixture.m1.id)
      await page.getByRole('button', { name: '編輯' }).click()
      await page.getByText('類型無法修改，如需更改請刪除後重新新增').waitFor()
    },
  },
  {
    name: 'edit-leave-confirm',
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await openDetail(page, fixture.c1.id)
      await page.getByRole('button', { name: '編輯' }).click()
      await page.getByLabel('到手金額').fill('13500')
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await page.getByRole('dialog', { name: '放棄變更？' }).waitFor()
    },
  },
  {
    name: 'delete-confirm',
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await openDetail(page, fixture.m1.id)
      await page.getByRole('button', { name: '刪除' }).click()
      await page.getByRole('dialog', { name: '刪除這筆紀錄？' }).waitFor()
    },
  },
  {
    name: 'copy-draft-confirm',
    setup: async (page) => {
      await seed(page)
      await page.getByLabel('買入（含服務費）', { exact: true }).fill('777')
      await openList(page)
      await openDetail(page, fixture.m1.id)
      await page.getByRole('button', { name: '複製為新紀錄' }).click()
      await page.getByRole('dialog', { name: '覆蓋目前的草稿？' }).waitFor()
    },
  },
  {
    name: 'undo-toast',
    setup: async (page) => {
      await seed(page)
      await openList(page)
      await openDetail(page, fixture.c2.id)
      await page.getByRole('button', { name: '刪除' }).click()
      await page.getByRole('dialog').getByRole('button', { name: '刪除' }).click()
      await page.getByRole('status').filter({ hasText: '已刪除' }).waitFor()
    },
  },
]

/** 報表截圖用：200 筆固定種子的隨機資料（曲線與分組較有代表性） */
async function seedReport(page: Page) {
  await seed(page, generateSeedData({ count: 200, today: dayjs().format('YYYY-MM-DD') }))
  await openReport(page)
}

/** 捲到某個區塊的標題（扣掉固定標題列高度） */
async function scrollToHeading(page: Page, name: string) {
  await page
    .getByRole('heading', { level: 2, name })
    .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60))
}

// P4 報表：四個頁籤（上半部指標卡、下半部曲線與分組）、總體小表、tooltip、空狀態、盲注分組
const reportStates: { name: string; lower?: boolean; setup: (page: Page) => Promise<void> }[] = [
  ...(['總體', '現金桌', 'MTT', '限時 MTT'] as const).map((label, i) => ({
    name: `report-${['all', 'cash', 'mtt', 'timed'][i]}`,
    lower: true,
    setup: async (page: Page) => {
      await seedReport(page)
      await reportTab(page, label).click()
    },
  })),
  {
    name: 'report-breakdown',
    setup: async (page) => {
      await seed(page)
      await openReport(page)
      await page.getByRole('region', { name: '各類型' }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 260))
    },
  },
  {
    name: 'report-tooltip',
    setup: async (page) => {
      await seed(page)
      await openReport(page)
      await scrollToHeading(page, '累積盈利曲線')
      const box = (await page.getByTestId('profit-curve').boundingBox())!
      await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height / 2)
      await page.getByTestId('curve-tooltip').waitFor()
    },
  },
  {
    name: 'report-empty',
    setup: async (page) => {
      await page.goto('./#/report')
      await page.getByText('還沒有紀錄').waitFor()
    },
  },
  {
    name: 'report-period-empty',
    lower: true,
    setup: async (page) => {
      await seed(page)
      await openReport(page)
      await page.getByLabel('期間').selectOption({ label: '自訂' })
      await page.getByLabel('起日').fill('2025-01-01')
      await page.getByLabel('迄日').fill('2025-01-31')
      await page.getByTestId('curve-no-records').waitFor()
    },
  },
  {
    name: 'report-cash-stake-groups',
    setup: async (page) => {
      await seedReport(page)
      await reportTab(page, '現金桌').click()
      await groupByButton(page, '盲注級別').click()
      await scrollToHeading(page, '分組統計')
    },
  },
]

for (const scheme of ['dark', 'light'] as const) {
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
