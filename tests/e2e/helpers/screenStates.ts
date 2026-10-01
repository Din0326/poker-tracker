import type { Page } from '@playwright/test'
import dayjs from 'dayjs'
import { generateSeedData } from '../../../src/dev/seed'
import { DB_NAME, putRecords } from './idb'
import { groupByButton, manySessions, openReport, reportTab } from './report'
import { chooseImportFile, openActions } from './settings'
import {
  V_6BET,
  fixture,
  fixtureSessions,
  openDetail,
  openList,
  seed,
  stakedFixture,
  stakedSessions,
  stakes,
  venues,
} from './sessions'
import {
  addStakeInline,
  addVenueInline,
  buyInInput,
  feeInput,
  openRecordPage,
  saveButton,
  setDuration,
  typeButton,
} from './record'

// 各階段截圖（screenshots.spec.ts）與 P6-2 對比度檢查（p6-contrast.spec.ts）共用的畫面狀態

/** 關閉加入主畫面提示，讓表單內容完整入鏡 */
export async function dismissInstallBanner(page: Page) {
  const close = page.getByRole('note').getByRole('button', { name: '關閉' })
  if (await close.isVisible()) await close.click()
}

// P2 新增頁的各種狀態
export const recordStates: { name: string; setup: (page: Page) => Promise<void> }[] = [
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
    name: 'sheet-add-venue',
    setup: async (page) => {
      await page.getByLabel('場地', { exact: true }).selectOption({ label: '＋ 新增場地' })
      await page.getByRole('dialog').getByLabel('場地名稱').fill('A 俱樂部')
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
export const sessionStates: { name: string; bottom?: boolean; setup: (page: Page) => Promise<void> }[] = [
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
export async function scrollToHeading(page: Page, name: string) {
  await page
    .getByRole('heading', { level: 2, name })
    .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60))
}

// P4 報表：四個頁籤（上半部指標卡、下半部曲線與分組）、總體小表、tooltip、空狀態、盲注分組
export const reportStates: { name: string; lower?: boolean; setup: (page: Page) => Promise<void> }[] = [
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

// P5 設定、場地與盲注管理、匯入、清除、備份提醒
export const settingsStates: { name: string; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'settings-top',
    setup: async (page) => {
      await seed(page)
      await page.goto('./#/settings')
      await page.getByRole('heading', { level: 2, name: '資料備份' }).waitFor()
      // 等匯出資料備妥（按鈕由「準備中…」變回「匯出備份（JSON）」），避免截到過渡狀態
      await page.getByRole('button', { name: '匯出備份（JSON）', exact: true }).waitFor()
    },
  },
  {
    name: 'settings-bottom',
    setup: async (page) => {
      await seed(page)
      await putRecords(page, 'settings', [{ key: 'lastBackupAt', value: '2026-09-20T22:30:00+08:00' }])
      await page.goto('./#/settings')
      await page.getByRole('heading', { level: 2, name: '資料備份' }).waitFor()
      await page.getByRole('button', { name: '匯出備份（JSON）', exact: true }).waitFor()
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    },
  },
  {
    name: 'venues',
    setup: async (page) => {
      await seed(page)
      await putRecords(page, 'venues', [{ id: '00000000-0000-4000-8000-000000000103', name: 'Ace Club', archived: false, sortOrder: 2 }])
      await page.goto('./#/settings/venues')
      await page.getByText('已封存（1）').click()
      await page.getByTestId('archived-list').waitFor()
    },
  },
  {
    name: 'venues-empty',
    setup: async (page) => {
      await page.goto('./#/settings/venues')
      await page.getByText('還沒有場地').waitFor()
    },
  },
  {
    name: 'venues-actions',
    setup: async (page) => {
      await seed(page)
      await page.goto('./#/settings/venues')
      await openActions(page, '6bet')
    },
  },
  {
    name: 'venues-rename',
    setup: async (page) => {
      await seed(page)
      await page.goto('./#/settings/venues')
      const sheet = await openActions(page, '6bet')
      await sheet.getByRole('button', { name: '改名' }).click()
      await page.getByRole('dialog', { name: '場地改名' }).waitFor()
    },
  },
  {
    name: 'stakes',
    setup: async (page) => {
      await seed(page)
      await putRecords(page, 'stakes', [{ id: '00000000-0000-4000-8000-000000000203', sb: 200, bb: 400, archived: false, sortOrder: 2 }])
      await page.goto('./#/settings/stakes')
      await page.getByText('已封存（1）').click()
      await page.getByTestId('archived-list').waitFor()
    },
  },
  {
    name: 'stakes-actions',
    setup: async (page) => {
      await seed(page)
      await putRecords(page, 'stakes', [{ id: '00000000-0000-4000-8000-000000000203', sb: 200, bb: 400, archived: false, sortOrder: 2 }])
      await page.goto('./#/settings/stakes')
      await openActions(page, '200/400')
    },
  },
  {
    name: 'import-confirm',
    setup: async (page) => {
      await seed(page)
      await page.goto('./#/settings')
      await page.getByRole('heading', { level: 2, name: '資料備份' }).waitFor()
      const backup = {
        app: 'poker-tracker',
        schemaVersion: 1,
        exportedAt: '2026-09-28T21:05:00+08:00',
        sessions: fixtureSessions.slice(0, 5),
        venues,
        stakes,
        settings: {},
      }
      await chooseImportFile(page, JSON.stringify(backup))
      await page.getByRole('dialog', { name: '匯入備份？' }).waitFor()
    },
  },
  {
    name: 'import-error',
    setup: async (page) => {
      await seed(page)
      await page.goto('./#/settings')
      await page.getByRole('heading', { level: 2, name: '資料備份' }).waitFor()
      const bad = {
        app: 'poker-tracker',
        schemaVersion: 1,
        exportedAt: '2026-09-28T21:05:00+08:00',
        sessions: fixtureSessions.map((s, i) => (i === 2 ? { ...s, buyIns: [{ amount: 3400, fee: 3500 }] } : s)),
        venues,
        stakes,
        settings: {},
      }
      await chooseImportFile(page, JSON.stringify(bad))
      await page.getByRole('dialog', { name: '無法匯入' }).waitFor()
    },
  },
  {
    name: 'clear-confirm',
    setup: async (page) => {
      await seed(page)
      await page.goto('./#/settings')
      await page.getByRole('heading', { level: 2, name: '資料備份' }).waitFor()
      await page.getByRole('button', { name: '清除所有資料' }).click()
      await page.getByRole('dialog').getByLabel('請輸入「刪除」以確認').fill('刪')
    },
  },
  {
    name: 'report-backup-reminder',
    setup: async (page) => {
      await seed(page, { venues, stakes, sessions: [...fixtureSessions, ...manySessions(5)] })
      await openReport(page)
      await page.getByTestId('backup-reminder').waitFor()
    },
  },
]

// P5.5 賣股份：新增頁區塊（收合、展開含名稱建議、驗證錯誤、兩行預覽）、列表標籤、詳情、刪除確認、報表小字與 tooltip
const stakedData = { venues, stakes, sessions: [...fixtureSessions, ...stakedSessions] }

/** 新增一列出資者 */
async function addBacker(page: Page, name: string, share: string, markup?: string) {
  await page.getByRole('button', { name: /^＋ (賣股份|新增出資者)$/ }).click()
  const row = page.getByTestId('backer-row').last()
  if (name !== '') await row.getByLabel('出資者名稱', { exact: true }).fill(name)
  if (share !== '') await row.getByLabel('比例', { exact: true }).fill(share)
  if (markup !== undefined) await row.getByLabel('加價倍數', { exact: true }).fill(markup)
}

/** 把賣股份區塊捲到標題列下方 */
async function scrollToStaking(page: Page, offset = 140) {
  await page
    .getByTestId('staking-section')
    .evaluate((el, off) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off), offset)
}

/** 新增頁：寫入有出資者的歷史資料（名稱建議來源）後重新進入，切到 MTT 並填買入、到手 */
async function openStakingForm(page: Page) {
  await seed(page, stakedData)
  await page.goto('./')
  await page.getByRole('button', { name: '儲存', exact: true }).waitFor()
  await dismissInstallBanner(page)
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('10000')
  await page.getByLabel('到手金額').fill('50000')
}

export const stakingStates: { name: string; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'staking-collapsed',
    setup: async (page) => {
      await openStakingForm(page)
      await scrollToStaking(page, 260)
    },
  },
  {
    name: 'staking-expanded-suggestions',
    setup: async (page) => {
      await openStakingForm(page)
      await addBacker(page, 'A', '10', '1.2')
      await page.getByRole('button', { name: '＋ 新增出資者' }).click()
      await scrollToStaking(page, 100)
      await page.getByTestId('backer-row').last().getByLabel('出資者名稱', { exact: true }).focus()
      await page.getByTestId('backer-suggestions').waitFor()
      // 清單出現後 App 會把整列捲到固定列之上，等捲動完成
      await page.waitForTimeout(450)
    },
  },
  {
    name: 'staking-preview-two-lines',
    setup: async (page) => {
      await openStakingForm(page)
      await addBacker(page, 'A', '10')
      await addBacker(page, 'B', '20')
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      await scrollToStaking(page, 100)
    },
  },
  {
    name: 'staking-errors',
    setup: async (page) => {
      await openStakingForm(page)
      await setDuration(page, 2, 0)
      await addBacker(page, 'A', '60', '0.9')
      await addBacker(page, 'a', '45.5')
      await saveButton(page).click()
      await page.getByText('賣出比例合計不可超過 100%（目前 105.5%）').waitFor()
      await scrollToStaking(page, 100)
    },
  },
  {
    name: 'sessions-list-staked',
    setup: async (page) => {
      await seed(page, stakedData)
      await openList(page)
      await page.getByTestId('row-sold-badge').first().waitFor()
    },
  },
  {
    name: 'detail-staked',
    setup: async (page) => {
      await seed(page, stakedData)
      await openList(page)
      await openDetail(page, stakedFixture.s14.id)
    },
  },
  {
    name: 'detail-staked-section',
    setup: async (page) => {
      await seed(page, stakedData)
      await openList(page)
      await openDetail(page, stakedFixture.s14.id)
      await page
        .getByTestId('detail-staking')
        .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60))
    },
  },
  {
    name: 'delete-confirm-staked',
    setup: async (page) => {
      await seed(page, stakedData)
      await openList(page)
      await openDetail(page, stakedFixture.s14.id)
      await page.getByRole('button', { name: '刪除' }).click()
      await page.getByRole('dialog', { name: '刪除這筆紀錄？' }).waitFor()
    },
  },
  {
    name: 'report-staked-note',
    setup: async (page) => {
      await seed(page, stakedData)
      await openReport(page)
      await page.getByTestId('staking-note').waitFor()
      await page.getByTestId('staking-note').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 420))
    },
  },
  {
    name: 'report-staked-tooltip',
    setup: async (page) => {
      await seed(page, stakedData)
      await openReport(page)
      await reportTab(page, 'MTT').click()
      await scrollToHeading(page, '累積盈利曲線')
      // MTT 頁籤由舊到新：a2、m1、s14（有出資者）→ 點第 3 個資料點
      const dot = page.locator('[data-testid="profit-curve"] .recharts-line-dots circle').nth(2)
      const box = (await dot.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await page.getByTestId('tooltip-sold').waitFor()
    },
  },
]

/**
 * 讓「有新版本 · 重新載入」提示出現：以更高的版本號開啟同一個資料庫，
 * App 的連線收到 versionchange 後關閉並顯示 8.10 的提示條（與 service worker 偵測到新版時是同一個元件）。
 */
export async function triggerUpdatePrompt(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    const open = (version?: number) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = version === undefined ? indexedDB.open(dbName) : indexedDB.open(dbName, version)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const current = await open()
    const next = current.version + 1
    current.close()
    ;(await open(next)).close()
  }, DB_NAME)
  await page.getByRole('button', { name: '重新載入' }).waitFor()
}

// P6：更新提示（填到一半的新增頁上方）
export const p6States: { name: string; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'update-prompt',
    setup: async (page) => {
      await openRecordPage(page)
      await dismissInstallBanner(page)
      await page.getByLabel('買入（含服務費）', { exact: true }).fill('5000')
      await triggerUpdatePrompt(page)
    },
  },
]
