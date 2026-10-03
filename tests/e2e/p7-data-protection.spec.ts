import { expect, test, type Page } from '@playwright/test'
import type { Session } from '../../src/domain/types'
import { actionButton, betTo, dealStreet, enterSetup79, handBar, openNewHand } from './helpers/handForm'
import { createV2Database, nativeDbInfo, putRecords, readSettings, readStore } from './helpers/idb'
import { openRecordPage } from './helpers/record'
import { fixtureSessions, heading, rows, stakedSessions, stakes, summary, venues } from './helpers/sessions'
import { chooseImportFile, clickAndDownload, disableShare, openSettings } from './helpers/settings'

// 10.3 P7 資料保護加強（v1 規格 v1.6、v2 規格 v2.4）的 E2E：
// - v1 3.7「升級前的備份提示」：原生建立 version 2（原生 20）並寫入資料 → 載入 App → 提示 →【先匯出備份】/【繼續更新】/【直接更新】
// - v1 8.8 資料保存說明
// - v2 5.3 完整模式自動捲動

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
const allSessions: Session[] = [...fixtureSessions, ...stakedSessions]
/** v1.4 正式版的設定（含不進備份的 lastType 以外 key：recordDraft 不放，避免草稿干擾） */
const oldSettings = [
  { key: 'lastType', value: 'mtt' },
  { key: 'profitColorScheme', value: 'greenGain' },
  { key: 'lastStakeId', value: stakes[0]!.id },
]
const prompt = (page: Page) => page.getByTestId('db-upgrade-prompt')

/** 先開同源的靜態檔（不執行 App），以原生 API 建立 Dexie version 2（原生 20）的資料庫並寫入資料 */
async function createOldDatabase(page: Page, withData = true): Promise<void> {
  await page.goto('./icons/icon-192.png')
  await createV2Database(page, withData ? { sessions: allSessions, venues, stakes, settings: oldSettings } : { sessions: [], venues: [], stakes: [], settings: oldSettings })
  expect(await nativeDbInfo(page)).toEqual({ version: 20, stores: ['sessions', 'settings', 'stakes', 'venues'] })
}

test.describe('v1 3.7 升級前的備份提示', () => {
  test('P7 version 2 有資料：出現提示（原生版本仍為 20）→【先匯出備份】下載的 JSON 與舊資料一致、schemaVersion 2 →【繼續更新】後 App 正常、資料完整、原生版本 30', async ({ page }) => {
    await disableShare(page)
    await createOldDatabase(page)

    await page.goto('./#/sessions')
    await expect(prompt(page)).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('這次更新會升級資料庫')
    await expect(page.getByTestId('db-upgrade-data-count')).toHaveText(`${allSessions.length} 場 · ${venues.length} 個場地 · ${stakes.length} 個盲注`)
    // 提示期間不渲染 App（沒有分頁列），資料庫尚未升級
    await expect(page.getByRole('navigation', { name: '主要分頁' })).toHaveCount(0)
    expect(await nativeDbInfo(page)).toEqual({ version: 20, stores: ['sessions', 'settings', 'stakes', 'venues'] })

    // 【先匯出備份】：升級前的原始資料，schemaVersion 2、沒有 hands 欄位、資料逐欄相同
    const { download, body } = await clickAndDownload(page, '先匯出備份')
    expect(download.suggestedFilename()).toMatch(/^poker-backup-\d{8}-\d{4}\.json$/)
    const backup = JSON.parse(body.toString('utf8')) as Record<string, unknown> & { sessions: Session[]; venues: { id: string }[]; stakes: { id: string }[] }
    expect(backup.app).toBe('poker-tracker')
    expect(backup.schemaVersion).toBe(2)
    expect('hands' in backup).toBe(false)
    expect(backup.sessions).toStrictEqual(byId(allSessions))
    expect(byId(backup.venues)).toStrictEqual(byId(venues))
    expect(byId(backup.stakes)).toStrictEqual(byId(stakes))
    expect(backup.settings).toEqual(Object.fromEntries(oldSettings.map((r) => [r.key, r.value])))

    // 下載觸發後：按鈕旁顯示「已備份」並出現【繼續更新】；仍未升級
    await expect(page.getByTestId('db-upgrade-backed-up')).toHaveText('已備份')
    await expect(page.getByRole('button', { name: '直接更新' })).toHaveCount(0)
    expect((await nativeDbInfo(page)).version).toBe(20)

    // 【繼續更新】：升級成功、App 正常
    await page.getByRole('button', { name: '繼續更新' }).click()
    await expect(heading(page)).toHaveText('紀錄')
    await expect(rows(page)).toHaveCount(allSessions.length)
    expect(await nativeDbInfo(page)).toEqual({ version: 30, stores: ['hands', 'sessions', 'settings', 'stakes', 'venues'] })
    // 資料完整（逐欄相同），lastBackupAt 為升級前備份的 exportedAt
    expect(byId(await readStore<Session>(page, 'sessions'))).toStrictEqual(byId(allSessions))
    expect(byId(await readStore<{ id: string }>(page, 'venues'))).toStrictEqual(byId(venues))
    expect(byId(await readStore<{ id: string }>(page, 'stakes'))).toStrictEqual(byId(stakes))
    expect(await readSettings(page)).toEqual({ ...Object.fromEntries(oldSettings.map((r) => [r.key, r.value])), lastBackupAt: backup.exportedAt })
    expect(await readStore(page, 'hands')).toEqual([])

    // 升級前的備份可由新版匯入（8.5：2 → 3 遷移）
    await openSettings(page)
    await chooseImportFile(page, body)
    const sheet = page.getByRole('dialog', { name: '匯入備份？' })
    await expect(sheet.getByTestId('import-backup-count')).toHaveText(`${allSessions.length} 場、0 手`)
    await sheet.getByRole('button', { name: '匯入', exact: true }).click()
    await expect(page.getByTestId('global-toast-text')).toHaveText(`已匯入 ${allSessions.length} 場紀錄、0 手牌`)
    expect(byId(await readStore<Session>(page, 'sessions'))).toStrictEqual(byId(allSessions))
  })

  test('P7 version 2 有資料：【直接更新】不備份直接升級，App 正常、資料完整、原生版本 30、不寫入 lastBackupAt', async ({ page }) => {
    await createOldDatabase(page)
    await page.goto('./#/sessions')
    await expect(prompt(page)).toBeVisible()
    await page.getByRole('button', { name: '直接更新' }).click()
    await expect(heading(page)).toHaveText('紀錄')
    await expect(summary(page)).toContainText(`共 ${allSessions.length} 場`)
    expect(await nativeDbInfo(page)).toEqual({ version: 30, stores: ['hands', 'sessions', 'settings', 'stakes', 'venues'] })
    expect(byId(await readStore<Session>(page, 'sessions'))).toStrictEqual(byId(allSessions))
    expect(await readSettings(page)).toEqual(Object.fromEntries(oldSettings.map((r) => [r.key, r.value])))
  })

  test('P7 分享選單取消（AbortError）不視為已備份；分享完成後【繼續更新】', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shareMode: 'cancel' | 'ok'; __shared: string[] }
      w.__shareMode = 'cancel'
      w.__shared = []
      Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true, configurable: true })
      Object.defineProperty(Navigator.prototype, 'share', {
        value: async (data: { files: File[] }) => {
          if (w.__shareMode === 'cancel') throw new DOMException('Share canceled', 'AbortError')
          for (const f of data.files) w.__shared.push(await f.text())
        },
        configurable: true,
      })
    })
    await createOldDatabase(page)
    await page.goto('./')
    await expect(prompt(page)).toBeVisible()
    const exportButton = page.getByRole('button', { name: '先匯出備份' })
    await exportButton.click()
    await expect(exportButton).toBeEnabled()
    await expect(page.getByTestId('db-upgrade-backed-up')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '直接更新' })).toBeVisible()

    await page.evaluate(() => ((window as unknown as { __shareMode: string }).__shareMode = 'ok'))
    await exportButton.click()
    await expect(page.getByTestId('db-upgrade-backed-up')).toHaveText('已備份')
    const shared = await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared)
    expect(shared).toHaveLength(1)
    expect(JSON.parse(shared[0]!).schemaVersion).toBe(2)
    await page.getByRole('button', { name: '繼續更新' }).click()
    await expect(heading(page)).toHaveText('新增場次')
    expect((await readSettings(page)).lastBackupAt).toBe(JSON.parse(shared[0]!).exportedAt)
  })

  test('P7 已是最新版本（version 3）時不顯示提示；全新安裝不顯示提示；舊版但沒有資料（只有設定）不顯示提示', async ({ page }) => {
    // 全新安裝
    await openRecordPage(page)
    await expect(prompt(page)).toHaveCount(0)
    expect((await nativeDbInfo(page)).version).toBe(30)

    // 已是最新版本且有資料：重新載入不出現提示
    await putRecords(page, 'venues', venues)
    await putRecords(page, 'stakes', stakes)
    await putRecords(page, 'sessions', allSessions)
    await page.goto('./#/sessions')
    await page.reload()
    await expect(heading(page)).toHaveText('紀錄')
    await expect(rows(page)).toHaveCount(allSessions.length)
    await expect(prompt(page)).toHaveCount(0)
  })

  test('P7 舊版（version 2）但沒有場次、場地、盲注：不顯示提示，直接升級', async ({ page }) => {
    await createOldDatabase(page, false)
    await page.goto('./')
    await expect(heading(page)).toHaveText('新增場次')
    await expect(prompt(page)).toHaveCount(0)
    expect((await nativeDbInfo(page)).version).toBe(30)
  })
})

test('P7 v1 8.8 資料保存說明：設定頁「資料與系統資訊」顯示四個重點；持久儲存未取得時加註說明', async ({ page }) => {
  await openRecordPage(page)
  await openSettings(page)
  const note = page.getByTestId('data-safety-note')
  await expect(note).toBeVisible()
  await expect(note.getByRole('heading', { name: '關於資料保存' })).toBeVisible()
  await expect(note.getByRole('listitem')).toHaveText([
    '紀錄只存在這台裝置，沒有雲端同步。',
    '在 iPhone 刪除主畫面的 App 圖示，或清除 Safari 的網站資料，會一併刪除這台裝置上的所有紀錄。',
    '換手機時，請先在舊手機匯出備份檔，再到新手機匯入。',
    '建議定期匯出備份，存到「檔案」App 或其他地方。',
  ])
  // 位於「資料與系統資訊」區塊內
  await expect(page.getByRole('region', { name: '資料與系統資訊' }).getByTestId('data-safety-note')).toBeVisible()
  const persisted = page.getByTestId('info-persisted').locator('dd')
  await expect(persisted).toHaveText(/^(已取得|未取得)$/)
  if ((await persisted.textContent()) === '未取得') {
    await expect(page.getByTestId('persist-note')).toHaveText('未取得時，裝置空間不足時系統可能清除本 App 的資料，請更常備份。')
  } else {
    await expect(page.getByTestId('persist-note')).toHaveCount(0)
  }
})

test('P7 v1 8.8 持久儲存未取得時一定顯示說明（storage.persist 回傳 false）', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, 'persisted', { value: async () => false, configurable: true })
    Object.defineProperty(StorageManager.prototype, 'persist', { value: async () => false, configurable: true })
  })
  await openRecordPage(page)
  await openSettings(page)
  await expect(page.getByTestId('info-persisted').locator('dd')).toHaveText('未取得')
  await expect(page.getByTestId('persist-note')).toHaveText('未取得時，裝置空間不足時系統可能清除本 App 的資料，請更常備份。')
})

// ---------------------------------------------------------------------------
// v2 5.3 完整模式自動捲動
// ---------------------------------------------------------------------------

/** 等捲動停止：先等超過 2 個 frame + 200ms 動畫，再確認連續 5 個 frame scrollY 不變 */
async function waitScrollSettled(page: Page): Promise<void> {
  await page.waitForTimeout(350)
  await page.evaluate(async () => {
    let last = -1
    let stable = 0
    const t0 = performance.now()
    while (stable < 5 && performance.now() - t0 < 3000) {
      await new Promise((r) => requestAnimationFrame(r))
      if (window.scrollY === last) stable++
      else {
        stable = 0
        last = window.scrollY
      }
    }
  })
}

/** 最新一筆行動（行動紀錄的最後一行或最新一條街）與底池資訊的位置，以及固定行動列頂部、標題列底部 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const lines = document.querySelectorAll('[data-testid="log-line"]')
    const streets = document.querySelectorAll('[data-log-street]')
    const pots = document.querySelectorAll('[data-pot-info]')
    const lastLine = lines[lines.length - 1]!
    const lastStreet = streets[streets.length - 1]!
    const latest = lastStreet.contains(lastLine) ? lastLine : lastStreet
    const bar = document.querySelector('[data-testid="hand-bar"]')!.parentElement!
    return {
      latestTop: latest.getBoundingClientRect().top,
      latestBottom: latest.getBoundingClientRect().bottom,
      potBottom: pots[pots.length - 1]!.getBoundingClientRect().bottom,
      barTop: bar.getBoundingClientRect().top,
      headerBottom: document.querySelector('header')!.getBoundingClientRect().bottom,
      scrollY: window.scrollY,
      maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    }
  })
}

/** 等動畫結束後：最新一筆行動與底池資訊完整顯示在固定行動列之上、標題列之下 */
async function expectLatestVisible(page: Page, label: string): Promise<void> {
  await waitScrollSettled(page)
  const m = await measure(page)
  expect(m.latestBottom, `${label}：最新一筆行動底部 ≤ 行動列頂部`).toBeLessThanOrEqual(m.barTop)
  expect(m.potBottom, `${label}：底池資訊底部 ≤ 行動列頂部`).toBeLessThanOrEqual(m.barTop)
  expect(m.latestTop, `${label}：最新一筆行動在標題列之下`).toBeGreaterThanOrEqual(m.headerBottom)
}

/** 7.9 範例：每一步後檢查（翻前 → 翻牌 → 轉牌） */
async function play79WithChecks(page: Page): Promise<void> {
  const steps: [string, () => Promise<void>][] = [
    ['UTG 棄牌', () => actionButton(page, '棄牌').click()],
    ['HJ 棄牌', () => actionButton(page, '棄牌').click()],
    ['CO 棄牌', () => actionButton(page, '棄牌').click()],
    ['你加注到 500', () => betTo(page, '加注', '500')],
    ['SB 棄牌', () => actionButton(page, '棄牌').click()],
    ['BB 跟注（翻前結束，選翻牌）', () => actionButton(page, '跟注 $300').click()],
    ['開始翻牌', () => dealStreet(page, ['Kh', '7d', '2c'], '開始翻牌')],
    ['BB 過牌', () => actionButton(page, '過牌').click()],
    ['你下注 700', () => betTo(page, '下注', '700')],
    ['BB 跟注（翻牌結束，選轉牌）', () => actionButton(page, '跟注 $700').click()],
    ['開始轉牌', () => dealStreet(page, ['9s'], '開始轉牌')],
    ['BB 過牌', () => actionButton(page, '過牌').click()],
    ['你下注 1600', () => betTo(page, '下注', '1600')],
    ['BB 加注到 15900', () => betTo(page, '加注', '15900')],
  ]
  for (const [label, run] of steps) {
    await run()
    await expectLatestVisible(page, label)
  }
}

/** 縮短可視高度，讓 7.9 的行動紀錄在翻牌就超出畫面（iPhone 14 寬度不變） */
async function openComplete79(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 560 })
  await openNewHand(page)
  await enterSetup79(page)
  await expect(page.getByTestId('to-act')).toHaveText('輪到 UTG（座位 1）· 剩 $20,000')
}

test.describe('v2 5.3 完整模式自動捲動', () => {
  // 逐步輸入整手 7.9 且每步等動畫結束後量測，單獨執行約 20 秒；平行執行時放寬逾時
  test.describe.configure({ timeout: 60_000 })
  test('P7 5.3 連續輸入行動：每一步後最新一筆行動與底池資訊都在固定行動列之上（等動畫結束後量測），且確實有捲動', async ({ page }) => {
    await openComplete79(page)
    await play79WithChecks(page)
    const m = await measure(page)
    // 行動紀錄已超出畫面：頁面有捲動（否則此測試無意義）
    expect(m.maxScroll).toBeGreaterThan(0)
    expect(m.scrollY).toBeGreaterThan(0)

    // 進入結果步驟（跟注全下 → 確認河牌）：最新一筆行動與「底池與贏家」清單在行動列之上
    await actionButton(page, '跟注 $14,300').click()
    await expectLatestVisible(page, '跟注全下（選河牌）')
    await dealStreet(page, ['3h'], '確認公牌')
    await expect(page.getByTestId('result-step')).toBeVisible()
    await expectLatestVisible(page, '進入結果步驟')

    // 復原上一步（回到選河牌）：仍在行動列之上
    await handBar(page).getByRole('button', { name: '復原上一步' }).click()
    await expect(page.getByTestId('street-board-slots')).toBeVisible()
    await expectLatestVisible(page, '復原上一步')
  })

  test('P7 5.3 平滑捲動：一般情況以多個 frame 的動畫捲動，時長 ≤ 250ms', async ({ page }) => {
    await openComplete79(page)
    await play79WithChecks(page)
    // 往上捲一點（仍在底部附近，距底部 ≤ 可視高度 1/3），下一個行動後應以動畫捲回
    await page.evaluate(() => window.scrollBy(0, -80))
    await waitScrollSettled(page)
    await page.evaluate(() => {
      const w = window as unknown as { __scrolls: number[] }
      w.__scrolls = []
      window.addEventListener('scroll', () => w.__scrolls.push(performance.now()))
    })
    await actionButton(page, '跟注 $14,300').click()
    await expectLatestVisible(page, '跟注全下')
    const times = await page.evaluate(() => (window as unknown as { __scrolls: number[] }).__scrolls)
    expect(times.length).toBeGreaterThan(2)
    expect(times[times.length - 1]! - times[0]!).toBeLessThanOrEqual(250)
  })

  test('P7 5.3 回看時不自動捲：捲到頁面頂端（距底部超過可視高度 1/3）後新增行動，捲動位置不變', async ({ page }) => {
    await openComplete79(page)
    await play79WithChecks(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await waitScrollSettled(page)
    const before = await measure(page)
    expect(before.scrollY).toBe(0)
    // 前提：距底部超過可視高度的 1/3
    expect(before.maxScroll - before.scrollY).toBeGreaterThan((await page.evaluate(() => window.innerHeight)) / 3)

    await actionButton(page, '跟注 $14,300').click()
    await expect(page.getByTestId('street-board-slots')).toBeAttached()
    await waitScrollSettled(page)
    const after = await measure(page)
    expect(after.scrollY).toBe(0)
    // 最新一筆行動仍在行動列下方（沒有被捲上來）
    expect(after.latestBottom).toBeGreaterThan(after.barTop)
  })

  test('P7 5.3 prefers-reduced-motion：直接跳到位置（單一次捲動），最新一筆行動與底池資訊同樣在行動列之上', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openComplete79(page)
    await play79WithChecks(page)
    await page.evaluate(() => window.scrollBy(0, -80))
    await waitScrollSettled(page)
    await page.evaluate(() => {
      const w = window as unknown as { __scrolls: number }
      w.__scrolls = 0
      window.addEventListener('scroll', () => (w.__scrolls += 1))
    })
    await actionButton(page, '跟注 $14,300').click()
    await expectLatestVisible(page, 'reduced-motion 跟注全下')
    expect(await page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls)).toBe(1)
  })
})
