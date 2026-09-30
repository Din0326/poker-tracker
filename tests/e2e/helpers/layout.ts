import type { Page } from '@playwright/test'

/**
 * 等所有 CSS 動畫（例：子頁推入 anim-push 的 translateX）結束。
 * 動畫進行中元素帶有非整數位移的 transform，Playwright boundingBox 以浮點矩陣換算，
 * 44px 的元素會量到 43.9999985 之類的值；量測觸控區域前必須先等動畫結束。
 */
export async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
}
