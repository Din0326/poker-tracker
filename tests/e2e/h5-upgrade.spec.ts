import { expect, test } from '@playwright/test'
import { generateSeedData } from '../../src/dev/seed'
import { formatSignedMoney, summarize, type Session } from '../../src/domain'
import { REPORT_TABS, buildMetricCards, buildTypeBreakdown, filterByTab, tabLabel } from '../../src/features/report/reportModel'
import { buildLookup } from '../../src/features/sessions/sessionView'
import { createV2Database, nativeDbInfo, readSettings, readStore } from './helpers/idb'
import { metricValues, openReport, reportTab } from './helpers/report'
import { heading, nav, summary } from './helpers/sessions'

// SPEC-v2-hands 12.3 H5 第 4 項「已有 v1.4 正式資料（version 2）的 App 更新到 v2 後，場次筆數、報表總體盈利與更新前相同」的 E2E：
// 以原生 IndexedDB 建立 v1.4 正式版的資料庫（Dexie version 2，原生版本 20），寫入具代表性的資料
// （200 筆場次：三種類型、約 3 年多個月份、含賣股份、封存與未封存的場地與盲注；v1.4 的設定 key），
// 「更新前」的數字以同一套 domain / 報表函式在 Node 端計算並記錄，再載入新版 App（開啟時執行 version 2 → 3 遷移）比對畫面。

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))

test('12.3 H5 v1.4 → v2 升級：v1.4 正式資料（version 2）載入新版後，場次筆數、報表總體盈利與各頁籤指標與更新前相同，hands 為空表、無資料遺失', async ({ page }) => {
  test.setTimeout(90_000)
  const data = generateSeedData({ count: 200, seed: 20261003, today: '2026-09-30' })
  const sessions: Session[] = data.sessions
  expect(new Set(sessions.map((s) => s.type))).toEqual(new Set(['cash', 'mtt', 'timed_mtt']))
  expect(sessions.some((s) => s.backers.length > 0)).toBe(true)
  const settings = [
    { key: 'lastType', value: 'mtt' },
    { key: 'lastVenueByType', value: { cash: data.venues[0]!.id, mtt: data.venues[1]!.id } },
    { key: 'lastStakeId', value: data.stakes[0]!.id },
    { key: 'lastBackupAt', value: '2026-09-30T12:00:00+08:00' },
    { key: 'profitColorScheme', value: 'greenGain' },
  ]

  // 更新前：以同一套函式計算各頁籤指標卡與總體盈利
  const lookup = buildLookup(data.venues, data.stakes)
  const expectedCards = Object.fromEntries(
    REPORT_TABS.map((tab) => [tab, Object.fromEntries(buildMetricCards(filterByTab(sessions, tab), tab, lookup.stakes).map((c) => [c.key, c.value.text]))]),
  )
  const totalProfit = formatSignedMoney(summarize(sessions).profit)
  expect(expectedCards.all!.profit).toBe(totalProfit)

  // 先開同源的靜態檔（不執行 App），建立 version 2 的資料庫並寫入資料
  await page.goto('./icons/icon-192.png')
  await createV2Database(page, { sessions, venues: data.venues, stakes: data.stakes, settings })
  expect(await nativeDbInfo(page)).toEqual({ version: 20, stores: ['sessions', 'settings', 'stakes', 'venues'] })

  // 載入新版 App：紀錄列表的筆數與總盈利
  await page.goto('./#/sessions')
  await expect(heading(page)).toHaveText('紀錄')
  await expect(summary(page)).toHaveText(`共 ${sessions.length} 場 · ${totalProfit}`)
  expect(await nativeDbInfo(page)).toEqual({ version: 30, stores: ['hands', 'sessions', 'settings', 'stakes', 'venues'] })

  // 報表：總體盈利、各頁籤指標卡、總體的類型小表
  await openReport(page)
  for (const tab of REPORT_TABS) {
    await reportTab(page, tabLabel(tab) as '總體' | '現金桌' | 'MTT' | '限時 MTT').click()
    await expect.poll(() => metricValues(page), { message: tab }).toEqual(expectedCards[tab])
  }
  await reportTab(page, '總體').click()
  const breakdown = page.getByRole('region', { name: '各類型' })
  for (const row of buildTypeBreakdown(sessions)) {
    await expect(breakdown).toContainText(row.profit.text)
  }
  // 遷移不更新 updatedAt，不觸發備份提醒
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0)

  // 手牌頁籤：沒有手牌
  await nav(page).getByRole('link', { name: '手牌' }).click()
  await expect(page.getByText('還沒有手牌紀錄')).toBeVisible()

  // 無資料遺失：四張表逐欄相同（含 backers、updatedAt），hands 為空表
  expect(byId(await readStore<Session>(page, 'sessions'))).toStrictEqual(byId(sessions))
  expect(byId(await readStore<{ id: string }>(page, 'venues'))).toStrictEqual(byId(data.venues))
  expect(byId(await readStore<{ id: string }>(page, 'stakes'))).toStrictEqual(byId(data.stakes))
  expect(await readSettings(page)).toEqual(Object.fromEntries(settings.map((r) => [r.key, r.value])))
  expect(await readStore(page, 'hands')).toEqual([])
})
