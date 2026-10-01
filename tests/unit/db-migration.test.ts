// 3.7 Dexie version 1 → 2 遷移（10.3 P5.5 第 1–3 項）。
// v2（SPEC-v2-hands 3.12）：新版程式為 version 3，v1 資料庫開啟時依序執行 1 → 2 → 3；
// 本檔的 1 → 2 檢查不變，只把開啟後的版本號改為 3（version 2 → 3 的 HC23 見 hands-db-migration.test.ts）。
// 先以「舊版程式」（只宣告 version(1) 的 Dexie）建庫寫入資料，再用新版 createDb 開啟，驗證：
// - 每筆場次補上 backers: []，其餘欄位（含 updatedAt）逐欄與遷移前相同；場地、盲注、設定不變
// - 遷移後報表各頁籤指標與遷移前完全相同
// - 遷移失敗時資料維持 version 1 不變
// - versionchange：其他連線要升級時關閉本連線並通知
import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DB_VERSION, SCHEMA_V1, createDb, onDbVersionChange, hasDbVersionChanged, upgradeToV2, type PokerDb } from '../../src/db'
import { shouldShowBackupReminder, type Session, type Stake, type Venue } from '../../src/domain'
import {
  REPORT_TABS,
  buildCurve,
  buildMetricCards,
  buildTypeBreakdown,
  filterByTab,
} from '../../src/features/report/reportModel'
import { buildLookup } from '../../src/features/sessions/sessionView'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
let seq = 0
const names: string[] = []
const dbs: Dexie[] = []

function dbName(): string {
  const name = `migration-${Date.now()}-${++seq}`
  names.push(name)
  return name
}

afterEach(async () => {
  for (const d of dbs.splice(0)) d.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

/** v1（v1.0–v1.1）時期的資料：場次沒有 backers 欄位 */
type V1Session = Omit<Session, 'backers'>

const venues: Venue[] = [
  { id: uuid(0x101), name: '6bet', archived: false, sortOrder: 0 },
  { id: uuid(0x102), name: '舊場館', archived: true, sortOrder: 1 },
]
const stakes: Stake[] = [
  { id: uuid(0x201), sb: 50, bb: 100, archived: false, sortOrder: 0 },
  { id: uuid(0x202), sb: 100, bb: 200, archived: true, sortOrder: 1 },
]
const v1Sessions: V1Session[] = [
  {
    id: uuid(1),
    type: 'cash',
    startAt: '2026-09-27T20:00',
    durationMin: 270,
    buyIns: [{ amount: 10000, fee: 300 }],
    cashOut: 12000,
    stakeId: stakes[0]!.id,
    venueId: venues[0]!.id,
    name: null,
    note: '第一行\n第二行',
    fieldSize: null,
    finishPlace: null,
    createdAt: '2026-09-28T02:00:00+08:00',
    updatedAt: '2026-09-28T02:30:00+08:00',
  },
  {
    id: uuid(2),
    type: 'mtt',
    startAt: '2026-09-14T13:00',
    durationMin: 375,
    buyIns: [
      { amount: 3400, fee: 400 },
      { amount: 3200, fee: 200 },
    ],
    cashOut: 9000,
    stakeId: null,
    venueId: venues[1]!.id,
    name: '週日賽',
    note: null,
    fieldSize: 180,
    finishPlace: 12,
    createdAt: '2026-09-14T20:00:00+08:00',
    updatedAt: '2026-09-15T09:00:00+08:00',
  },
  {
    id: uuid(3),
    type: 'timed_mtt',
    startAt: '2026-08-01T19:00',
    durationMin: 90,
    buyIns: [{ amount: 2000, fee: 0 }],
    cashOut: 0,
    stakeId: null,
    venueId: null,
    name: null,
    note: null,
    fieldSize: null,
    finishPlace: null,
    createdAt: '2026-08-01T21:00:00+08:00',
    updatedAt: '2026-08-01T21:00:00+08:00',
  },
  {
    id: uuid(4),
    type: 'cash',
    startAt: '2026-07-04T18:00',
    durationMin: 120,
    buyIns: [{ amount: 5000, fee: 0 }],
    cashOut: 1000,
    stakeId: stakes[1]!.id,
    venueId: null,
    name: 'Home game',
    note: null,
    fieldSize: null,
    finishPlace: null,
    createdAt: '2026-07-04T21:00:00+08:00',
    updatedAt: '2026-07-04T21:00:00+08:00',
  },
]
const settingsRows = [
  { key: 'lastType', value: 'mtt' },
  { key: 'lastVenueByType', value: { cash: venues[0]!.id, mtt: null } },
  { key: 'lastStakeId', value: stakes[0]!.id },
  { key: 'lastBackupAt', value: '2026-09-30T12:00:00+08:00' },
  { key: 'profitColorScheme', value: 'greenGain' },
  {
    key: 'recordDraft',
    value: {
      version: 1,
      type: 'cash',
      venueTouched: false,
      values: {
        stakeId: '',
        buyIns: [{ amount: '100', fee: '' }],
        cashOut: '',
        fieldSize: '',
        finishPlace: '',
        startDate: '2026-09-30',
        startHour: '20',
        durationH: '',
        durationM: '',
        venueId: '',
        name: '',
        note: '',
      },
    },
  },
]

/** 舊版程式：只宣告 version(1)，建庫並寫入 v1 資料 */
async function createV1Database(name: string): Promise<void> {
  const old = new Dexie(name)
  old.version(1).stores(SCHEMA_V1)
  await old.open()
  await old.table('venues').bulkAdd(venues)
  await old.table('stakes').bulkAdd(stakes)
  await old.table('sessions').bulkAdd(v1Sessions)
  await old.table('settings').bulkAdd(settingsRows)
  old.close()
}

/** 以舊版程式（version 1）讀出全部資料，用來確認資料仍維持 version 1 */
async function readWithV1(name: string) {
  const old = new Dexie(name)
  old.version(1).stores(SCHEMA_V1)
  dbs.push(old)
  await old.open()
  const result = {
    verno: old.verno,
    sessions: await old.table('sessions').toArray(),
    venues: await old.table('venues').toArray(),
    stakes: await old.table('stakes').toArray(),
    settings: await old.table('settings').toArray(),
  }
  old.close()
  return result
}

function track(db: PokerDb): PokerDb {
  dbs.push(db)
  return db
}

const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1))

describe('3.7 Dexie version 1 → 2 遷移', () => {
  it('P5.5-1 schema 符合 3.7 version 2；每筆場次 backers 為 []，其餘欄位（含 updatedAt）逐欄相同；場地、盲注、設定不變', async () => {
    const name = dbName()
    await createV1Database(name)
    const db = track(createDb(name))
    await db.open()
    expect(DB_VERSION).toBe(3)
    expect(db.verno).toBe(3)
    // stores 與 v1 相同（backers 不建索引）
    const tx = db.backendDB().transaction(['sessions', 'venues', 'stakes', 'settings'], 'readonly')
    expect([...tx.objectStore('sessions').indexNames].sort()).toEqual(['stakeId', 'startAt', 'type', 'venueId'])
    expect([...tx.objectStore('venues').indexNames].sort()).toEqual(['archived', 'name'])
    expect([...tx.objectStore('stakes').indexNames]).toEqual(['archived'])

    const sessions = byId(await db.sessions.toArray())
    expect(sessions).toHaveLength(v1Sessions.length)
    // 三種類型至少各 1 筆
    expect(new Set(sessions.map((s) => s.type))).toEqual(new Set(['cash', 'mtt', 'timed_mtt']))
    for (const s of sessions) {
      const before = v1Sessions.find((x) => x.id === s.id)!
      const { backers, ...rest } = s
      expect(backers).toEqual([])
      // 其餘欄位（包含 updatedAt、欄位集合）與遷移前完全相同
      expect(rest).toStrictEqual(before)
      expect(Object.keys(s).sort()).toEqual([...Object.keys(before), 'backers'].sort())
    }
    expect(byId(await db.venues.toArray())).toStrictEqual(byId(venues))
    expect(byId(await db.stakes.toArray())).toStrictEqual(byId(stakes))
    const settings = await db.settings.toArray()
    expect([...settings].sort((a, b) => (a.key < b.key ? -1 : 1))).toStrictEqual(
      [...settingsRows].sort((a, b) => (a.key < b.key ? -1 : 1)),
    )
    // updatedAt 不變 → 遷移不觸發 8.7 備份提醒（lastBackupAt 之後沒有任何修改）
    expect(shouldShowBackupReminder({ sessions, lastBackupAt: '2026-09-30T12:00:00+08:00', now: new Date(2026, 11, 31) })).toBe(false)
  })

  it('已有 backers 陣列的場次不被覆寫（遷移只補缺少的欄位）', async () => {
    const name = dbName()
    const old = new Dexie(name)
    old.version(1).stores(SCHEMA_V1)
    await old.open()
    const withBackers = { ...v1Sessions[1]!, backers: [{ name: 'A', sharePermille: 100, markupPermille: 1200 }] }
    await old.table('sessions').bulkAdd([v1Sessions[0]!, withBackers])
    old.close()
    const db = track(createDb(name))
    expect(await db.sessions.get(withBackers.id)).toStrictEqual(withBackers)
    expect((await db.sessions.get(v1Sessions[0]!.id))?.backers).toEqual([])
  })

  it('P5.5-2 遷移後報表總體與各頁籤指標、類型小表、曲線與遷移前完全相同（同一份資料比對）', async () => {
    const name = dbName()
    await createV1Database(name)
    // 遷移前：以 version 1 讀出的原始資料（沒有 backers 欄位）；沒有賣股即 backers 為空，依 v1.1 口徑計算
    const before = await readWithV1(name)
    const preSessions = (before.sessions as V1Session[]).map((s) => ({ ...s, backers: [] }))
    const preLookup = buildLookup(before.venues as Venue[], before.stakes as Stake[])

    const db = track(createDb(name))
    const postSessions = await db.sessions.toArray()
    const postLookup = buildLookup(await db.venues.toArray(), await db.stakes.toArray())

    for (const tab of REPORT_TABS) {
      const pre = buildMetricCards(filterByTab(preSessions, tab), tab, preLookup.stakes)
      const post = buildMetricCards(filterByTab(postSessions, tab), tab, postLookup.stakes)
      expect(post).toEqual(pre)
      expect(buildCurve(filterByTab(postSessions, tab))).toEqual(buildCurve(filterByTab(preSessions, tab)))
    }
    expect(buildTypeBreakdown(postSessions)).toEqual(buildTypeBreakdown(preSessions))
    // 以手算值再確認一次（v1.1 全額口徑）：2,000 + 2,400 − 2,000 − 4,000 = −1,600，4 場
    const overall = Object.fromEntries(buildMetricCards(postSessions, 'all', postLookup.stakes).map((c) => [c.key, c.value.text]))
    expect(overall).toMatchObject({ profit: '−$1,600', count: '4', winRate: '2/4（50.0%）', totalBuyIn: '$23,600', totalCashOut: '$22,000' })
  })

  it('P5.5-3 遷移失敗（upgrade 拋錯）時 Dexie 回滾，資料維持 version 1 不變', async () => {
    const name = dbName()
    await createV1Database(name)
    const before = await readWithV1(name)
    expect(before.verno).toBe(1)

    // 先實際修改再拋錯：確認已修改的部分也被回滾
    const failing = track(
      createDb(name, {
        upgradeV2: (tx) =>
          Promise.resolve(upgradeToV2(tx)).then(() => {
            throw new Error('simulated upgrade failure')
          }),
      }),
    )
    await expect(failing.open()).rejects.toThrow()
    failing.close()
    const throwing = track(
      createDb(name, {
        upgradeV2: () => {
          throw new Error('simulated upgrade failure')
        },
      }),
    )
    await expect(throwing.open()).rejects.toThrow()
    throwing.close()

    const after = await readWithV1(name)
    expect(after).toStrictEqual(before)
    expect(after.verno).toBe(1)
    for (const s of after.sessions) expect('backers' in s).toBe(false)

    // 之後以正常的新版程式開啟仍可完成遷移
    const db = track(createDb(name))
    await db.open()
    expect(db.verno).toBe(3)
    expect((await db.sessions.toArray()).every((s) => Array.isArray(s.backers))).toBe(true)
  })
})

describe('3.7 versionchange', () => {
  it('其他連線要升級資料庫時：關閉本連線（不擋住升級）並通知顯示「有新版本 · 重新載入」', async () => {
    const name = dbName()
    const onVersionChange = vi.fn()
    const db = track(createDb(name, { onVersionChange }))
    await db.open()
    expect(db.isOpen()).toBe(true)

    // 模擬新版頁面以更高版本開啟（v2 起目前為 Dexie version 3 = 原生版本 30；以 version 4 = 原生版本 40 模擬下一版）
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 40)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('blocked'))
    })
    expect(upgraded.version).toBe(40)
    upgraded.close()
    expect(onVersionChange).toHaveBeenCalledTimes(1)
    expect(db.isOpen()).toBe(false)
    // 不自動重開：舊程式不得繼續寫入
    await expect(db.sessions.toArray()).rejects.toThrow()
  })

  it('預設通知 onDbVersionChange 的訂閱者', async () => {
    const name = dbName()
    const listener = vi.fn()
    const unsubscribe = onDbVersionChange(listener)
    const db = track(createDb(name))
    await db.open()
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 40)
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(hasDbVersionChanged()).toBe(true)
    unsubscribe()
  })
})
