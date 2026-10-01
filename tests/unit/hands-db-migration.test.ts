// SPEC-v2-hands 3.12 Dexie version 2 → 3 遷移（12.2 HC23；12.3 H0「Dexie schema 符合 3.12；HC23 通過」）。
// 先以「舊版程式」（只宣告 version(1)、version(2) 的 Dexie，即 v1.4 的正式版）建庫並寫入完整 v1.2 資料（含 backers），
// 再用新版 createDb 開啟，驗證：
// - 既有四張表逐欄完全不變（含 updatedAt、欄位集合），hands 表存在且為空，verno 3，索引符合 3.12
// - upgradeToV3 拋錯時 Dexie 回滾，資料維持 version 2 不變，之後仍可正常升級
import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, createDb, upgradeToV3, type PokerDb } from '../../src/db'
import { shouldShowBackupReminder, type Session, type Stake, type Venue } from '../../src/domain'
import { REPORT_TABS, buildCurve, buildMetricCards, buildTypeBreakdown, filterByTab } from '../../src/features/report/reportModel'
import { buildLookup } from '../../src/features/sessions/sessionView'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
let seq = 0
const names: string[] = []
const dbs: Dexie[] = []

function dbName(): string {
  const name = `hands-migration-${Date.now()}-${++seq}`
  names.push(name)
  return name
}

afterEach(async () => {
  for (const d of dbs.splice(0)) d.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

const venues: Venue[] = [
  { id: uuid(0x101), name: '6bet', archived: false, sortOrder: 0 },
  { id: uuid(0x102), name: '舊場館', archived: true, sortOrder: 1 },
]
const stakes: Stake[] = [
  { id: uuid(0x201), sb: 50, bb: 100, archived: false, sortOrder: 0 },
  { id: uuid(0x202), sb: 1, bb: 2, archived: true, sortOrder: 1 },
]
/** v1.2–v1.4（version 2）的資料：三種類型，含有出資者與沒有出資者的場次 */
const sessions: Session[] = [
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
    backers: [{ name: '阿明', sharePermille: 300, markupPermille: 1100 }],
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
    backers: [
      { name: 'A', sharePermille: 125, markupPermille: 1000 },
      { name: 'B', sharePermille: 200, markupPermille: 1200 },
    ],
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
    backers: [],
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
    backers: [],
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
  { key: 'recordDraft', value: { version: 1, type: 'cash', venueTouched: false, values: { cashOut: '500' } } },
]

/** 舊版程式（v1.4 正式版）：宣告 version(1)、version(2)，建庫並寫入 version 2 的資料 */
async function createV2Database(name: string): Promise<void> {
  const old = new Dexie(name)
  old.version(1).stores(SCHEMA_V1)
  old.version(2).stores(SCHEMA_V2)
  await old.open()
  await old.table('venues').bulkAdd(venues)
  await old.table('stakes').bulkAdd(stakes)
  await old.table('sessions').bulkAdd(sessions)
  await old.table('settings').bulkAdd(settingsRows)
  old.close()
}

/** 以舊版程式（version 2）讀出全部資料與原生版本，用來確認資料仍維持 version 2 */
async function readWithV2(name: string) {
  const old = new Dexie(name)
  old.version(1).stores(SCHEMA_V1)
  old.version(2).stores(SCHEMA_V2)
  dbs.push(old)
  await old.open()
  const result = {
    verno: old.verno,
    storeNames: [...old.backendDB().objectStoreNames].sort(),
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
const byKey = <T extends { key: string }>(list: T[]) => [...list].sort((a, b) => (a.key < b.key ? -1 : 1))

describe('HC23 Dexie version 2 → 3 遷移', () => {
  it('HC23 / H0 驗收「Dexie schema 符合 3.12」：以 version 2 建立含三種類型場次（含 backers）、場地、盲注、設定的資料庫，用新版開啟後所有資料逐欄相同（含 updatedAt），hands 表存在且為空', async () => {
    const name = dbName()
    await createV2Database(name)
    const before = await readWithV2(name)
    expect(before.verno).toBe(2)
    expect(before.storeNames).toEqual(['sessions', 'settings', 'stakes', 'venues'])

    const db = track(createDb(name))
    await db.open()
    expect(DB_VERSION).toBe(3)
    expect(db.verno).toBe(3)
    // 原生版本 = Dexie version × 10
    expect(db.backendDB().version).toBe(30)

    // 既有四張表：逐欄完全相同（toStrictEqual 也比對欄位集合，遷移不得新增或刪除欄位）
    expect(new Set(sessions.map((s) => s.type))).toEqual(new Set(['cash', 'mtt', 'timed_mtt']))
    expect(byId(await db.sessions.toArray())).toStrictEqual(byId(sessions))
    expect(byId(await db.venues.toArray())).toStrictEqual(byId(venues))
    expect(byId(await db.stakes.toArray())).toStrictEqual(byId(stakes))
    expect(byKey(await db.settings.toArray())).toStrictEqual(byKey(settingsRows))
    expect(byId(await db.sessions.toArray())).toStrictEqual(byId(before.sessions as Session[]))

    // hands 表存在且為空
    expect(await db.hands.count()).toBe(0)
    const idb = db.backendDB()
    expect([...idb.objectStoreNames].sort()).toEqual(['hands', 'sessions', 'settings', 'stakes', 'venues'])

    // 3.12 stores：既有表定義不變，hands 的主鍵與索引
    expect(SCHEMA_V3).toEqual({
      sessions: 'id, type, startAt, venueId, stakeId',
      venues: 'id, name, archived',
      stakes: 'id, archived',
      settings: 'key',
      hands: 'id, playedAt, sessionId, &exportSeq, sourceHandId, *tags',
    })
    const tx = idb.transaction(['sessions', 'venues', 'stakes', 'settings', 'hands'], 'readonly')
    expect([...tx.objectStore('sessions').indexNames].sort()).toEqual(['stakeId', 'startAt', 'type', 'venueId'])
    expect([...tx.objectStore('venues').indexNames].sort()).toEqual(['archived', 'name'])
    expect([...tx.objectStore('stakes').indexNames]).toEqual(['archived'])
    expect([...tx.objectStore('settings').indexNames]).toEqual([])
    const hands = tx.objectStore('hands')
    expect(hands.keyPath).toBe('id')
    expect([...hands.indexNames].sort()).toEqual(['exportSeq', 'playedAt', 'sessionId', 'sourceHandId', 'tags'])
    expect(hands.index('exportSeq').unique).toBe(true)
    expect(hands.index('tags').multiEntry).toBe(true)
    for (const n of ['playedAt', 'sessionId', 'sourceHandId']) {
      expect(hands.index(n).unique).toBe(false)
      expect(hands.index(n).multiEntry).toBe(false)
    }
    // 不為布林欄位、kind、source、gameType、heroPosition 建索引
    for (const n of ['kind', 'source', 'gameType', 'heroPosition', 'mucked']) expect(hands.indexNames.contains(n)).toBe(false)

    // updatedAt 不變 → 遷移不觸發備份提醒
    expect(
      shouldShowBackupReminder({
        sessions: await db.sessions.toArray(),
        hands: await db.hands.toArray(),
        lastBackupAt: '2026-09-30T12:00:00+08:00',
        now: new Date(2026, 11, 31),
      }),
    ).toBe(false)
  })

  it('HC23 遷移後報表總體與各頁籤指標、類型小表、曲線與遷移前完全相同', async () => {
    const name = dbName()
    await createV2Database(name)
    const before = await readWithV2(name)
    const preSessions = before.sessions as Session[]
    const preLookup = buildLookup(before.venues as Venue[], before.stakes as Stake[])
    const db = track(createDb(name))
    const postSessions = await db.sessions.toArray()
    const postLookup = buildLookup(await db.venues.toArray(), await db.stakes.toArray())
    for (const tab of REPORT_TABS) {
      expect(buildMetricCards(filterByTab(postSessions, tab), tab, postLookup.stakes)).toEqual(
        buildMetricCards(filterByTab(preSessions, tab), tab, preLookup.stakes),
      )
      expect(buildCurve(filterByTab(postSessions, tab))).toEqual(buildCurve(filterByTab(preSessions, tab)))
    }
    expect(buildTypeBreakdown(postSessions)).toEqual(buildTypeBreakdown(preSessions))
  })

  it('HC23 upgradeToV3 不讀寫任何既有表（可為空函式）', () => {
    expect(upgradeToV3.length).toBe(1)
    // 以會在被存取時拋錯的替身呼叫：不存取 transaction 的任何表
    const tx = new Proxy({}, { get: () => { throw new Error('upgradeToV3 must not touch the transaction') } })
    expect(() => upgradeToV3(tx as never)).not.toThrow()
  })

  it('HC23 模擬 upgradeToV3 拋錯時 Dexie 回滾，資料維持 version 2（沒有 hands 表、資料逐欄不變）；之後以正常的新版程式開啟仍可完成遷移', async () => {
    const name = dbName()
    await createV2Database(name)
    const before = await readWithV2(name)

    const throwing = track(
      createDb(name, {
        upgradeV3: () => {
          throw new Error('simulated upgrade failure')
        },
      }),
    )
    await expect(throwing.open()).rejects.toThrow()
    throwing.close()
    // 非同步失敗（Promise reject）也回滾
    const rejecting = track(createDb(name, { upgradeV3: () => Promise.reject(new Error('simulated async failure')) }))
    await expect(rejecting.open()).rejects.toThrow()
    rejecting.close()

    const after = await readWithV2(name)
    expect(after).toStrictEqual(before)
    expect(after.verno).toBe(2)
    expect(after.storeNames).toEqual(['sessions', 'settings', 'stakes', 'venues'])

    const db = track(createDb(name))
    await db.open()
    expect(db.verno).toBe(3)
    expect(await db.hands.count()).toBe(0)
    expect(byId(await db.sessions.toArray())).toStrictEqual(byId(sessions))
  })

  it('全新安裝直接建立 version 3（含 hands 表）', async () => {
    const db = track(createDb(dbName()))
    await db.open()
    expect(db.verno).toBe(3)
    expect([...db.backendDB().objectStoreNames].sort()).toEqual(['hands', 'sessions', 'settings', 'stakes', 'venues'])
  })
})
