import { expect, test, type Page } from '@playwright/test'
import { readSettings, readStore } from './helpers/idb'
import {
  addStakeInline,
  addVenueInline,
  buyInInput,
  dialog,
  feeInput,
  openRecordPage,
  saveButton,
  setDuration,
  setStart,
  typeButton,
} from './helpers/record'

// 10.3 P2 新增場次

type StoredSession = Record<string, unknown> & { id: string; venueId: string | null; stakeId: string | null }

async function sessions(page: Page): Promise<StoredSession[]> {
  return readStore<StoredSession>(page, 'sessions')
}

const toast = (page: Page) => page.getByRole('status').filter({ hasText: '已儲存' })

test('三種類型各新增一筆成功，DB 內容與輸入一致', async ({ page }) => {
  await openRecordPage(page)

  // ---- 現金桌 ----
  await expect(typeButton(page, '現金桌')).toHaveAttribute('aria-pressed', 'true')
  await addStakeInline(page, '50', '100')
  await expect(page.getByLabel('盲注級別').locator('option:checked')).toHaveText('50/100')
  await page.getByLabel('買入（含服務費）', { exact: true }).fill('10000')
  await page.getByLabel('服務費', { exact: true }).fill('300')
  await page.getByLabel('到手金額').fill('12400')
  await setStart(page, '2026-01-15', 21)
  await expect(page.getByTestId('start-at-display')).toHaveText('2026/01/15 21 時')
  await setDuration(page, 3, 30)
  await addVenueInline(page, 'A 俱樂部')
  await page.getByLabel('名稱', { exact: true }).fill('週末局')
  await page.getByLabel('備註').fill('備註第一行\n第二行')
  await expect(page.getByTestId('record-preview')).toHaveText('買入 $10,000 · 服務費 $300 · 盈利 +$2,400')
  await saveButton(page).click()
  await expect(toast(page)).toHaveText('已儲存，盈利 +$2,400')

  const [stake] = await readStore<{ id: string; sb: number; bb: number }>(page, 'stakes')
  const [venue] = await readStore<{ id: string; name: string }>(page, 'venues')
  expect(stake).toMatchObject({ sb: 50, bb: 100, archived: false })
  expect(venue).toMatchObject({ name: 'A 俱樂部', archived: false })
  let all = await sessions(page)
  expect(all).toHaveLength(1)
  expect(all[0]).toMatchObject({
    type: 'cash',
    startAt: '2026-01-15T21:00',
    durationMin: 210,
    buyIns: [{ amount: 10000, fee: 300 }],
    cashOut: 12400,
    stakeId: stake!.id,
    venueId: venue!.id,
    name: '週末局',
    note: '備註第一行\n第二行',
    fieldSize: null,
    finishPlace: null,
  })

  // ---- MTT：2 筆買入 + 名次 ----
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('3000')
  await feeInput(page, 1).fill('300')
  await page.getByRole('button', { name: '＋ 再買入' }).click()
  // 新列預填上一列的買入與服務費
  await expect(buyInInput(page, 2)).toHaveValue('3,000')
  await expect(feeInput(page, 2)).toHaveValue('300')
  await buyInInput(page, 2).fill('3200')
  await feeInput(page, 2).fill('200')
  await page.getByLabel('到手金額').fill('0')
  await page.getByLabel('名次').fill('10')
  await page.getByLabel('參賽人數').fill('100')
  await setStart(page, '2026-02-01', 13)
  await setDuration(page, 5, 0)
  await page.getByLabel('場地', { exact: true }).selectOption({ label: 'A 俱樂部' })
  await page.getByLabel('名稱', { exact: true }).fill('週賽')
  await expect(page.getByTestId('record-preview')).toHaveText('買入 $6,200（2 次）· 服務費 $500 · 盈利 −$6,200')
  await saveButton(page).click()
  await expect(toast(page)).toHaveText('已儲存，盈利 −$6,200')
  all = await sessions(page)
  expect(all.find((s) => s.type === 'mtt')).toMatchObject({
    startAt: '2026-02-01T13:00',
    durationMin: 300,
    buyIns: [
      { amount: 3000, fee: 300 },
      { amount: 3200, fee: 200 },
    ],
    cashOut: 0,
    stakeId: null,
    venueId: venue!.id,
    name: '週賽',
    note: null,
    fieldSize: 100,
    finishPlace: 10,
  })

  // ---- 限時 MTT：C1，場地不指定 ----
  await typeButton(page, '限時 MTT').click()
  await buyInInput(page, 1).fill('3400')
  await feeInput(page, 1).fill('400')
  await page.getByRole('button', { name: '＋ 再買入' }).click()
  await buyInInput(page, 2).fill('3200')
  await feeInput(page, 2).fill('200')
  await page.getByLabel('到手金額').fill('9000')
  await setStart(page, '2026-03-10', 0)
  await setDuration(page, 0, 45)
  await page.getByLabel('場地', { exact: true }).selectOption({ label: '不指定' })
  await expect(page.getByLabel('參賽人數')).toHaveCount(0)
  await saveButton(page).click()
  await expect(toast(page)).toHaveText('已儲存，盈利 +$2,400')
  all = await sessions(page)
  expect(all).toHaveLength(3)
  expect(all.find((s) => s.type === 'timed_mtt')).toMatchObject({
    startAt: '2026-03-10T00:00',
    durationMin: 45,
    buyIns: [
      { amount: 3400, fee: 400 },
      { amount: 3200, fee: 200 },
    ],
    cashOut: 9000,
    stakeId: null,
    venueId: null,
    name: null,
    note: null,
    fieldSize: null,
    finishPlace: null,
  })

  // 5.5 更新 last* 設定
  const settings = await readSettings(page)
  expect(settings).toMatchObject({
    lastType: 'timed_mtt',
    lastStakeId: stake!.id,
    lastVenueByType: { cash: venue!.id, mtt: venue!.id, timed_mtt: null },
  })
  expect(settings.recordDraft).toBeUndefined()
})

test('限時 MTT 新增到 20 列後「＋ 再買入」停用；第 2 列起可刪除', async ({ page }) => {
  await openRecordPage(page)
  await typeButton(page, '限時 MTT').click()
  const add = page.getByRole('button', { name: '＋ 再買入' })
  await expect(page.getByRole('button', { name: /刪除第 1 次買入/ })).toHaveCount(0)
  for (let i = 2; i <= 20; i++) {
    await expect(add).toBeEnabled()
    await add.click()
    await expect(buyInInput(page, i)).toBeVisible()
  }
  await expect(add).toBeDisabled()
  await expect(page.getByText('第 20 次', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^刪除第 \d+ 次買入$/ })).toHaveCount(19)
  await page.getByRole('button', { name: '刪除第 20 次買入' }).click()
  await expect(add).toBeEnabled()
})

test('MTT 有 2 筆買入時切到現金桌會跳確認，取消不切換、確定只保留第一筆', async ({ page }) => {
  await openRecordPage(page)
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('3400')
  await feeInput(page, 1).fill('400')
  await page.getByRole('button', { name: '＋ 再買入' }).click()
  await buyInInput(page, 2).fill('3200')
  await page.getByLabel('到手金額').fill('9000')
  await page.getByLabel('名次').fill('3')
  await page.getByLabel('參賽人數').fill('50')

  await typeButton(page, '現金桌').click()
  const sheet = dialog(page)
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute('aria-modal', 'true')
  await expect(sheet.getByRole('heading')).toHaveText('現金桌只有一筆買入，切換後只保留第一筆，確定嗎？')
  await sheet.getByRole('button', { name: '取消' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(typeButton(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  await expect(buyInInput(page, 2)).toHaveValue('3,200')

  // Esc 也可關閉（等同取消）
  await typeButton(page, '現金桌').click()
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(typeButton(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')

  await typeButton(page, '現金桌').click()
  await dialog(page).getByRole('button', { name: '確定' }).click()
  await expect(typeButton(page, '現金桌')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('買入（含服務費）', { exact: true })).toHaveValue('3,400')
  await expect(page.getByLabel('服務費', { exact: true })).toHaveValue('400')
  await expect(page.getByLabel('到手金額')).toHaveValue('9,000')
  await expect(page.getByRole('button', { name: '＋ 再買入' })).toHaveCount(0)

  // 切回 MTT：參賽人數、名次已清空，買入仍為 1 列
  await typeButton(page, 'MTT').click()
  await expect(page.getByLabel('名次')).toHaveValue('')
  await expect(page.getByLabel('參賽人數')).toHaveValue('')
  await expect(buyInInput(page, 2)).toHaveCount(0)
})

test('填到一半重新載入頁面，草稿還原', async ({ page }) => {
  await openRecordPage(page)
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('3400')
  await feeInput(page, 1).fill('400')
  await page.getByRole('button', { name: '＋ 再買入' }).click()
  await page.getByLabel('到手金額').fill('9000')
  await page.getByLabel('名次').fill('7')
  await setDuration(page, 2, 15)
  await page.getByLabel('名稱', { exact: true }).fill('草稿測試')
  await expect
    .poll(async () => (await readSettings(page)).recordDraft, { timeout: 5000 })
    .toMatchObject({
      version: 1,
      type: 'mtt',
      values: { name: '草稿測試' },
    })

  await page.reload()
  await expect(typeButton(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  await expect(buyInInput(page, 1)).toHaveValue('3,400')
  await expect(feeInput(page, 1)).toHaveValue('400')
  await expect(buyInInput(page, 2)).toHaveValue('3,400')
  await expect(page.getByLabel('到手金額')).toHaveValue('9,000')
  await expect(page.getByLabel('名次')).toHaveValue('7')
  await expect(page.getByRole('combobox', { name: '時長（小時）' })).toHaveValue('2')
  await expect(page.getByRole('combobox', { name: '時長（分鐘）' })).toHaveValue('15')
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('草稿測試')

  // 切換分頁再回來也還原
  const nav = page.getByRole('navigation', { name: '主要分頁' })
  await nav.getByRole('link', { name: '報表' }).click()
  await nav.getByRole('link', { name: '新增' }).click()
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('草稿測試')

  // 右上角「清除」：刪除草稿並回到預設值（清除只在與預設值不同時顯示）
  await page.getByRole('button', { name: '清除' }).click()
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('')
  await expect(typeButton(page, '現金桌')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '清除' })).toHaveCount(0)
  await expect.poll(async () => (await readSettings(page)).recordDraft).toBeUndefined()
  await page.reload()
  await expect(typeButton(page, '現金桌')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('')
})

test('儲存後類型、場地、盲注、日期保留，其餘清空', async ({ page }) => {
  await openRecordPage(page)
  await addStakeInline(page, '100', '200')
  await addVenueInline(page, '星光')
  const stakeValue = await page.getByLabel('盲注級別').inputValue()
  const venueValue = await page.getByLabel('場地', { exact: true }).inputValue()
  await page.getByLabel('買入（含服務費）', { exact: true }).fill('20000')
  await page.getByLabel('服務費', { exact: true }).fill('500')
  await page.getByLabel('到手金額').fill('15000')
  await setStart(page, '2026-04-02', 19)
  await setDuration(page, 4, 0)
  await page.getByLabel('名稱', { exact: true }).fill('名稱')
  await page.getByLabel('備註').fill('備註')
  await saveButton(page).click()
  await expect(toast(page)).toHaveText('已儲存，盈利 −$5,000')

  await expect(typeButton(page, '現金桌')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('盲注級別')).toHaveValue(stakeValue)
  await expect(page.getByLabel('場地', { exact: true })).toHaveValue(venueValue)
  await expect(page.getByLabel('開始日期')).toHaveValue('2026-04-02')
  await expect(page.getByRole('combobox', { name: '開始小時' })).toHaveValue('19')
  for (const label of ['買入（含服務費）', '服務費', '到手金額', '名稱', '備註']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('')
  }
  await expect(page.getByRole('combobox', { name: '時長（小時）' })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: '時長（分鐘）' })).toHaveValue('')
  await expect(page.getByTestId('record-preview')).toHaveText('買入 — · 服務費 $0 · 盈利 —')
  // 儲存後表單等於新的預設值：沒有「清除」、不留草稿
  await expect(page.getByRole('button', { name: '清除' })).toHaveCount(0)

  // MTT 儲存後，參賽人數、名次清空、買入回 1 列
  await typeButton(page, 'MTT').click()
  // Q2：儲存後場地視為未手動修改，切換類型改帶該類型上次的場地（MTT 尚無紀錄 → 不指定）
  await expect(page.getByLabel('場地', { exact: true })).toHaveValue('')
  await page.getByLabel('場地', { exact: true }).selectOption({ label: '星光' })
  await buyInInput(page, 1).fill('1000')
  await page.getByRole('button', { name: '＋ 再買入' }).click()
  await page.getByLabel('到手金額').fill('0')
  await page.getByLabel('名次').fill('5')
  await page.getByLabel('參賽人數').fill('20')
  await setDuration(page, 1, 0)
  await saveButton(page).click()
  await expect(toast(page)).toHaveText('已儲存，盈利 −$2,000')
  await expect(typeButton(page, 'MTT')).toHaveAttribute('aria-pressed', 'true')
  await expect(buyInInput(page, 2)).toHaveCount(0)
  await expect(buyInInput(page, 1)).toHaveValue('')
  await expect(page.getByLabel('名次')).toHaveValue('')
  await expect(page.getByLabel('參賽人數')).toHaveValue('')
  await expect(page.getByLabel('場地', { exact: true })).toHaveValue(venueValue)
  await expect.poll(async () => (await readSettings(page)).recordDraft).toBeUndefined()
})

test('行內新增盲注與場地並自動選取；重複與格式錯誤顯示錯誤', async ({ page }) => {
  await openRecordPage(page)

  // 沒有盲注時顯示「請先新增盲注」，點擊直接開啟新增視窗（進頁面不自動彈出）
  await expect(dialog(page)).toHaveCount(0)
  await page.getByRole('button', { name: /請先新增盲注/ }).click()
  let sheet = dialog(page)
  await expect(sheet.getByRole('heading')).toHaveText('新增盲注')
  await expect(sheet.getByLabel('小盲')).toBeFocused()
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet.getByText('小盲至少 1')).toBeVisible()
  await expect(sheet.getByLabel('小盲')).toHaveAttribute('aria-invalid', 'true')
  await sheet.getByLabel('小盲').fill('100')
  await sheet.getByLabel('大盲').fill('50')
  await expect(sheet.getByText('小盲至少 1')).toHaveCount(0)
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet.getByText('大盲不可小於小盲')).toBeVisible()
  await sheet.getByLabel('大盲').fill('200')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByLabel('盲注級別').locator('option:checked')).toHaveText('100/200')

  // 重複的盲注
  await addStakeInline(page, '100', '200', { expectClosed: false })
  sheet = dialog(page)
  await expect(sheet.getByText('這組盲注已存在')).toBeVisible()
  await sheet.getByRole('button', { name: '取消' }).click()
  await expect(sheet).toHaveCount(0)
  await addStakeInline(page, '25', '50')
  await expect(page.getByLabel('盲注級別').locator('option:checked')).toHaveText('25/50')
  // 選單最後一項為「＋ 新增盲注」
  await expect(page.getByLabel('盲注級別').locator('option').last()).toHaveText('＋ 新增盲注')

  // 場地：不指定、新增、錯誤
  const venue = page.getByLabel('場地', { exact: true })
  await expect(venue.locator('option').first()).toHaveText('不指定')
  await expect(venue.locator('option').last()).toHaveText('＋ 新增場地')
  await venue.selectOption({ label: '＋ 新增場地' })
  sheet = dialog(page)
  await expect(sheet.getByRole('heading')).toHaveText('新增場地')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet.getByText('請輸入場地名稱')).toBeVisible()
  await sheet.getByLabel('場地名稱').fill('長'.repeat(31))
  await expect(sheet.getByText('場地名稱最多 30 字')).toBeVisible()
  await sheet.getByLabel('場地名稱').fill('Ace Club')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(venue.locator('option:checked')).toHaveText('Ace Club')

  // 去除前後空白、不分大小寫重複
  await addVenueInline(page, '  ace club ', { expectClosed: false })
  await expect(dialog(page).getByText('場地名稱已存在')).toBeVisible()
  // 點背景關閉
  await page.mouse.click(200, 40)
  await expect(dialog(page)).toHaveCount(0)
  await expect(venue.locator('option:checked')).toHaveText('Ace Club')
  expect(await readStore(page, 'venues')).toHaveLength(1)
  expect(await readStore(page, 'stakes')).toHaveLength(2)
})

test('金額輸入：數字鍵盤、只接受數字、即時千分位、字級 ≥ 16px', async ({ page }) => {
  await openRecordPage(page)
  const amount = page.getByLabel('買入（含服務費）', { exact: true })
  await expect(amount).toHaveAttribute('inputmode', 'numeric')
  // 貼上含 $ 與逗號的文字
  await amount.click()
  await page.keyboard.insertText('$1,234')
  await expect(amount).toHaveValue('1,234')
  // 輸入中即時千分位，尾端連續輸入時游標位置正確
  await amount.fill('')
  await amount.pressSequentially('1234567')
  await expect(amount).toHaveValue('1,234,567')
  await amount.pressSequentially('8')
  await expect(amount).toHaveValue('12,345,678')
  // 非數字字元被忽略
  await amount.pressSequentially('a-.')
  await expect(amount).toHaveValue('12,345,678')

  const inputs = page.locator('input, select, textarea')
  const count = await inputs.count()
  expect(count).toBeGreaterThan(5)
  for (let i = 0; i < count; i++) {
    const size = await inputs.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size, `control ${i}`).toBeGreaterThanOrEqual(16)
  }
  for (const label of ['買入（含服務費）', '服務費', '到手金額']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('inputmode', 'numeric')
  }
  await typeButton(page, 'MTT').click()
  for (const label of ['名次', '參賽人數']) {
    await expect(page.getByLabel(label)).toHaveAttribute('inputmode', 'numeric')
    await page.getByLabel(label).fill('1234')
    // 參賽人數、名次不加千分位
    await expect(page.getByLabel(label)).toHaveValue('1234')
  }
})

test('驗證失敗時捲動到第一個錯誤欄位並 focus；儲存鈕不停用', async ({ page }) => {
  await openRecordPage(page)
  await typeButton(page, 'MTT').click()
  await buyInInput(page, 1).fill('1000')
  await page.getByLabel('到手金額').fill('0')
  await page.getByLabel('名次').fill('3')
  await page.getByLabel('參賽人數').fill('2')
  await setDuration(page, 1, 0)
  await page.getByLabel('名稱', { exact: true }).fill('x'.repeat(51))
  await saveButton(page).click()
  await expect(saveButton(page)).toBeEnabled()
  const place = page.getByLabel('名次')
  await expect(place).toBeFocused()
  await expect(place).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('名次需介於 1 到參賽人數之間')).toBeVisible()
  await expect(page.getByText('字數超過上限')).toBeVisible()
  // 錯誤欄位在固定底部列之上（可見）
  const box = await place.boundingBox()
  const bar = await saveButton(page).boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y)
  expect(await sessions(page)).toHaveLength(0)
})

test('固定底部列在分頁列上方，提示不遮擋儲存鈕', async ({ page }) => {
  await openRecordPage(page)
  await typeButton(page, '限時 MTT').click()
  await buyInInput(page, 1).fill('3400')
  await page.getByLabel('到手金額').fill('5000')
  await setDuration(page, 1, 30)
  await saveButton(page).click()
  await expect(toast(page)).toBeVisible()

  const save = (await saveButton(page).boundingBox())!
  const toastBox = (await toast(page).locator('div').first().boundingBox())!
  const nav = (await page.getByRole('navigation', { name: '主要分頁' }).boundingBox())!
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(save.y)
  expect(save.y + save.height).toBeLessThanOrEqual(nav.y)
  // 提示 3 秒後消失
  await expect(toast(page)).toHaveCount(0, { timeout: 5000 })

  // 最後一個欄位可以捲到固定列之上
  const note = page.getByLabel('備註')
  await note.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const noteBox = (await note.boundingBox())!
  const barTop = (await saveButton(page).boundingBox())!.y
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(barTop)
})

for (const width of [375, 390, 430]) {
  test(`新增頁寬度 ${width}px 無橫向捲動（三種類型與面板）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openRecordPage(page)
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    for (const type of ['現金桌', 'MTT', '限時 MTT'] as const) {
      await typeButton(page, type).click()
      if (type !== '現金桌') {
        await buyInInput(page, 1).fill('99999999')
        await feeInput(page, 1).fill('99999999')
        await page.getByRole('button', { name: '＋ 再買入' }).click()
      }
      await page.getByLabel('到手金額').fill('99999999')
      await saveButton(page).click()
      expect(await overflow(), type).toBeLessThanOrEqual(0)
    }
    await page.getByLabel('場地', { exact: true }).selectOption({ label: '＋ 新增場地' })
    await expect(dialog(page)).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
  })
}
