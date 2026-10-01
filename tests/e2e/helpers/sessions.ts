import { expect, type Page } from '@playwright/test'
import type { Backer, Session, Stake, Venue } from '../../../src/domain/types'
import { putRecords } from './idb'
import { openRecordPage } from './record'

// P3 紀錄列表 / 詳情測試用的固定資料與操作捷徑

export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export const V_6BET = uuid(0x101)
export const V_OLD = uuid(0x102)
export const S_50 = uuid(0x201)
export const S_100 = uuid(0x202)

export const venues: Venue[] = [
  { id: V_6BET, name: '6bet', archived: false, sortOrder: 0 },
  { id: V_OLD, name: '舊場館', archived: true, sortOrder: 1 },
]

export const stakes: Stake[] = [
  { id: S_50, sb: 50, bb: 100, archived: false, sortOrder: 0 },
  { id: S_100, sb: 100, bb: 200, archived: true, sortOrder: 1 },
]

const base = {
  stakeId: null,
  venueId: null,
  name: null,
  note: null,
  fieldSize: null,
  finishPlace: null,
  backers: [] as Backer[],
} as const

function ts(value: string): { createdAt: string; updatedAt: string } {
  return { createdAt: value, updatedAt: value }
}

/**
 * 7 筆場次，跨 3 個月。排序（新到舊）：c2、c1（同 startAt，c2 較晚建立）、m1、t1、a1、a2、old1
 * - 2026 年 9 月：4 場 · +$1,400（−1,000、+2,000、+2,400、−2,000）
 * - 2026 年 8 月：2 場 · +$2,600（+6,000、−3,400）
 * - 2026 年 7 月：1 場 · +$4,400
 * - 合計 7 場 · +$8,400
 */
export const fixture = {
  c1: {
    ...base,
    id: uuid(1),
    type: 'cash',
    startAt: '2026-09-27T20:00',
    durationMin: 270,
    buyIns: [{ amount: 10000, fee: 300 }],
    cashOut: 12000,
    stakeId: S_50,
    venueId: V_6BET,
    note: '第一行\n第二行',
    ...ts('2026-09-28T02:00:00+08:00'),
  },
  c2: {
    ...base,
    id: uuid(2),
    type: 'cash',
    startAt: '2026-09-27T20:00',
    durationMin: 120,
    buyIns: [{ amount: 5000, fee: 0 }],
    cashOut: 4000,
    stakeId: S_50,
    ...ts('2026-09-28T03:00:00+08:00'),
  },
  m1: {
    ...base,
    id: uuid(3),
    type: 'mtt',
    startAt: '2026-09-14T13:00',
    durationMin: 375,
    buyIns: [
      { amount: 3400, fee: 400 },
      { amount: 3200, fee: 200 },
    ],
    cashOut: 9000,
    venueId: V_6BET,
    name: '週日賽',
    note: '第 3 級別 re-entry',
    fieldSize: 180,
    finishPlace: 12,
    createdAt: '2026-09-14T20:00:00+08:00',
    updatedAt: '2026-09-15T09:30:00+08:00',
  },
  t1: {
    ...base,
    id: uuid(4),
    type: 'timed_mtt',
    startAt: '2026-09-01T00:00',
    durationMin: 90,
    buyIns: [{ amount: 2000, fee: 0 }],
    cashOut: 0,
    ...ts('2026-09-01T02:00:00+08:00'),
  },
  a1: {
    ...base,
    id: uuid(5),
    type: 'cash',
    startAt: '2026-08-31T23:00',
    durationMin: 300,
    buyIns: [{ amount: 20000, fee: 500 }],
    cashOut: 26000,
    stakeId: S_100,
    venueId: V_OLD,
    ...ts('2026-09-01T04:00:00+08:00'),
  },
  a2: {
    ...base,
    id: uuid(6),
    type: 'mtt',
    startAt: '2026-08-15T19:00',
    durationMin: 240,
    buyIns: [{ amount: 3400, fee: 400 }],
    cashOut: 0,
    venueId: V_OLD,
    name: '週日賽',
    fieldSize: 100,
    ...ts('2026-08-15T23:00:00+08:00'),
  },
  old1: {
    ...base,
    id: uuid(7),
    type: 'timed_mtt',
    startAt: '2026-07-04T15:00',
    durationMin: 180,
    buyIns: [{ amount: 1100, fee: 100 }],
    cashOut: 5500,
    venueId: V_6BET,
    name: 'Summer Cup',
    note: 'Final table',
    ...ts('2026-07-04T18:00:00+08:00'),
  },
} satisfies Record<string, Session>

export const fixtureSessions: Session[] = Object.values(fixture)
export const fixtureOrder = ['c2', 'c1', 'm1', 't1', 'a1', 'a2', 'old1'].map(
  (k) => fixture[k as keyof typeof fixture].id,
)

/** 開啟 App（建立資料庫）後寫入場地、盲注、場次 */
export async function seed(
  page: Page,
  data: { venues?: Venue[]; stakes?: Stake[]; sessions: Session[] } = {
    venues,
    stakes,
    sessions: fixtureSessions,
  },
): Promise<void> {
  await openRecordPage(page)
  if (data.venues?.length) await putRecords(page, 'venues', data.venues)
  if (data.stakes?.length) await putRecords(page, 'stakes', data.stakes)
  // 大量資料分段寫入，避免單次 evaluate 參數過大
  for (let i = 0; i < data.sessions.length; i += 1000) {
    await putRecords(page, 'sessions', data.sessions.slice(i, i + 1000))
  }
}

export const nav = (page: Page) => page.getByRole('navigation', { name: '主要分頁' })
export const rows = (page: Page) => page.getByTestId('session-row')
export const heading = (page: Page) => page.getByRole('heading', { level: 1 })
export const hashPath = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace(/^#/, ''))

/** 以分頁列進入紀錄列表並等資料出現 */
export async function openList(page: Page): Promise<void> {
  await nav(page).getByRole('link', { name: '紀錄' }).click()
  await expect(heading(page)).toHaveText('紀錄')
  await expect(page.getByTestId('list-summary').or(page.getByText('還沒有紀錄'))).toBeVisible()
}

export async function rowIds(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-session-id') ?? ''))
}

/** 點列表中的某一筆進入詳情 */
export async function openDetail(page: Page, id: string): Promise<void> {
  await page.locator(`[data-session-id="${id}"]`).click()
  await expect(heading(page)).toHaveText('場次詳情')
  await expect(page.getByTestId('detail-profit')).toBeVisible()
}

export const typeFilter = (page: Page, label: '全部' | '現金桌' | 'MTT' | '限時 MTT') =>
  page.getByRole('group', { name: '類型' }).getByRole('button', { name: label, exact: true })

export const monthHeaders = (page: Page) => page.getByTestId('month-header')
export const summary = (page: Page) => page.getByTestId('list-summary')
