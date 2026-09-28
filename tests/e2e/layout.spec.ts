import { expect, test } from '@playwright/test'

const pages = ['#/', '#/sessions', '#/report', '#/settings', '#/settings/venues', '#/sessions/x']

// 9.2：375–430px 間不得出現橫向捲動
for (const width of [375, 390, 430]) {
  test(`寬度 ${width}px 無橫向捲動`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    for (const hash of pages) {
      await page.goto(`./${hash}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, hash).toBeLessThanOrEqual(0)
    }
  })
}

test('寬度大於 480px 時內容置中、最大寬度 480px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('./#/settings')
  const content = await page.locator('main').evaluate((el) => el.parentElement!.parentElement!.getBoundingClientRect())
  const navList = await page.getByRole('navigation', { name: '主要分頁' }).locator('ul').boundingBox()
  for (const box of [content, navList]) {
    expect(box).not.toBeNull()
    expect(box!.width).toBeLessThanOrEqual(480)
    expect(Math.abs(box!.x + box!.width / 2 - 512)).toBeLessThanOrEqual(1)
  }
})

test('可點擊元件觸控區域至少 44×44px', async ({ page }) => {
  for (const hash of ['#/', '#/settings', '#/settings/venues']) {
    await page.goto(`./${hash}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    if (hash === '#/') {
      // 新增頁：等表單載入，並切到 MTT、加一列買入，讓刪除鈕與「清除」也出現
      await page.getByRole('button', { name: 'MTT', exact: true }).click()
      await page.getByRole('button', { name: '＋ 再買入' }).click()
      await expect(page.getByRole('button', { name: '清除' })).toBeVisible()
    }
    const targets = page.locator('a:visible, button:visible, select:visible, input:visible, textarea:visible')
    const count = await targets.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const box = await targets.nth(i).boundingBox()
      expect(box!.width, `${hash} target ${i}`).toBeGreaterThanOrEqual(44)
      expect(box!.height, `${hash} target ${i}`).toBeGreaterThanOrEqual(44)
    }
  }
})

// 10.3 P0：瀏海與 Home 指示條不遮住內容。Playwright 無法模擬 env(safe-area-inset-*)，
// 這裡驗證樣式確實套用 safe-area 內距；實際遮擋仍需 iPhone 實機確認
test('標題列與分頁列套用 safe-area 內距', async ({ page }) => {
  await page.goto('./')
  const css = await page.evaluate(() =>
    [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n'),
  )
  for (const side of ['top', 'bottom', 'left', 'right']) {
    expect(css).toContain(`safe-area-inset-${side}`)
  }
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
})
