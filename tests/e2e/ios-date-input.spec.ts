import { expect, test, type Locator, type Page } from '@playwright/test'
import { waitForAnimations } from './helpers/layout'
import { openReport } from './helpers/report'
import { openList, seed } from './helpers/sessions'

// iOS 日期欄位不溢出（iPhone 實機回報：開始時間的日期框蓋到小時選單、自訂期間起日框蓋到迄日框且迄日超出畫面）
//
// 注意：Windows 上的 Playwright WebKit 不會重現這個溢出——它的原生日期控制項繪製與 iOS 不同，
// 沒有 iOS 那個「保留原生外觀時忽略 width / min-width 的固有最小寬度」。
// 所以下面的版面量測（boundingBox）在 Windows 上即使拿掉修正也會通過，只是防止版面本身寫壞；
// 真正能防止回歸的是 computed style 檢查：日期框必須是 appearance: none 且 min-width: 0px，
// 這兩個條件就是 iOS 上不溢出的前提。

type Box = { x: number; y: number; width: number; height: number }

const EPS = 0.5

function expectInside(inner: Box, outer: Box, label: string) {
  expect(inner.x, `${label} 左緣`).toBeGreaterThanOrEqual(outer.x - EPS)
  expect(inner.x + inner.width, `${label} 右緣`).toBeLessThanOrEqual(outer.x + outer.width + EPS)
}

function expectNoOverlap(a: Box, b: Box, label: string) {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  expect(overlapX > EPS && overlapY > EPS, `${label} 重疊`).toBe(false)
}

/** 日期框：在父格內、右緣不超過 viewport，並具備 iOS 不溢出所需的 computed style */
async function checkDateInput(input: Locator, width: number, label: string): Promise<Box> {
  const box = (await input.boundingBox())!
  const parent = (await input.locator('xpath=..').boundingBox())!
  expectInside(box, parent, `${label} 相對父格`)
  expect(box.x + box.width, `${label} 超出 viewport`).toBeLessThanOrEqual(width + EPS)
  const style = await input.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      appearance: cs.getPropertyValue('-webkit-appearance') || cs.getPropertyValue('appearance'),
      minWidth: cs.minWidth,
      fontSize: parseFloat(cs.fontSize),
      textAlign: cs.textAlign,
    }
  })
  // 關鍵回歸檢查：拿掉 index.css 的修正時 appearance 會回到 auto、min-width 回到 auto
  expect(style.appearance, `${label} appearance`).toBe('none')
  expect(style.minWidth, `${label} min-width`).toBe('0px')
  expect(style.textAlign, `${label} 文字靠左`).toBe('left')
  // 高度與其他輸入框一致（inputClass 的 h-12）
  expect(box.height, `${label} 高度`).toBeCloseTo(48, 0)
  expect(style.fontSize, `${label} 字級（< 16px 會觸發 iOS 聚焦放大）`).toBeGreaterThanOrEqual(16)
  return box
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${label} 橫向捲動`).toBeLessThanOrEqual(0)
}

async function checkCustomRange(page: Page, width: number, label: string) {
  await page.getByLabel('期間').selectOption({ label: '自訂' })
  const from = page.getByLabel('起日')
  const to = page.getByLabel('迄日')
  await from.fill('2026-10-01')
  await to.fill('2026-12-31')
  await waitForAnimations(page)
  const a = await checkDateInput(from, width, `${label} 起日`)
  const b = await checkDateInput(to, width, `${label} 迄日`)
  expectNoOverlap(a, b, `${label} 起日與迄日`)
  await expectNoHorizontalScroll(page, label)
}

for (const width of [375, 390, 430]) {
  test(`iOS 日期欄位不溢出：寬度 ${width}px（新增頁開始時間、紀錄與報表自訂期間）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await seed(page)

    // 新增頁：開始時間列（日期 + 小時）
    await page.goto('./#/')
    const date = page.locator('#rf-startDate')
    await expect(date).toBeVisible()
    await date.fill('2026-10-01')
    await waitForAnimations(page)
    const dateBox = await checkDateInput(date, width, '開始日期')
    const hourBox = (await page.locator('#rf-startHour').locator('xpath=..').boundingBox())!
    expectNoOverlap(dateBox, hourBox, '開始日期與小時')
    expect(hourBox.x + hourBox.width, '小時選單超出 viewport').toBeLessThanOrEqual(width + EPS)
    await expectNoHorizontalScroll(page, '新增頁')

    // 紀錄頁、報表頁：自訂期間起迄日
    await openList(page)
    await checkCustomRange(page, width, '紀錄頁')
    await openReport(page)
    await checkCustomRange(page, width, '報表頁')
  })
}
