import { expect, test, type Page } from '@playwright/test'
import { readStore } from './helpers/idb'
import { groupLabels, openReport } from './helpers/report'
import { fixture, heading, openDetail, openList, rows, seed, stakes, venues, S_50, V_6BET } from './helpers/sessions'
import { manageLabels, moreButton, openActions } from './helpers/settings'
import { openRecordPage } from './helpers/record'
import { waitForAnimations } from './helpers/layout'

// 8.1 場地管理、8.2 盲注管理；10.3 P5「被參照的場地與盲注沒有刪除鈕，封存後歷史資料名稱正常顯示」

async function openVenues(page: Page) {
  await page.goto('./#/settings/venues')
  await expect(heading(page)).toHaveText('場地管理')
  await expect(page.getByTestId('active-list').or(page.getByText('還沒有場地'))).toBeVisible()
}

async function openStakes(page: Page) {
  await page.goto('./#/settings/stakes')
  await expect(heading(page)).toHaveText('盲注管理')
  await expect(page.getByTestId('active-list').or(page.getByText('還沒有盲注'))).toBeVisible()
}

async function addVenue(page: Page, name: string) {
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '新增場地' })
  await sheet.getByLabel('場地名稱').fill(name)
  await sheet.getByRole('button', { name: '儲存' }).click()
  return sheet
}

async function addStake(page: Page, sb: string, bb: string) {
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '新增盲注' })
  await sheet.getByLabel('小盲').fill(sb)
  await sheet.getByLabel('大盲').fill(bb)
  await sheet.getByRole('button', { name: '儲存' }).click()
  return sheet
}

const actionNames = (sheet: ReturnType<Page['getByRole']>) =>
  sheet.getByRole('button').evaluateAll((els) => els.map((e) => e.textContent ?? ''))

test.describe('8.1 場地管理', () => {
  test('空狀態 → 新增、重複名稱錯誤、上移下移、改名、封存 / 取消封存、未參照可刪除', async ({ page }) => {
    await openRecordPage(page)
    await openVenues(page)
    await expect(page.getByText('還沒有場地')).toBeVisible()

    // 新增（空狀態的新增按鈕）
    let sheet = await addVenue(page, ' A 場 ')
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => manageLabels(page)).toEqual(['A 場'])
    await expect(page.getByTestId('manage-usage')).toHaveText('0 場')

    // 重複名稱（不分大小寫、去除前後空白）
    await addVenue(page, 'Ace')
    sheet = await addVenue(page, ' ace ')
    await expect(sheet.getByText('場地名稱已存在')).toBeVisible()
    await expect(sheet.getByLabel('場地名稱')).toHaveAttribute('aria-invalid', 'true')
    await sheet.getByRole('button', { name: '取消' }).click()
    // 空白、超過 30 字
    sheet = await addVenue(page, '   ')
    await expect(sheet.getByText('請輸入場地名稱')).toBeVisible()
    await sheet.getByLabel('場地名稱').fill('a'.repeat(31))
    await expect(sheet.getByText('場地名稱最多 30 字')).toBeVisible()
    await sheet.getByRole('button', { name: '取消' }).click()

    await addVenue(page, 'B 場')
    await expect.poll(() => manageLabels(page)).toEqual(['A 場', 'Ace', 'B 場'])

    // 上移 / 下移；到頂 / 到底時停用
    await expect(page.getByRole('button', { name: '上移 A 場' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '下移 B 場' })).toBeDisabled()
    await page.getByRole('button', { name: '上移 B 場' }).click()
    await expect.poll(() => manageLabels(page)).toEqual(['A 場', 'B 場', 'Ace'])
    await page.getByRole('button', { name: '下移 A 場' }).click()
    await expect.poll(() => manageLabels(page)).toEqual(['B 場', 'A 場', 'Ace'])
    const stored = (await readStore<{ name: string; sortOrder: number }>(page, 'venues')).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(stored.map((v) => v.name)).toEqual(['B 場', 'A 場', 'Ace'])

    // 改名：重複名稱錯誤；成功後更新
    let actions = await openActions(page, 'A 場')
    await actions.getByRole('button', { name: '改名' }).click()
    sheet = page.getByRole('dialog', { name: '場地改名' })
    await expect(sheet.getByLabel('場地名稱')).toHaveValue('A 場')
    await sheet.getByLabel('場地名稱').fill('b 場')
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(sheet.getByText('場地名稱已存在')).toBeVisible()
    await sheet.getByLabel('場地名稱').fill('C 場')
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => manageLabels(page)).toEqual(['B 場', 'C 場', 'Ace'])

    // 封存：移到「已封存」折疊區（預設收合）
    actions = await openActions(page, 'C 場')
    expect(await actionNames(actions)).toEqual(['改名', '封存', '刪除', '取消'])
    await actions.getByRole('button', { name: '封存', exact: true }).click()
    await expect.poll(() => manageLabels(page)).toEqual(['B 場', 'Ace'])
    const archived = page.getByTestId('archived-section')
    await expect(archived).not.toHaveAttribute('open')
    await expect(archived.getByText('已封存（1）')).toBeVisible()
    await expect(page.getByTestId('archived-list')).toBeHidden()
    await archived.getByText('已封存（1）').click()
    await expect(page.getByTestId('archived-list')).toBeVisible()
    await expect.poll(() => manageLabels(page, 'archived')).toEqual(['C 場'])
    actions = await openActions(page, 'C 場')
    await expect(actions).toContainText('已封存：不會出現在新增頁選單')
    expect(await actionNames(actions)).toEqual(['改名', '取消封存', '刪除', '取消'])
    await actions.getByRole('button', { name: '取消封存' }).click()
    await expect.poll(() => manageLabels(page)).toEqual(['B 場', 'C 場', 'Ace'])
    await expect(archived).toHaveCount(0)

    // 刪除未參照的場地：確認 sheet（紅色）
    actions = await openActions(page, 'Ace')
    await actions.getByRole('button', { name: '刪除' }).click()
    const confirm = page.getByRole('dialog', { name: '刪除場地「Ace」？' })
    await confirm.getByRole('button', { name: '刪除' }).click()
    await expect(confirm).toHaveCount(0)
    await expect.poll(() => manageLabels(page)).toEqual(['B 場', 'C 場'])
    expect((await readStore<{ name: string }>(page, 'venues')).map((v) => v.name).sort()).toEqual(['B 場', 'C 場'])

    // 新增頁選單反映變更
    await openRecordPage(page)
    const options = await page.getByLabel('場地', { exact: true }).locator('option').allTextContents()
    expect(options).toEqual(['不指定', 'B 場', 'C 場', '＋ 新增場地'])
  })

  test('被參照的場地：顯示使用場次數，沒有刪除；改名後歷史紀錄顯示新名稱', async ({ page }) => {
    await seed(page)
    await openVenues(page)
    await expect.poll(() => manageLabels(page)).toEqual(['6bet'])
    await expect(page.getByTestId('active-list').getByTestId('manage-usage')).toHaveText('3 場')
    const actions = await openActions(page, '6bet')
    await expect(actions).toContainText('已被 3 場紀錄使用，無法刪除，只能封存')
    expect(await actionNames(actions)).toEqual(['改名', '封存', '取消'])
    await actions.getByRole('button', { name: '改名' }).click()
    const sheet = page.getByRole('dialog', { name: '場地改名' })
    await sheet.getByLabel('場地名稱').fill('6bet 新館')
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(sheet).toHaveCount(0)
    await openList(page)
    await openDetail(page, fixture.c1.id)
    await expect(page.getByText('6bet 新館', { exact: true })).toBeVisible()
  })
})

test.describe('8.2 盲注管理', () => {
  test('空狀態 → 新增、重複錯誤、未參照可修改 sb/bb 與刪除、上下移、封存', async ({ page }) => {
    await openRecordPage(page)
    await openStakes(page)
    await expect(page.getByText('還沒有盲注')).toBeVisible()
    let sheet = await addStake(page, '50', '100')
    await expect(sheet).toHaveCount(0)
    await addStake(page, '100', '200')
    sheet = await addStake(page, '50', '100')
    await expect(sheet.getByText('這組盲注已存在')).toBeVisible()
    await sheet.getByRole('button', { name: '取消' }).click()
    sheet = await addStake(page, '100', '50')
    await expect(sheet.getByText('大盲不可小於小盲')).toBeVisible()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect.poll(() => manageLabels(page)).toEqual(['50/100', '100/200'])

    // 未參照：可修改 sb、bb（驗證同新增）
    let actions = await openActions(page, '100/200')
    expect(await actionNames(actions)).toEqual(['修改小盲、大盲', '封存', '刪除', '取消'])
    await actions.getByRole('button', { name: '修改小盲、大盲' }).click()
    sheet = page.getByRole('dialog', { name: '修改盲注' })
    await expect(sheet.getByLabel('小盲')).toHaveValue('100')
    await expect(sheet.getByLabel('大盲')).toHaveValue('200')
    await sheet.getByLabel('小盲').fill('50')
    await sheet.getByLabel('大盲').fill('100')
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(sheet.getByText('這組盲注已存在')).toBeVisible()
    await sheet.getByLabel('小盲').fill('200')
    await sheet.getByLabel('大盲').fill('400')
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => manageLabels(page)).toEqual(['50/100', '200/400'])

    await page.getByRole('button', { name: '上移 200/400' }).click()
    await expect.poll(() => manageLabels(page)).toEqual(['200/400', '50/100'])

    // 封存後可在封存區上下移（只在同一封存狀態內）
    for (const label of ['200/400', '50/100']) {
      actions = await openActions(page, label)
      await actions.getByRole('button', { name: '封存', exact: true }).click()
      await expect(actions).toHaveCount(0)
    }
    await expect(page.getByText('沒有使用中的項目')).toBeVisible()
    await page.getByText('已封存（2）').click()
    await expect.poll(() => manageLabels(page, 'archived')).toEqual(['200/400', '50/100'])
    await page.getByRole('button', { name: '下移 200/400' }).click()
    await expect.poll(() => manageLabels(page, 'archived')).toEqual(['50/100', '200/400'])

    // 刪除
    actions = await openActions(page, '200/400')
    await actions.getByRole('button', { name: '刪除' }).click()
    await page.getByRole('dialog', { name: '刪除盲注 200/400？' }).getByRole('button', { name: '刪除' }).click()
    await expect.poll(() => manageLabels(page, 'archived')).toEqual(['50/100'])
    expect(await readStore(page, 'stakes')).toHaveLength(1)
  })

  test('被參照的盲注：不顯示修改 sb/bb 與刪除', async ({ page }) => {
    await seed(page)
    await openStakes(page)
    await expect(page.getByTestId('active-list').getByTestId('manage-usage')).toHaveText('2 場')
    const actions = await openActions(page, '50/100')
    await expect(actions).toContainText('已被 2 場紀錄使用，無法修改或刪除，只能封存')
    expect(await actionNames(actions)).toEqual(['封存', '取消'])
    await expect(actions.getByRole('button', { name: '刪除' })).toHaveCount(0)
    await expect(actions.getByRole('button', { name: '修改小盲、大盲' })).toHaveCount(0)
    await actions.getByRole('button', { name: '取消' }).click()
    // 已封存且被參照的 100/200 同樣沒有
    await page.getByText('已封存（1）').click()
    const archivedActions = await openActions(page, '100/200')
    expect(await actionNames(archivedActions)).toEqual(['取消封存', '取消'])
  })
})

test('封存被參照的場地與盲注：詳情頁、紀錄列表、報表分組正常顯示名稱（已封存），新增頁選單不出現', async ({ page }) => {
  await seed(page, { venues, stakes, sessions: [fixture.c1, fixture.m1, fixture.old1] })
  await openVenues(page)
  let actions = await openActions(page, '6bet')
  await actions.getByRole('button', { name: '封存', exact: true }).click()
  await expect.poll(() => manageLabels(page)).toEqual([])
  expect((await readStore<{ id: string; archived: boolean }>(page, 'venues')).find((v) => v.id === V_6BET)?.archived).toBe(true)

  await openStakes(page)
  actions = await openActions(page, '50/100')
  await actions.getByRole('button', { name: '封存', exact: true }).click()
  await expect.poll(() => manageLabels(page)).toEqual([])
  expect((await readStore<{ id: string; archived: boolean }>(page, 'stakes')).find((s) => s.id === S_50)?.archived).toBe(true)

  // 詳情頁：名稱後標註（已封存）
  await openList(page)
  await expect(rows(page)).toHaveCount(3)
  // 紀錄列表：標題照常顯示場地與盲注名稱
  await expect(page.locator(`[data-session-id="${fixture.c1.id}"]`)).toContainText('6bet · 50/100')
  await openDetail(page, fixture.c1.id)
  await expect(page.getByText('6bet（已封存）', { exact: true })).toBeVisible()
  await expect(page.getByText('50/100（已封存）', { exact: true })).toBeVisible()

  // 報表分組
  await openReport(page)
  expect(await groupLabels(page)).toContain('6bet（已封存）')

  // 新增頁選單不出現
  await openRecordPage(page)
  const venueOptions = await page.getByLabel('場地', { exact: true }).locator('option').allTextContents()
  expect(venueOptions.some((o) => o.includes('6bet'))).toBe(false)
  const stakeOptions = await page.getByLabel('盲注級別').locator('option').allTextContents()
  expect(stakeOptions.some((o) => o.includes('50/100'))).toBe(false)
})

test('管理頁：觸控區域 ≥ 44×44、375px 無橫向捲動', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await seed(page)
  for (const open of [openVenues, openStakes]) {
    await open(page)
    await page.getByText(/^已封存（\d+）$/).click()
    await waitForAnimations(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const targets = page.locator('main button:visible, header button:visible, main summary:visible')
    const count = await targets.count()
    expect(count).toBeGreaterThan(3)
    for (let i = 0; i < count; i++) {
      const box = (await targets.nth(i).boundingBox())!
      expect(box.width, `target ${i}`).toBeGreaterThanOrEqual(44)
      expect(box.height, `target ${i}`).toBeGreaterThanOrEqual(44)
    }
    // 圖示鈕有 aria-label
    await expect(moreButton(page, page.url().includes('venues') ? '6bet' : '50/100')).toBeVisible()
  }
})
