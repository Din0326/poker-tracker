import { expect, test, type Locator } from '@playwright/test'
import { putRecords, readStore } from './helpers/idb'
import { openRecordPage, saveButton, typeButton } from './helpers/record'

// 10.3 P6「從開啟 App 到儲存一筆現金桌紀錄 ≤ 30 秒」的自動化驗收（使用者決定以自動化取代 iPhone 實機）：
// 模擬日常使用（已有盲注、場地，上次設定指向它們），從冷啟動開始計時，以真人速度完成最常見的一筆。

const VENUE_ID = '00000000-0000-4000-8000-000000006101'
const STAKE_ID = '00000000-0000-4000-8000-000000006201'

/** 真人速度：每次點擊 / 選擇前停 300ms，文字每字 100ms */
const THINK_MS = 300
const KEY_DELAY_MS = 100

test('P6-1 從開啟 App 到儲存一筆現金桌紀錄 ≤ 30 秒（冷啟動、真人速度）', async ({ context, page }) => {
  // 前置：建立資料庫後直接寫入一組盲注、一個場地，並讓 last* 設定指向它們
  await openRecordPage(page)
  await putRecords(page, 'venues', [{ id: VENUE_ID, name: '常去俱樂部', archived: false, sortOrder: 0 }])
  await putRecords(page, 'stakes', [{ id: STAKE_ID, sb: 50, bb: 100, archived: false, sortOrder: 0 }])
  await putRecords(page, 'settings', [
    { key: 'lastType', value: 'cash' },
    { key: 'lastStakeId', value: STAKE_ID },
    { key: 'lastVenueByType', value: { cash: VENUE_ID } },
  ])
  await page.close()

  // 冷啟動：開新頁面載入 App（同一個 context，資料庫與 service worker 都在，等同從主畫面再次開啟）
  const app = await context.newPage()
  let actions = 0
  let keys = 0
  const think = () => app.waitForTimeout(THINK_MS)
  const tap = async (target: Locator) => {
    await think()
    await target.click()
    actions++
  }
  const typeText = async (target: Locator, text: string) => {
    await tap(target)
    await target.pressSequentially(text, { delay: KEY_DELAY_MS })
    keys += text.length
  }
  const choose = async (target: Locator, label: string) => {
    await think()
    await target.selectOption({ label })
    actions++
  }

  const start = Date.now()
  await app.goto('./')

  // 確認預帶：類型為現金桌、盲注為 50/100、場地為上次使用（只看不點）
  await expect(typeButton(app, '現金桌')).toHaveAttribute('aria-pressed', 'true')
  const stakeSelect = app.getByLabel('盲注級別')
  await expect(stakeSelect.locator('option:checked')).toHaveText('50/100')
  await expect(app.getByLabel('場地', { exact: true }).locator('option:checked')).toHaveText('常去俱樂部')

  await typeText(app.getByLabel('買入（含服務費）', { exact: true }), '10000')
  await typeText(app.getByLabel('到手金額'), '12400')
  await choose(app.getByRole('combobox', { name: '時長（小時）' }), '4 時')
  await choose(app.getByRole('combobox', { name: '時長（分鐘）' }), '30 分')
  await tap(saveButton(app))
  await expect(app.getByText(/^已儲存，盈利/)).toBeVisible()
  const elapsedMs = Date.now() - start

  const summary = `總時間 ${(elapsedMs / 1000).toFixed(1)} 秒、操作 ${actions + keys} 次（點擊 / 選擇 ${actions} 次、按鍵 ${keys} 次）`
  console.log(`P6-1 ${summary}`)
  test.info().annotations.push({ type: 'P6-1', description: summary })

  // 儲存的內容正確（盲注、場地沿用預帶值）
  const sessions = await readStore<Record<string, unknown>>(app, 'sessions')
  expect(sessions).toHaveLength(1)
  expect(sessions[0]).toMatchObject({
    type: 'cash',
    stakeId: STAKE_ID,
    venueId: VENUE_ID,
    buyIns: [{ amount: 10000, fee: 0 }],
    cashOut: 12400,
    durationMin: 270,
  })
  expect(elapsedMs).toBeLessThanOrEqual(30_000)
})
