// SPEC-v2-hands 12.3 H5 第 4 項「已有 v1.4 正式資料（version 2）的 App 更新到 v2 後，場次筆數、報表總體盈利與更新前相同
// （自動化測試，同 HC23 加報表比對）」的單元測試（fake-indexeddb）。
// HC23（hands-db-migration.test.ts）以 4 筆場次驗證逐欄不變；本檔改用具代表性的正式資料量：
// 300 筆場次（三種類型、約 3 年、多個月份、含賣股份 backers、封存與未封存的場地與盲注）與 v1.4 的全部設定 key。
// 「更新前」以舊版程式（只宣告 version 1、2 的 Dexie）讀出資料，用同一套 domain / 報表函式計算並記錄；
// 「更新後」以新版 createDb 開啟（執行 version 2 → 3 遷移）後重新計算，兩者必須完全相同。
import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { SCHEMA_V1, SCHEMA_V2, createDb, type PokerDb } from '../../src/db'
import { generateSeedData } from '../../src/dev/seed'
import {
  PERIOD_KINDS,
  buildBackup,
  filterByPeriod,
  shouldShowBackupReminder,
  summarize,
  validateBackup,
  type PeriodFilter,
  type Session,
  type Stake,
  type Venue,
} from '../../src/domain'
import { queryAllData } from '../../src/features/settings/dataTransfer'
import { GROUP_OPTIONS_BY_TAB, buildGroups } from '../../src/features/report/grouping'
import { REPORT_TABS, buildCurve, buildMetricCards, buildTypeBreakdown, filterByTab } from '../../src/features/report/reportModel'
import { buildLookup } from '../../src/features/sessions/sessionView'

const TODAY = '2026-09-30'
const seed = generateSeedData({ count: 300, seed: 20261003, today: TODAY })
/** 上次備份時間：晚於所有場次的 updatedAt（備份後沒有新增或修改；與執行環境時區無關） */
const LAST_BACKUP_AT = new Date(Math.max(...seed.sessions.map((s) => Date.parse(s.updatedAt))) + 60_000).toISOString()

/** v1.4 正式版的 settings（3.5 的全部 key，含草稿與上次備份時間） */
const settingsRows = [
  { key: 'lastType', value: 'cash' },
  { key: 'lastVenueByType', value: { cash: seed.venues[0]!.id, mtt: seed.venues[1]!.id, timed_mtt: null } },
  { key: 'lastStakeId', value: seed.stakes[0]!.id },
  { key: 'lastBackupAt', value: LAST_BACKUP_AT },
  { key: 'profitColorScheme', value: 'greenGain' },
  { key: 'recordDraft', value: { version: 2, type: 'mtt', venueTouched: true, values: { cashOut: '1200' }, backers: [] } },
]

let seq = 0
const names: string[] = []
const dbs: Dexie[] = []
afterEach(async () => {
  for (const d of dbs.splice(0)) d.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})
function dbName(): string {
  const name = `h5-upgrade-${Date.now()}-${++seq}`
  names.push(name)
  return name
}

/** 舊版程式（v1.4 正式版）：只宣告 version(1)、version(2) */
function openV2(name: string): Dexie {
  const old = new Dexie(name)
  old.version(1).stores(SCHEMA_V1)
  old.version(2).stores(SCHEMA_V2)
  dbs.push(old)
  return old
}

async function createV14Database(name: string): Promise<void> {
  const old = openV2(name)
  await old.open()
  await old.table('venues').bulkAdd(seed.venues)
  await old.table('stakes').bulkAdd(seed.stakes)
  await old.table('sessions').bulkAdd(seed.sessions)
  await old.table('settings').bulkAdd(settingsRows)
  old.close()
}

const PERIODS: PeriodFilter[] = PERIOD_KINDS.map((kind) =>
  kind === 'custom' ? { kind, from: '2025-03-01', to: '2025-08-31' } : ({ kind } as PeriodFilter),
)

/**
 * 報表頁會顯示的全部數字（以同一套函式計算）：每個頁籤 × 每個期間的指標卡、累積曲線、每種分組；總體的類型小表；
 * 另記錄總體盈利（Σ 你的盈利）原始數值與場次筆數。
 */
function reportSnapshot(sessions: Session[], venues: Venue[], stakes: Stake[]) {
  const lookup = buildLookup(venues, stakes)
  const views: Record<string, unknown> = {}
  for (const period of PERIODS) {
    const r = filterByPeriod(sessions, period, TODAY)
    if (!r.ok) throw new Error(`期間不合法：${period.kind}`)
    for (const tab of REPORT_TABS) {
      const inTab = filterByTab(r.sessions, tab)
      views[`${period.kind}/${tab}`] = {
        count: inTab.length,
        cards: buildMetricCards(inTab, tab, lookup.stakes),
        curve: buildCurve(inTab),
        groups: Object.fromEntries(GROUP_OPTIONS_BY_TAB[tab].map((by) => [by, buildGroups(inTab, tab, by, lookup, lookup.stakes)])),
      }
    }
  }
  return {
    sessionCount: sessions.length,
    totalProfit: summarize(sessions).profit,
    breakdown: buildTypeBreakdown(sessions),
    views,
  }
}

const byId = <T extends { id: string }>(list: readonly T[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1))
const byKey = <T extends { key: string }>(list: readonly T[]) => [...list].sort((a, b) => (a.key < b.key ? -1 : 1))

describe('12.3 H5 v1.4 → v2 升級（Dexie version 2 → 3，具代表性的正式資料）', () => {
  it('12.3 H5 v1.4 → v2 升級：資料具代表性（三種類型、多個月份、場地、盲注、賣股份、全部設定 key）', () => {
    expect(new Set(seed.sessions.map((s) => s.type))).toEqual(new Set(['cash', 'mtt', 'timed_mtt']))
    expect(new Set(seed.sessions.map((s) => s.startAt.slice(0, 7))).size).toBeGreaterThanOrEqual(24)
    expect(seed.sessions.some((s) => s.backers.length > 0)).toBe(true)
    expect(seed.sessions.some((s) => s.buyIns.length > 1)).toBe(true)
    expect(seed.venues.some((v) => v.archived) && seed.stakes.some((s) => s.archived)).toBe(true)
    expect(seed.sessions.some((s) => s.venueId === null)).toBe(true)
  })

  it('12.3 H5 v1.4 → v2 升級：以新版開啟後場次筆數、總體盈利、各頁籤 × 各期間的指標卡 / 曲線 / 分組與類型小表都與更新前相同；hands 為空表；無資料遺失', async () => {
    const name = dbName()
    await createV14Database(name)

    // 更新前：舊版程式讀出並計算
    const old = openV2(name)
    await old.open()
    const pre = {
      sessions: (await old.table('sessions').toArray()) as Session[],
      venues: (await old.table('venues').toArray()) as Venue[],
      stakes: (await old.table('stakes').toArray()) as Stake[],
      settings: (await old.table('settings').toArray()) as { key: string; value: unknown }[],
    }
    old.close()
    expect(old.verno).toBe(2)
    const before = reportSnapshot(pre.sessions, pre.venues, pre.stakes)
    expect(before.sessionCount).toBe(300)

    // 更新後：新版程式開啟（version 2 → 3）
    const db: PokerDb = createDb(name)
    dbs.push(db)
    await db.open()
    expect(db.verno).toBe(3)
    const post = await queryAllData(db)
    const after = reportSnapshot(post.sessions, post.venues, post.stakes)

    expect(after.sessionCount).toBe(before.sessionCount)
    expect(after.totalProfit).toBe(before.totalProfit)
    expect(after.breakdown).toEqual(before.breakdown)
    expect(Object.keys(after.views)).toHaveLength(PERIODS.length * REPORT_TABS.length)
    for (const key of Object.keys(before.views)) expect(after.views[key], key).toEqual(before.views[key])

    // 無資料遺失：四張表逐欄相同（含 backers、updatedAt），筆數相同；hands 為空表
    expect(byId(post.sessions)).toStrictEqual(byId(seed.sessions))
    expect(byId(post.venues)).toStrictEqual(byId(seed.venues))
    expect(byId(post.stakes)).toStrictEqual(byId(seed.stakes))
    expect(byKey(await db.settings.toArray())).toStrictEqual(byKey(settingsRows))
    expect(post.hands).toEqual([])
    expect(await db.hands.count()).toBe(0)

    // 遷移不更新 updatedAt → 不觸發備份提醒（備份後沒有新增或修改）
    expect(shouldShowBackupReminder({ sessions: post.sessions, hands: post.hands, lastBackupAt: LAST_BACKUP_AT, now: new Date(2026, 11, 31) })).toBe(false)

    // 升級後匯出的備份為 schemaVersion 3、hands 為空陣列，且能通過新版的匯入驗證
    const backup = buildBackup(post, new Date(2026, 9, 3, 12, 0))
    expect(backup.schemaVersion).toBe(3)
    expect(backup.hands).toEqual([])
    const reimport = validateBackup(JSON.parse(JSON.stringify(backup)))
    expect(reimport.ok).toBe(true)
    if (reimport.ok) expect(byId(reimport.backup.sessions)).toStrictEqual(byId(seed.sessions))
  })

  it('12.3 H5 v1.4 → v2 升級：更新前匯出的 v1.4 備份（schemaVersion 2）可由新版匯入，場次逐欄還原、hands 為 []、報表與更新前相同', () => {
    // v1.4 正式版匯出的 JSON（8.4：schemaVersion 2、沒有 hands、settings 不含 recordDraft 與 lastBackupAt）
    const v14Backup = {
      app: 'poker-tracker',
      schemaVersion: 2,
      exportedAt: '2026-10-03T09:00:00+08:00',
      sessions: byId(seed.sessions),
      venues: seed.venues,
      stakes: seed.stakes,
      settings: Object.fromEntries(settingsRows.filter((r) => r.key !== 'recordDraft' && r.key !== 'lastBackupAt').map((r) => [r.key, r.value])),
    }
    const result = validateBackup(JSON.parse(JSON.stringify(v14Backup)))
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.backup.schemaVersion).toBe(3)
    expect(result.backup.hands).toEqual([])
    expect(byId(result.backup.sessions)).toStrictEqual(byId(seed.sessions))
    expect(reportSnapshot(result.backup.sessions, result.backup.venues, result.backup.stakes)).toEqual(
      reportSnapshot(seed.sessions, seed.venues, seed.stakes),
    )
  })
})
