import { expect, test } from '@playwright/test'

// 10.3 P0：四個分頁可切換，子頁有返回鈕
const tabs = [
  { label: '新增', path: '/', title: '新增場次' },
  { label: '紀錄', path: '/sessions', title: '紀錄' },
  { label: '報表', path: '/report', title: '報表' },
  { label: '設定', path: '/settings', title: '設定' },
]

const hashPath = (url: string) => new URL(url).hash.replace(/^#/, '')

test('預設進入新增頁', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增場次')
  await expect(page.getByRole('navigation', { name: '主要分頁' }).getByRole('link', { name: '新增' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('四個分頁可切換，當前分頁有標示', async ({ page }) => {
  await page.goto('./')
  const nav = page.getByRole('navigation', { name: '主要分頁' })
  for (const tab of [...tabs].reverse()) {
    await nav.getByRole('link', { name: tab.label }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tab.title)
    expect(hashPath(page.url())).toBe(tab.path)
    await expect(nav.getByRole('link', { name: tab.label })).toHaveAttribute('aria-current', 'page')
    // 分頁根頁面沒有返回鈕
    await expect(page.getByRole('button', { name: '返回' })).toHaveCount(0)
  }
})

for (const title of ['場地管理', '盲注管理']) {
  test(`設定 → ${title}：子頁有返回鈕、分頁列仍顯示`, async ({ page }) => {
    await page.goto('./#/settings')
    await page.getByRole('link', { name: title }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    const nav = page.getByRole('navigation', { name: '主要分頁' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: '返回' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('設定')
  })
}

test('直接開啟子頁網址（無上一頁）時，返回鈕回到上一層', async ({ page }) => {
  await page.goto('./#/sessions/abc')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('場次詳情')
  await page.getByRole('button', { name: '返回' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('紀錄')

  await page.goto('about:blank')
  await page.goto('./#/sessions/abc/edit')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('編輯場次')
  await page.getByRole('button', { name: '返回' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('場次詳情')
  expect(hashPath(page.url())).toBe('/sessions/abc')
})

test('未知路徑導回新增頁', async ({ page }) => {
  await page.goto('./#/nope')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增場次')
})

test('每個頁面記住自己的捲動位置', async ({ page }) => {
  await page.goto('./#/settings')
  // 佔位頁內容不足以捲動，暫時撐高頁面來驗證
  await page.evaluate(() => document.body.style.setProperty('min-height', '5000px'))
  await page.evaluate(() => window.scrollTo(0, 800))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(800)
  const nav = page.getByRole('navigation', { name: '主要分頁' })
  await nav.getByRole('link', { name: '報表' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('報表')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await nav.getByRole('link', { name: '設定' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('設定')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(800)
})
