import { expect, test } from '@playwright/test'
import { startStaticServer } from './helpers/staticServer'

// 第 2 節 PWA 設定
test('manifest 欄位符合規格', async ({ page, request }) => {
  await page.goto('./')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const res = await request.get(new URL(href!, page.url()).toString())
  expect(res.ok()).toBe(true)
  const manifest = await res.json()
  expect(manifest).toMatchObject({
    name: '德州記帳',
    display: 'standalone',
    start_url: './#/',
    scope: './',
    lang: 'zh-Hant-TW',
  })
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/)
  expect(manifest.background_color).toBe(manifest.theme_color)
  const icons = manifest.icons as { src: string; sizes: string; purpose: string }[]
  expect(icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  )
  for (const icon of icons) {
    const iconRes = await request.get(new URL(icon.src, res.url()).toString())
    expect(iconRes.ok(), icon.src).toBe(true)
    expect(iconRes.headers()['content-type']).toContain('image/png')
  }
})

test('iOS meta 與 apple-touch-icon', async ({ page, request }) => {
  await page.goto('./')
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    'content',
    'black-translucent',
  )
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', '德州記帳')
  const touchIcon = page.locator('link[rel="apple-touch-icon"]')
  await expect(touchIcon).toHaveAttribute('sizes', '180x180')
  const href = await touchIcon.getAttribute('href')
  const res = await request.get(new URL(href!, page.url()).toString())
  expect(res.ok()).toBe(true)
})

test('瀏覽器分頁模式顯示加入主畫面提示，可關閉到下次開啟', async ({ page }) => {
  await page.goto('./')
  const banner = page.getByRole('note')
  await expect(banner).toContainText('建議加入主畫面')
  await banner.getByRole('button', { name: '關閉' }).click()
  await expect(banner).toHaveCount(0)
  const nav = page.getByRole('navigation', { name: '主要分頁' })
  await nav.getByRole('link', { name: '設定' }).click()
  await nav.getByRole('link', { name: '新增' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增場次')
  await expect(page.getByRole('note')).toHaveCount(0)
})

// 10.3 P0「飛航模式下可正常載入」的自動化替代：伺服器關閉後重新整理仍可完整使用
test('service worker 預先快取後，伺服器離線仍可載入', async ({ page }) => {
  const server = await startStaticServer()
  try {
    await page.goto(server.url)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    // 首次載入時頁面尚未受 SW 控制，重新載入一次讓 SW 接管
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  } finally {
    await server.close()
  }

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增場次')
  await page.goto(`${server.url}#/report`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('報表')
  // 圖示等靜態資源也在預先快取內
  const iconOk = await page.evaluate(async () => (await fetch('./icons/icon-192.png')).ok)
  expect(iconOk).toBe(true)
})
