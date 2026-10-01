import { expect, test, type Page } from '@playwright/test'
import type { Session } from '../../src/domain/types'
import { putRecords, readSettings, readStore, type StoreName } from './helpers/idb'
import { manySessions, openReport } from './helpers/report'
import { fixtureSessions, heading, nav, openList, rows, seed, stakes, venues, S_50, V_6BET } from './helpers/sessions'
import {
  chooseImportFile,
  clearAllData,
  clickAndDownload,
  disableShare,
  openSettings,
  parseCsv,
} from './helpers/settings'

// 10.3 P5：備份還原、匯入拒絕、CSV、分享、備份提醒
test.use({ timezoneId: 'Asia/Taipei' })

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))

const originalSettings = {
  lastType: 'mtt',
  lastVenueByType: { cash: V_6BET, mtt: null },
  lastStakeId: S_50,
  profitColorScheme: 'greenGain',
  recordDraft: { version: 1, type: 'cash', venueTouched: false, values: {} },
}

/**
 * 寫入固定資料與設定後，重新載入到設定頁（啟動時套用盈虧顏色）。
 * 新增頁掛載時會排程刪除未變更的草稿，所以先離開新增頁並重新載入，再寫入設定（含 recordDraft）。
 */
async function seedAll(page: Page, sessions: Session[] = fixtureSessions) {
  await seed(page, { venues, stakes, sessions })
  await page.goto('./#/settings')
  await page.reload()
  await expect(heading(page)).toHaveText('設定')
  await putRecords(
    page,
    'settings',
    Object.entries(originalSettings).map(([key, value]) => ({ key, value })),
  )
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: '資料備份' })).toBeVisible()
}

async function snapshot(page: Page) {
  const out: Record<string, unknown> = {}
  for (const store of ['sessions', 'venues', 'stakes'] as StoreName[]) {
    out[store] = byId(await readStore<{ id: string }>(page, store))
  }
  out.settings = await readSettings(page)
  return out
}

function validBackup(overrides: Record<string, unknown> = {}) {
  return {
    app: 'poker-tracker',
    schemaVersion: 1,
    exportedAt: '2026-09-28T21:05:00+08:00',
    sessions: fixtureSessions,
    venues,
    stakes,
    settings: {},
    ...overrides,
  }
}

test.describe('8.4 / 8.5 匯出 → 清除 → 匯入', () => {
  test('匯出 JSON → 清除所有資料 → 匯入，四張表逐欄完全還原', async ({ page }) => {
    await disableShare(page)
    await seedAll(page)
    const before = await snapshot(page)

    await openSettings(page)
    await expect(page.getByTestId('last-backup')).toHaveText('從未備份')
    const { download, body } = await clickAndDownload(page, '匯出備份（JSON）')
    expect(download.suggestedFilename()).toMatch(/^poker-backup-\d{8}-\d{4}\.json$/)
    await expect(page.getByTestId('global-toast-text')).toHaveText('已匯出備份')
    const backup = JSON.parse(body.toString('utf8'))
    expect(Object.keys(backup)).toEqual(['app', 'schemaVersion', 'exportedAt', 'sessions', 'venues', 'stakes', 'settings'])
    expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
    // settings 不含 recordDraft 與 lastBackupAt
    expect(backup.settings).toEqual({
      lastType: 'mtt',
      lastVenueByType: { cash: V_6BET, mtt: null },
      lastStakeId: S_50,
      profitColorScheme: 'greenGain',
    })
    // 匯出後 lastBackupAt = exportedAt，畫面同步更新
    expect((await readSettings(page)).lastBackupAt).toBe(backup.exportedAt)
    await expect(page.getByTestId('last-backup')).not.toHaveText('從未備份')

    // 先進紀錄列表建立快取，確認清除後快取失效
    await openList(page)
    await expect(rows(page)).toHaveCount(7)
    await openSettings(page)
    await clearAllData(page)
    await expect(page.getByTestId('global-toast-text')).toHaveText('已清除所有資料')
    for (const store of ['sessions', 'venues', 'stakes', 'settings'] as StoreName[]) {
      expect(await readStore(page, store), store).toEqual([])
    }
    await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'redGain')
    await openList(page)
    await expect(page.getByText('還沒有紀錄')).toBeVisible()

    await openSettings(page)
    await chooseImportFile(page, body)
    const sheet = page.getByRole('dialog', { name: '匯入備份？' })
    await expect(sheet.getByTestId('import-current-count')).toHaveText('0 場')
    await expect(sheet.getByTestId('import-backup-count')).toHaveText('7 場')
    await expect(sheet).toContainText('匯入會取代目前所有資料，建議先匯出備份')
    await sheet.getByRole('button', { name: '匯入', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByTestId('global-toast-text')).toHaveText('已匯入 7 場紀錄')

    const after = await snapshot(page)
    expect(after.sessions).toEqual(before.sessions)
    expect(after.venues).toEqual(before.venues)
    expect(after.stakes).toEqual(before.stakes)
    // settings：recordDraft 不還原，lastBackupAt = 備份檔的 exportedAt，其他完全相同
    const { recordDraft: _draft, ...rest } = before.settings as Record<string, unknown>
    void _draft
    expect(after.settings).toEqual({ ...rest, lastBackupAt: backup.exportedAt })
    // 盈虧顏色依匯入的設定重新套用
    await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'greenGain')
    await expect(page.getByRole('group', { name: '盈虧顏色' }).getByRole('button', { name: '綠色為贏、紅色為輸' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // 紀錄列表顯示匯入的資料
    await openList(page)
    await expect(rows(page)).toHaveCount(7)
  })

  test('有資料時匯入：確認視窗並排目前與備份檔的場次數與備份時間；取消不變更', async ({ page }) => {
    await seedAll(page)
    const before = await snapshot(page)
    await openSettings(page)
    await chooseImportFile(page, JSON.stringify(validBackup({ sessions: fixtureSessions.slice(0, 3) })))
    const sheet = page.getByRole('dialog', { name: '匯入備份？' })
    await expect(sheet.getByTestId('import-current-count')).toHaveText('7 場')
    await expect(sheet.getByTestId('import-backup-count')).toHaveText('3 場')
    await expect(sheet.getByTestId('import-backup-time')).toHaveText('備份時間 2026/09/28 21:05')
    // 確認鈕為紅色（danger token）
    const bg = await sheet.getByRole('button', { name: '匯入', exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor)
    const danger = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--color-danger)'
      document.body.append(probe)
      const c = getComputedStyle(probe).backgroundColor
      probe.remove()
      return c
    })
    expect(bg).toBe(danger)
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toHaveCount(0)
    expect(await snapshot(page)).toEqual(before)
  })
})

test.describe('8.5 匯入拒絕：四種情況都正確拒絕且原資料不變', () => {
  const cases: { name: string; content: () => string; reason: string; detail?: RegExp }[] = [
    { name: '格式錯誤（不是 JSON）', content: () => '{ "app": "poker-tracker", ', reason: '檔案不是有效的 JSON' },
    { name: 'app 不符', content: () => JSON.stringify(validBackup({ app: 'other-app' })), reason: '這不是德州記帳的備份檔' },
    {
      name: 'schemaVersion 過新',
      content: () => JSON.stringify(validBackup({ schemaVersion: 2 })),
      reason: '備份檔來自較新版本的 App，請先更新 App 再匯入',
    },
    {
      name: '參照不存在',
      content: () => JSON.stringify(validBackup({ venues: venues.filter((v) => v.id !== V_6BET) })),
      reason: '參照的資料不存在於備份檔內',
      detail: new RegExp(`^sessions 第 1 筆（id: ${fixtureSessions[0]!.id}）：venueId ${V_6BET} 不存在$`),
    },
    {
      name: '資料未通過 Zod（服務費大於買入）',
      content: () =>
        JSON.stringify(
          validBackup({
            sessions: fixtureSessions.map((s, i) => (i === 2 ? { ...s, buyIns: [{ amount: 100, fee: 101 }, ...s.buyIns.slice(1)] } : s)),
          }),
        ),
      reason: '資料未通過檢查',
      detail: new RegExp(`^sessions 第 3 筆（id: ${fixtureSessions[2]!.id}）：buyIns\\[0\\]\\.fee 服務費不可大於買入$`),
    },
  ]

  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await seedAll(page)
      const before = await snapshot(page)
      await openSettings(page)
      await chooseImportFile(page, c.content())
      const sheet = page.getByRole('dialog', { name: '無法匯入' })
      await expect(sheet.getByTestId('import-error-reason')).toHaveText(c.reason)
      if (c.detail) await expect(sheet.getByTestId('import-error-detail')).toHaveText(c.detail)
      else await expect(sheet.getByTestId('import-error-detail')).toHaveCount(0)
      await expect(sheet).toContainText('目前資料未變更')
      // 不會出現匯入確認
      await expect(page.getByRole('dialog', { name: '匯入備份？' })).toHaveCount(0)
      await sheet.getByRole('button', { name: '確定' }).click()
      await expect(sheet).toHaveCount(0)
      expect(await snapshot(page)).toEqual(before)
      await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'greenGain')
    })
  }

  test('同一個檔案可以再次選取', async ({ page }) => {
    await seedAll(page)
    await openSettings(page)
    for (let i = 0; i < 2; i++) {
      await chooseImportFile(page, '[]')
      const sheet = page.getByRole('dialog', { name: '無法匯入' })
      await expect(sheet.getByTestId('import-error-reason')).toHaveText('檔案內容不是備份格式')
      await sheet.getByRole('button', { name: '確定' }).click()
      await expect(sheet).toHaveCount(0)
    }
  })
})

test('8.6 匯出 CSV：BOM、標題列、欄數正確、含逗號與換行的備註不跑欄；不更新 lastBackupAt', async ({ page }) => {
  await disableShare(page)
  await seedAll(page)
  // 備註含逗號、引號與換行
  const tricky = { ...fixtureSessions[0]!, note: '第一行, 逗號\n第二行 "引號"' }
  // 以原生 IndexedDB 直接寫入時 Dexie liveQuery 不會察覺，重新載入讓設定頁取得最新資料
  await putRecords(page, 'sessions', [tricky])
  await page.reload()
  await openSettings(page)
  const { download, body } = await clickAndDownload(page, '匯出 CSV')
  expect(download.suggestedFilename()).toMatch(/^poker-sessions-\d{8}\.csv$/)
  await expect(page.getByTestId('global-toast-text')).toHaveText('已匯出 CSV')
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const text = body.toString('utf8').slice(1)
  expect(text.endsWith('\r\n')).toBe(true)
  const parsed = parseCsv(text)
  expect(parsed).toHaveLength(8)
  expect(parsed[0]).toEqual([
    '日期',
    '開始時',
    '類型',
    '場地',
    '盲注',
    '名稱',
    '進場次數',
    '買入總額',
    '服務費總額',
    '到手金額',
    '盈利',
    '時長（分）',
    '參賽人數',
    '名次',
    '備註',
  ])
  for (const r of parsed) expect(r).toHaveLength(15)
  // 由舊到新：第一列是 7 月的 Summer Cup
  expect(parsed[1]!.slice(0, 6)).toEqual(['2026-07-04', '15', '限時 MTT', '6bet', '', 'Summer Cup'])
  const trickyRow = parsed.find((r) => r[14] === tricky.note)
  expect(trickyRow).toBeTruthy()
  expect(trickyRow!.slice(0, 5)).toEqual(['2026-09-27', '20', '現金桌', '6bet', '50/100'])
  expect((await readSettings(page)).lastBackupAt).toBeUndefined()
})

test.describe('8.4 分享選單', () => {
  test('canShare 為 true：呼叫 navigator.share 分享備份檔，完成後更新 lastBackupAt', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: { name: string; text: string }[] }
      w.__shared = []
      Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true, configurable: true })
      Object.defineProperty(Navigator.prototype, 'share', {
        value: async (data: { files: File[] }) => {
          for (const f of data.files) w.__shared.push({ name: f.name, text: await f.text() })
        },
        configurable: true,
      })
    })
    await seedAll(page)
    await openSettings(page)
    await page.getByRole('button', { name: '匯出備份（JSON）' }).click()
    await expect(page.getByTestId('global-toast-text')).toHaveText('已匯出備份')
    const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; text: string }[] }).__shared)
    expect(shared).toHaveLength(1)
    expect(shared[0]!.name).toMatch(/^poker-backup-\d{8}-\d{4}\.json$/)
    const backup = JSON.parse(shared[0]!.text)
    expect(backup.sessions).toHaveLength(7)
    expect((await readSettings(page)).lastBackupAt).toBe(backup.exportedAt)
  })

  test('分享選單按取消（AbortError）：不更新 lastBackupAt、不顯示錯誤', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true, configurable: true })
      Object.defineProperty(Navigator.prototype, 'share', {
        value: async () => {
          ;(window as unknown as { __shareCalls: number }).__shareCalls =
            ((window as unknown as { __shareCalls?: number }).__shareCalls ?? 0) + 1
          throw new DOMException('Share canceled', 'AbortError')
        },
        configurable: true,
      })
    })
    await seedAll(page)
    await openSettings(page)
    const button = page.getByRole('button', { name: '匯出備份（JSON）' })
    await button.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shareCalls?: number }).__shareCalls)).toBe(1)
    await expect(button).toBeEnabled()
    await expect(page.getByTestId('global-toast-text')).toHaveCount(0)
    expect((await readSettings(page)).lastBackupAt).toBeUndefined()
    await expect(page.getByTestId('last-backup')).toHaveText('從未備份')
  })
})

test.describe('8.7 備份提醒', () => {
  test('從未備份 + 10 場：報表頁頂端出現提醒；✕ 後切頁回來仍不出現；重新開啟 App 再出現；前往備份到設定頁備份區塊', async ({
    page,
  }) => {
    await seed(page, { sessions: manySessions(10) })
    await openReport(page)
    const reminder = page.getByRole('note', { name: '備份提醒' })
    await expect(reminder).toContainText('建議備份資料')
    await reminder.getByRole('button', { name: '關閉' }).click()
    await expect(reminder).toHaveCount(0)
    await openList(page)
    await openReport(page)
    await expect(page.getByTestId('report-content')).toBeVisible()
    await expect(reminder).toHaveCount(0)

    // 重新開啟 App：關閉狀態只存在記憶體
    await page.reload()
    await expect(reminder).toBeVisible()
    // 提醒條在報表頁最上方（標題列下方、頁籤之前）
    const reminderBox = (await reminder.boundingBox())!
    const tabsBox = (await page.getByTestId('report-tabs').boundingBox())!
    expect(reminderBox.y).toBeLessThan(tabsBox.y)

    await reminder.getByRole('link', { name: '前往備份' }).click()
    await expect(heading(page)).toHaveText('設定')
    const section = page.getByRole('region', { name: '資料備份' })
    await expect(section).toBeInViewport()
    await expect(nav(page).getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page')
  })

  test('9 場時不提醒；匯出備份後提醒消失', async ({ page }) => {
    await disableShare(page)
    await seed(page, { sessions: manySessions(9) })
    await openReport(page)
    await expect(page.getByTestId('report-content')).toBeVisible()
    await expect(page.getByTestId('backup-reminder')).toHaveCount(0)

    await putRecords(page, 'sessions', manySessions(1, 0x20000))
    await page.reload()
    await expect(page.getByTestId('backup-reminder')).toBeVisible()
    await openSettings(page)
    await clickAndDownload(page, '匯出備份（JSON）')
    await expect(page.getByTestId('global-toast-text')).toHaveText('已匯出備份')
    await openReport(page)
    await expect(page.getByTestId('report-content')).toBeVisible()
    await expect(page.getByTestId('backup-reminder')).toHaveCount(0)
  })

  test('距上次備份超過 30 天且之後有修改：提醒；沒有修改：不提醒', async ({ page }) => {
    const sessions = manySessions(3)
    await seed(page, { sessions })
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    const lastBackupAt = old.toISOString().replace('Z', '+00:00')
    await putRecords(page, 'settings', [{ key: 'lastBackupAt', value: lastBackupAt }])
    // manySessions 的 updatedAt 在 2024 年，早於備份時間
    await openReport(page)
    await expect(page.getByTestId('report-content')).toBeVisible()
    await expect(page.getByTestId('backup-reminder')).toHaveCount(0)

    const updated = { ...sessions[0]!, updatedAt: new Date(old.getTime() + 60_000).toISOString().replace('Z', '+00:00') }
    await putRecords(page, 'sessions', [updated])
    await page.reload()
    await expect(page.getByTestId('backup-reminder')).toBeVisible()
  })
})
