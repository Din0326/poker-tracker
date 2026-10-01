import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fixtureHands } from './helpers/hands'
import { putRecords, readSettings, readStore, type StoreName } from './helpers/idb'
import { openRecordPage } from './helpers/record'
import { heading, nav, openList, rows, seed } from './helpers/sessions'
import { openSettings } from './helpers/settings'
import { waitForAnimations } from './helpers/layout'

// 8.3 顯示設定、8.8 資料與系統資訊、8.9 清除所有資料、設定頁版面

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

/** 把 CSS 顏色 token 解析成 computed rgb 字串 */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${t})`
    document.body.append(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, token)

test('設定頁區塊順序：常用清單 → 顯示設定 → 資料備份 → 資料與系統資訊 → 清除所有資料（最底部、紅色）', async ({ page }) => {
  await openRecordPage(page)
  await openSettings(page)
  const titles = await page.getByRole('heading', { level: 2 }).allTextContents()
  expect(titles).toEqual(['常用清單', '顯示設定', '資料備份', '資料與系統資訊', '危險操作'])
  // 正式建置不含開發工具
  await expect(page.getByRole('heading', { name: '開發工具' })).toHaveCount(0)
  const clear = page.getByRole('button', { name: '清除所有資料' })
  const bg = await clear.evaluate((el) => getComputedStyle(el).backgroundColor)
  const danger = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--color-danger)'
    document.body.append(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    return c
  })
  expect(bg).toBe(danger)
  // 清除按鈕是 main 內最後一個按鈕
  const last = page.locator('main button').last()
  await expect(last).toHaveText('清除所有資料')
})

test('常用清單入口顯示數量', async ({ page }) => {
  await seed(page)
  await openSettings(page)
  await expect(page.getByRole('link', { name: /場地管理/ })).toContainText('2 個')
  await expect(page.getByRole('link', { name: /盲注管理/ })).toContainText('2 個')
})

test('8.3 盈虧顏色：切換立即生效、範例同步、重新載入後仍保持', async ({ page }) => {
  await openRecordPage(page)
  await openSettings(page)
  const group = page.getByRole('group', { name: '盈虧顏色' })
  const red = group.getByRole('button', { name: '紅色為贏、綠色為輸' })
  const green = group.getByRole('button', { name: '綠色為贏、紅色為輸' })
  await expect(red).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'redGain')
  const gain = page.getByTestId('profit-sample-gain')
  const loss = page.getByTestId('profit-sample-loss')
  await expect(gain).toHaveText('+$1,000')
  await expect(loss).toHaveText('−$1,000')
  const redColor = await tokenColor(page, '--color-red')
  const greenColor = await tokenColor(page, '--color-green')
  await expect(gain).toHaveCSS('color', redColor)
  await expect(loss).toHaveCSS('color', greenColor)

  await green.click()
  await expect(green).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'greenGain')
  await expect(gain).toHaveCSS('color', greenColor)
  await expect(loss).toHaveCSS('color', redColor)
  await expect.poll(async () => (await readSettings(page)).profitColorScheme).toBe('greenGain')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'greenGain')
  await expect(page.getByRole('group', { name: '盈虧顏色' }).getByRole('button', { name: '綠色為贏、紅色為輸' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // 其他頁面同樣套用：重新開啟 App 到新增頁，啟動時依設定套用
  await page.goto('about:blank')
  await openRecordPage(page)
  await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'greenGain')
})

test('8.8 資料與系統資訊：執行模式、持久儲存、資料量、上次備份、App 版本', async ({ page }) => {
  await seed(page)
  await openSettings(page)
  await expect(page.getByTestId('info-run-mode')).toContainText('瀏覽器分頁')
  await expect(page.getByTestId('info-persisted').locator('dd')).toHaveText(/^(已取得|未取得)$/)
  const persisted = await page.evaluate(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : false))
  await expect(page.getByTestId('info-persisted').locator('dd')).toHaveText(persisted ? '已取得' : '未取得')
  await expect(page.getByTestId('info-data-count').locator('dd')).toHaveText('7 場 · 2 個場地 · 2 個盲注 · 手牌 0（完整 0 / 簡易 0）')
  await expect(page.getByTestId('info-last-backup').locator('dd')).toHaveText('從未備份')
  await expect(page.getByTestId('info-version').locator('dd')).toHaveText(pkg.version)
})

test('8.8 主畫面 App 模式顯示「主畫面 App」', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { value: true, configurable: true })
  })
  await page.goto('./#/settings')
  await expect(page.getByTestId('info-run-mode')).toContainText('主畫面 App')
})

test.describe('8.9 清除所有資料', () => {
  test('輸入不符時確認鈕停用；取消不清除', async ({ page }) => {
    await seed(page)
    await openSettings(page)
    await page.getByRole('button', { name: '清除所有資料' }).click()
    const sheet = page.getByRole('dialog', { name: '清除所有資料？' })
    const confirm = sheet.getByRole('button', { name: '清除所有資料' })
    const input = sheet.getByLabel('請輸入「刪除」以確認')
    await expect(confirm).toBeDisabled()
    for (const wrong of ['刪', '删除', '刪除了', 'delete']) {
      await input.fill(wrong)
      await expect(confirm).toBeDisabled()
    }
    await input.press('Enter')
    await expect(sheet).toBeVisible()
    await input.fill('刪除')
    await expect(confirm).toBeEnabled()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toHaveCount(0)
    expect(await readStore(page, 'sessions')).toHaveLength(7)
    // 重新開啟時輸入框為空
    await page.getByRole('button', { name: '清除所有資料' }).click()
    await expect(page.getByRole('dialog').getByLabel('請輸入「刪除」以確認')).toHaveValue('')
  })

  // v2（SPEC-v2-hands 10.6）：一併清除 hands 表與 handDraft
  test('清除後回到首次啟動狀態：五張表（含 hands、handDraft）清空、盈虧顏色回預設、導到新增頁、提示、報表與列表為空', async ({ page }) => {
    await seed(page)
    await putRecords(page, 'hands', fixtureHands())
    await putRecords(page, 'settings', [{ key: 'handDraft', value: { mode: 'simple' } }])
    expect(await readStore(page, 'hands')).toHaveLength(5)
    await page.goto('./#/settings')
    await page.getByRole('group', { name: '盈虧顏色' }).getByRole('button', { name: '綠色為贏、紅色為輸' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'greenGain')
    // 先載入紀錄列表快取
    await openList(page)
    await expect(rows(page)).toHaveCount(7)
    await openSettings(page)
    await page.getByRole('button', { name: '清除所有資料' }).click()
    const sheet = page.getByRole('dialog', { name: '清除所有資料？' })
    await sheet.getByLabel('請輸入「刪除」以確認').fill(' 刪除 ')
    await sheet.getByRole('button', { name: '清除所有資料' }).click()
    await expect(heading(page)).toHaveText('新增場次')
    await expect(page.getByTestId('global-toast-text')).toHaveText('已清除所有資料')
    await expect(nav(page).getByRole('link', { name: '新增' })).toHaveAttribute('aria-current', 'page')
    for (const store of ['sessions', 'venues', 'stakes', 'hands', 'settings'] as StoreName[]) {
      await expect.poll(() => readStore(page, store), store).toEqual([])
    }
    await expect(page.locator('html')).toHaveAttribute('data-profit-scheme', 'redGain')
    // 新增頁為首次狀態：沒有盲注
    await expect(page.getByRole('button', { name: /請先新增盲注/ })).toBeVisible()
    await openList(page)
    await expect(page.getByText('還沒有紀錄')).toBeVisible()
    await nav(page).getByRole('link', { name: '報表' }).click()
    await expect(page.getByText('還沒有紀錄')).toBeVisible()
  })
})

test('設定頁：375–430px 無橫向捲動、觸控區域 ≥ 44×44', async ({ page }) => {
  await seed(page)
  for (const width of [375, 430]) {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('./#/settings')
    await expect(page.getByRole('heading', { level: 2, name: '資料備份' })).toBeVisible()
    await waitForAnimations(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const targets = page.locator('main a:visible, main button:visible')
    const count = await targets.count()
    for (let i = 0; i < count; i++) {
      const box = (await targets.nth(i).boundingBox())!
      expect(box.width, `${width} target ${i}`).toBeGreaterThanOrEqual(44)
      expect(box.height, `${width} target ${i}`).toBeGreaterThanOrEqual(44)
    }
  }
})
