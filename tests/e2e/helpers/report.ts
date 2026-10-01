import { expect, type Page } from '@playwright/test'
import type { Backer, Session } from '../../../src/domain/types'
import { nav, uuid } from './sessions'

// P4 報表測試用的操作捷徑與資料產生

export const reportTab = (page: Page, label: '總體' | '現金桌' | 'MTT' | '限時 MTT') =>
  page.getByRole('group', { name: '分類' }).getByRole('button', { name: label, exact: true })

export const groupByButton = (page: Page, label: '場地' | '盲注級別' | '名稱') =>
  page.getByRole('group', { name: '分組依據' }).getByRole('button', { name: label, exact: true })

export const metricLabels = (page: Page) => page.getByTestId('metric-label').allTextContents()

/** 指標卡：key（data-metric）→ 顯示文字 */
export async function metricValues(page: Page): Promise<Record<string, string>> {
  return page.getByTestId('metric-card').evaluateAll((els) =>
    Object.fromEntries(
      els.map((el) => [
        el.getAttribute('data-metric') ?? '',
        el.querySelector('[data-testid="metric-value"]')?.textContent ?? '',
      ]),
    ),
  )
}

export const metricValue = (page: Page, key: string) =>
  page.locator(`[data-testid="metric-card"][data-metric="${key}"] [data-testid="metric-value"]`)

/** 分組：顯示名稱清單（依畫面順序） */
export const groupLabels = (page: Page) => page.getByTestId('group-label').allTextContents()

export const groupRow = (page: Page, label: string) =>
  page.getByTestId('group-row').filter({ has: page.getByTestId('group-label').getByText(label, { exact: true }) })

/** 以分頁列進入報表並等內容出現（報表頁是 lazy chunk） */
export async function openReport(page: Page): Promise<void> {
  await nav(page).getByRole('link', { name: '報表' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('報表')
  await expect(page.getByTestId('report-content').or(page.getByText('還沒有紀錄'))).toBeVisible()
}

const base = {
  stakeId: null,
  venueId: null,
  name: null,
  note: null,
  fieldSize: null,
  finishPlace: null,
  backers: [] as Backer[],
} as const

/** 產生 n 筆 MTT 場次（曲線點數測試用），每天一場、盈利交錯正負 */
export function manySessions(n: number, idOffset = 0x10000): Session[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i))
    const date = d.toISOString().slice(0, 10)
    const buy = 1000
    const cashOut = i % 3 === 0 ? 2500 : 0
    return {
      ...base,
      id: uuid(idOffset + i),
      type: 'mtt',
      startAt: `${date}T20:00`,
      durationMin: 120,
      buyIns: [{ amount: buy, fee: 100 }],
      cashOut,
      createdAt: `${date}T23:00:00+08:00`,
      updatedAt: `${date}T23:00:00+08:00`,
    } satisfies Session
  })
}

/** 期間測試（C9、C10）用：單筆現金桌以外的限時 MTT，指定 startAt 與盈利 */
export function timedAt(n: number, startAt: string, profit: number): Session {
  const buy = 1000
  return {
    ...base,
    id: uuid(0x30000 + n),
    type: 'timed_mtt',
    startAt,
    durationMin: 60,
    buyIns: [{ amount: buy, fee: 0 }],
    cashOut: buy + profit,
    createdAt: '2025-01-01T00:00:00+08:00',
    updatedAt: '2025-01-01T00:00:00+08:00',
  }
}
