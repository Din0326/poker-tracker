import { expect, test, type Page } from '@playwright/test'
import type { Hand } from '../../src/domain/hands'
import type { Session } from '../../src/domain/types'
import { buildMetricCards } from '../../src/features/report/reportModel'
import { buildLookup } from '../../src/features/sessions/sessionView'
import { H_79, H_MEMO, H_MTT, fixtureHands } from './helpers/hands'
import { putRecords, readSettings, readStore, type StoreName } from './helpers/idb'
import { metricValues, openReport } from './helpers/report'
import {
  fixture,
  fixtureSessions,
  heading,
  openDetail,
  openList,
  rows,
  seed,
  stakedFixture,
  stakedSessions,
  stakes,
  venues,
} from './helpers/sessions'
import { chooseImportFile, clearAllData, clickAndDownload, disableShare, openSettings } from './helpers/settings'

// SPEC-v2-hands H0：資料層與遷移的 E2E（H0 沒有手牌 UI，手牌以 IndexedDB 直接寫入）

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
const allSessions: Session[] = [...fixtureSessions, ...stakedSessions]

/** 原生 IndexedDB 版本與 object store（含 hands 的索引） */
async function dbInfo(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; handIndexes: { name: string; unique: boolean; multiEntry: boolean }[] }>((resolve, reject) => {
        const req = indexedDB.open('poker-tracker')
        req.onsuccess = () => {
          const db = req.result
          const stores = [...db.objectStoreNames].sort()
          let handIndexes: { name: string; unique: boolean; multiEntry: boolean }[] = []
          if (stores.includes('hands')) {
            const store = db.transaction('hands').objectStore('hands')
            handIndexes = [...store.indexNames].sort().map((n) => {
              const i = store.index(n)
              return { name: n, unique: i.unique, multiEntry: i.multiEntry }
            })
          }
          resolve({ version: db.version, stores, handIndexes })
          db.close()
        }
        req.onerror = () => reject(req.error)
      }),
  )
}

async function snapshot(page: Page) {
  const out: Record<string, unknown> = {}
  for (const store of ['sessions', 'venues', 'stakes', 'hands'] as StoreName[]) out[store] = byId(await readStore<{ id: string }>(page, store))
  out.settings = await readSettings(page)
  return out
}

test('HC23 E2E 遷移：以 version 2 結構寫入 IndexedDB 後載入 App，列表 / 詳情 / 報表正常、資料逐欄一致、hands 表為空', async ({ page }) => {
  // 先開同源的靜態檔（不執行 App，不會建立資料庫），以原生 API 建立 Dexie version 2（原生版本 20）的資料庫，
  // 寫入 v1.2–v1.4 正式版的資料（含 backers）
  await page.goto('./icons/icon-192.png')
  const settingsRows = [
    { key: 'lastType', value: 'mtt' },
    { key: 'profitColorScheme', value: 'greenGain' },
    { key: 'lastBackupAt', value: '2026-09-30T12:00:00+08:00' },
    { key: 'lastStakeId', value: stakes[0]!.id },
  ]
  await page.evaluate(
    async ({ sessions, venues, stakes, settings }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('poker-tracker', 20)
        req.onupgradeneeded = () => {
          const db = req.result
          const s = db.createObjectStore('sessions', { keyPath: 'id' })
          for (const k of ['type', 'startAt', 'venueId', 'stakeId']) s.createIndex(k, k)
          const v = db.createObjectStore('venues', { keyPath: 'id' })
          v.createIndex('name', 'name')
          v.createIndex('archived', 'archived')
          db.createObjectStore('stakes', { keyPath: 'id' }).createIndex('archived', 'archived')
          db.createObjectStore('settings', { keyPath: 'key' })
        }
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['sessions', 'venues', 'stakes', 'settings'], 'readwrite')
          for (const x of sessions) tx.objectStore('sessions').put(x)
          for (const x of venues) tx.objectStore('venues').put(x)
          for (const x of stakes) tx.objectStore('stakes').put(x)
          for (const x of settings) tx.objectStore('settings').put(x)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      })
    },
    { sessions: allSessions, venues, stakes, settings: settingsRows },
  )
  expect((await dbInfo(page)).version).toBe(20)

  // 載入新版 App：開啟時執行 version 2 → 3 遷移
  await page.goto('./#/sessions')
  // v1.6（v1 3.7 升級前的備份提示）：舊版且有資料時先出現提示；本測試驗證升級本身，選【直接更新】（提示與匯出另見 p7-data-protection.spec.ts）
  await expect(page.getByTestId('db-upgrade-prompt')).toBeVisible()
  await page.getByRole('button', { name: '直接更新' }).click()
  await expect(heading(page)).toHaveText('紀錄')
  await expect(rows(page)).toHaveCount(allSessions.length)
  await expect(page.getByTestId('row-sold-badge')).toHaveCount(2)
  await openDetail(page, stakedFixture.s14.id)
  await expect(page.getByTestId('detail-staking')).toBeVisible()
  await openList(page)
  await openDetail(page, fixture.m1.id)
  await expect(page.getByTestId('detail-profit')).toHaveText('+$2,400')

  // 原生版本 30（Dexie version 3），hands 表存在且為空，索引符合 3.12
  const info = await dbInfo(page)
  expect(info.version).toBe(30)
  expect(info.stores).toEqual(['hands', 'sessions', 'settings', 'stakes', 'venues'])
  expect(info.handIndexes).toEqual([
    { name: 'exportSeq', unique: true, multiEntry: false },
    { name: 'playedAt', unique: false, multiEntry: false },
    { name: 'sessionId', unique: false, multiEntry: false },
    { name: 'sourceHandId', unique: false, multiEntry: false },
    { name: 'tags', unique: false, multiEntry: true },
  ])
  expect(await readStore(page, 'hands')).toEqual([])

  // 既有資料逐欄一致（含 updatedAt、backers）
  expect(byId(await readStore<Session>(page, 'sessions'))).toStrictEqual(byId(allSessions))
  expect(byId(await readStore<{ id: string }>(page, 'venues'))).toStrictEqual(byId(venues))
  expect(byId(await readStore<{ id: string }>(page, 'stakes'))).toStrictEqual(byId(stakes))
  expect(await readSettings(page)).toEqual(Object.fromEntries(settingsRows.map((r) => [r.key, r.value])))

  // 報表總體與遷移前（同一份資料以 domain 計算）完全相同；遷移不更新 updatedAt，不觸發備份提醒
  await openReport(page)
  const lookup = buildLookup(venues, stakes)
  const expected = Object.fromEntries(buildMetricCards(allSessions, 'all', lookup.stakes).map((c) => [c.key, c.value.text]))
  expect(await metricValues(page)).toEqual(expected)
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0)
})

test('H0 驗收：匯出 JSON（schemaVersion 3 含 hands）→ 清除所有資料（含 hands、handDraft）→ 匯入，五張表逐欄完全還原', async ({ page }) => {
  await disableShare(page)
  await seed(page, { venues, stakes, sessions: fixtureSessions })
  await putRecords(page, 'hands', fixtureHands())
  await page.goto('./#/settings')
  await page.reload()
  await expect(heading(page)).toHaveText('設定')
  await putRecords(page, 'settings', [
    { key: 'lastHandSeq', value: 6 },
    { key: 'handHeroName', value: 'Din_0326' },
    { key: 'handDraft', value: { mode: 'simple', values: {} } },
    { key: 'profitColorScheme', value: 'greenGain' },
  ])
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: '資料備份' })).toBeVisible()
  const before = await snapshot(page)
  expect(before.hands).toHaveLength(5)

  await openSettings(page)
  const { body } = await clickAndDownload(page, '匯出備份（JSON）')
  await expect(page.getByTestId('global-toast-text')).toHaveText('已匯出備份')
  const backup = JSON.parse(body.toString('utf8'))
  expect(backup.schemaVersion).toBe(3)
  expect(Object.keys(backup)).toEqual(['app', 'schemaVersion', 'exportedAt', 'sessions', 'venues', 'stakes', 'hands', 'settings'])
  expect(backup.hands).toEqual(byId(before.hands as Hand[]))
  // settings 不含 handDraft、recordDraft、lastBackupAt；含 handHeroName、lastHandSeq
  expect(backup.settings).toEqual({ profitColorScheme: 'greenGain', handHeroName: 'Din_0326', lastHandSeq: 6 })

  // 提示條會蓋住頁面底部的按鈕：等它消失再操作
  await expect(page.getByTestId('global-toast-text')).toHaveCount(0)
  await clearAllData(page)
  for (const store of ['sessions', 'venues', 'stakes', 'hands', 'settings'] as StoreName[]) {
    expect(await readStore(page, store), store).toEqual([])
  }

  await openSettings(page)
  await chooseImportFile(page, body)
  const sheet = page.getByRole('dialog', { name: '匯入備份？' })
  await expect(sheet.getByTestId('import-backup-count')).toHaveText('7 場、5 手')
  await sheet.getByRole('button', { name: '匯入', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId('global-toast-text')).toHaveText('已匯入 7 場紀錄、5 手牌')

  const after = await snapshot(page)
  expect(after.sessions).toEqual(before.sessions)
  expect(after.venues).toEqual(before.venues)
  expect(after.stakes).toEqual(before.stakes)
  // hands 逐欄完全還原（含 exportSeq、detail、rawText、時間戳）
  expect(after.hands).toStrictEqual(before.hands)
  // settings：handDraft 不還原；lastBackupAt = exportedAt；lastHandSeq = max(檔案 6, hands 最大 6) = 6
  const { handDraft: _draft, ...rest } = before.settings as Record<string, unknown>
  void _draft
  expect(after.settings).toEqual({ ...rest, lastBackupAt: backup.exportedAt })
})

test('HC22 E2E：exportSeq 重複的 3 版檔案被拒，顯示失敗原因與位置，原資料不變', async ({ page }) => {
  await seed(page, { venues, stakes, sessions: fixtureSessions })
  await putRecords(page, 'hands', fixtureHands())
  await page.reload()
  const before = await snapshot(page)
  await openSettings(page)
  const hands = byId(fixtureHands())
  hands[1] = { ...hands[1]!, exportSeq: hands[0]!.exportSeq }
  const file = { app: 'poker-tracker', schemaVersion: 3, exportedAt: '2026-10-01T21:05:00+08:00', sessions: fixtureSessions, venues, stakes, hands, settings: {} }
  await chooseImportFile(page, JSON.stringify(file))
  const sheet = page.getByRole('dialog', { name: '無法匯入' })
  await expect(sheet.getByTestId('import-error-reason')).toHaveText('手牌的匯出編號重複')
  await expect(sheet.getByTestId('import-error-detail')).toHaveText(
    `hands 第 2 筆（id: ${hands[1]!.id}）：匯出編號 ${hands[0]!.exportSeq} 重複`,
  )
  await sheet.getByRole('button', { name: '確定' }).click()
  expect(await snapshot(page)).toEqual(before)
})

test('10.6 資料量顯示手牌數（完整 / 簡易）', async ({ page }) => {
  await seed(page, { venues, stakes, sessions: fixtureSessions })
  await openSettings(page)
  await expect(page.getByTestId('info-data-count').locator('dd')).toHaveText('7 場 · 2 個場地 · 2 個盲注 · 手牌 0（完整 0 / 簡易 0）')
  await putRecords(page, 'hands', fixtureHands())
  await page.reload()
  await expect(page.getByTestId('info-data-count').locator('dd')).toHaveText('7 場 · 2 個場地 · 2 個盲注 · 手牌 5（完整 3 / 簡易 2）')
})

test('10.5 備份提醒：從未備份且「場次數 + 手牌數」≥ 10 時提醒；9 時不提醒', async ({ page }) => {
  // 4 場 + 5 手 = 9：不提醒
  await seed(page, { venues, stakes, sessions: fixtureSessions.slice(0, 4) })
  await putRecords(page, 'hands', fixtureHands())
  await page.reload()
  await openReport(page)
  await expect(page.getByTestId('report-content')).toBeVisible()
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0)
  // 5 場 + 5 手 = 10：提醒
  await putRecords(page, 'sessions', [fixtureSessions[4]!])
  await page.reload()
  await expect(page.getByTestId('backup-reminder')).toBeVisible()
})

// v2.4：30 天改為 14 天（原本以 31 天前測試，改為 15 天前）
test('10.5 備份提醒：距上次備份超過 14 天，且之後有手牌被修改時提醒', async ({ page }) => {
  // 場次與手牌的 updatedAt 都設在 2024 年，早於備份時間
  const longAgo = '2024-01-01T00:00:00+08:00'
  await seed(page, { venues, stakes, sessions: fixtureSessions.slice(0, 2).map((s) => ({ ...s, updatedAt: longAgo })) })
  const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
  await putRecords(page, 'settings', [{ key: 'lastBackupAt', value: old.toISOString().replace('Z', '+00:00') }])
  // 手牌與場次的 updatedAt 都早於備份時間：不提醒
  await putRecords(page, 'hands', fixtureHands(longAgo))
  await openReport(page)
  await expect(page.getByTestId('report-content')).toBeVisible()
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0)
  // 備份後有一手被修改：提醒
  const updated = fixtureHands(new Date(old.getTime() + 60_000).toISOString().replace('Z', '+00:00'))[0]!
  await putRecords(page, 'hands', [updated])
  await page.reload()
  await expect(page.getByTestId('backup-reminder')).toBeVisible()
})

test('HC24 E2E：刪除場次時底下的手牌轉為獨立（updatedAt 不變），按「復原」後重新掛回', async ({ page }) => {
  await seed(page, { venues, stakes, sessions: fixtureSessions })
  const hands = fixtureHands()
  await putRecords(page, 'hands', hands)
  await openList(page)
  await openDetail(page, fixture.c1.id)
  await page.getByRole('button', { name: '刪除' }).click()
  await page.getByRole('dialog', { name: '刪除這筆紀錄？' }).getByRole('button', { name: '刪除' }).click()
  await expect(heading(page)).toHaveText('紀錄')

  const stored = async () => byId(await readStore<Hand>(page, 'hands'))
  const expectedAfterDelete = byId(hands.map((h) => (h.sessionId === fixture.c1.id ? { ...h, sessionId: null } : h)))
  await expect.poll(stored).toEqual(expectedAfterDelete)
  // 其他場次的手牌（m1）不受影響
  expect((await stored()).find((h) => h.id === H_MTT)?.sessionId).toBe(fixture.m1.id)
  for (const id of [H_79, H_MEMO]) expect((await stored()).find((h) => h.id === id)?.updatedAt).toBe(hands.find((h) => h.id === id)!.updatedAt)

  const toast = page.getByRole('status').filter({ hasText: '已刪除' })
  await toast.getByRole('button', { name: '復原' }).click()
  await expect.poll(stored).toEqual(byId(hands))
  await expect(rows(page)).toHaveCount(fixtureSessions.length)
})

test('開發用 seed：正式建置的設定頁沒有「產生 10,000 手測試手牌」按鈕', async ({ page }) => {
  await page.goto('./#/settings')
  await expect(page.getByRole('heading', { level: 2, name: '資料備份' })).toBeVisible()
  await expect(page.getByRole('button', { name: '產生 10,000 手測試手牌' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '開發工具' })).toHaveCount(0)
})
