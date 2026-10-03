// v1 3.7「升級前的備份提示」（v1.6，10.3 P7）與 8.4「升級前的備份」：
// - 偵測邏輯：沒有資料庫、已是最新版、舊版沒有資料、舊版有資料（含不支援 indexedDB.databases() 的路徑）
// - 讀取舊資料不觸發升級：讀完後原生版本仍為舊版、object store 不變
// - 升級前的備份 schemaVersion 對應舊資料庫版本（version 1 → 1、version 2 → 2），且能被 parseBackupText / migrateBackup 匯入
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { Dexie } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_VERSION, createDb, dexieVersionOf, inspectBeforeUpgrade, type LegacyData } from '../../src/db'
import {
  CURRENT_SCHEMA_VERSION,
  backupSchemaForDbVersion,
  buildLegacyBackup,
  isoWithOffset,
  migrateBackup,
  parseBackupText,
  serializeBackup,
  type BackupData,
} from '../../src/domain'

type Fixture = {
  sessions: Record<string, unknown>[]
  venues: Record<string, unknown>[]
  stakes: Record<string, unknown>[]
  settings: Record<string, unknown>
}
const readFixture = (file: string) => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')) as Fixture
const V1 = readFixture('backup-v1.json')
const V2 = readFixture('backup-v2.json')

let seq = 0
const names: string[] = []
function dbName(): string {
  const name = `pre-upgrade-${Date.now()}-${++seq}`
  names.push(name)
  return name
}

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

/** 以原生 API 建立舊版資料庫（Dexie version n = 原生 n × 10）的四張表與索引，並寫入資料 */
async function createNativeOld(
  name: string,
  nativeVersion: number,
  data: { sessions?: unknown[]; venues?: unknown[]; stakes?: unknown[]; settings?: { key: string; value: unknown }[] },
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, nativeVersion)
    req.onupgradeneeded = () => {
      const d = req.result
      const s = d.createObjectStore('sessions', { keyPath: 'id' })
      for (const k of ['type', 'startAt', 'venueId', 'stakeId']) s.createIndex(k, k)
      const v = d.createObjectStore('venues', { keyPath: 'id' })
      v.createIndex('name', 'name')
      v.createIndex('archived', 'archived')
      d.createObjectStore('stakes', { keyPath: 'id' }).createIndex('archived', 'archived')
      d.createObjectStore('settings', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['sessions', 'venues', 'stakes', 'settings'], 'readwrite')
    for (const x of data.sessions ?? []) tx.objectStore('sessions').put(x)
    for (const x of data.venues ?? []) tx.objectStore('venues').put(x)
    for (const x of data.stakes ?? []) tx.objectStore('stakes').put(x)
    for (const x of data.settings ?? []) tx.objectStore('settings').put(x)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

const settingsRows = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  Object.entries({ ...settings, ...extra }).map(([key, value]) => ({ key, value }))

/** 原生版本與 object store（不指定版本開啟，不觸發升級） */
async function nativeInfo(name: string): Promise<{ version: number; stores: string[] }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const info = { version: db.version, stores: [...db.objectStoreNames].sort() }
  db.close()
  return info
}

/** 不支援 indexedDB.databases() 的瀏覽器：只轉接 open */
const factoryWithoutDatabases = (): IDBFactory => ({ open: (n: string, v?: number) => indexedDB.open(n, v) }) as unknown as IDBFactory

describe('3.7 升級前提示的偵測（inspectBeforeUpgrade）', () => {
  it('3.7 第 2 步：沒有資料庫（全新安裝）→ none，且不會建立資料庫', async () => {
    const name = dbName()
    expect(await inspectBeforeUpgrade(name, DB_VERSION)).toEqual({ kind: 'none' })
    expect((await indexedDB.databases()).some((d) => d.name === name)).toBe(false)
  })

  it('3.7 第 1 步：不支援 databases() 時以不指定版本開啟；資料庫不存在 → 中止交易、none，不建立資料庫', async () => {
    const name = dbName()
    expect(await inspectBeforeUpgrade(name, DB_VERSION, factoryWithoutDatabases())).toEqual({ kind: 'none' })
    expect((await indexedDB.databases()).some((d) => d.name === name)).toBe(false)
  })

  it('3.7 第 2 步：已是最新版本（Dexie version 3 = 原生 30）→ current，不提示', async () => {
    const name = dbName()
    const db = createDb(name)
    await db.open()
    await db.sessions.put(V2.sessions[0] as never)
    db.close()
    expect(await inspectBeforeUpgrade(name, DB_VERSION)).toEqual({ kind: 'current', nativeVersion: 30 })
    expect(await inspectBeforeUpgrade(name, DB_VERSION, factoryWithoutDatabases())).toEqual({ kind: 'current', nativeVersion: 30 })
  })

  it('3.7 第 4 步：舊版（version 2）但場次、場地、盲注都是 0 筆（只有 settings）→ oldEmpty，不提示', async () => {
    const name = dbName()
    await createNativeOld(name, 20, { settings: settingsRows({ lastType: 'mtt', lastBackupAt: '2026-09-01T00:00:00+08:00' }) })
    expect(await inspectBeforeUpgrade(name, DB_VERSION)).toEqual({ kind: 'oldEmpty', nativeVersion: 20, dexieVersion: 2 })
  })

  it('3.7 第 4 步：舊版只要場次、場地或盲注任一 > 0 → oldWithData（只有 1 個場地也算）', async () => {
    const name = dbName()
    await createNativeOld(name, 20, { venues: [V2.venues[0]] })
    const r = await inspectBeforeUpgrade(name, DB_VERSION)
    expect(r.kind).toBe('oldWithData')
  })

  it('3.7 第 3 步：舊版（version 2）有資料 → oldWithData，原樣讀出四張表；hands 表不存在時為空陣列', async () => {
    const name = dbName()
    await createNativeOld(name, 20, { sessions: V2.sessions, venues: V2.venues, stakes: V2.stakes, settings: settingsRows(V2.settings) })
    for (const factory of [indexedDB, factoryWithoutDatabases()]) {
      const r = await inspectBeforeUpgrade(name, DB_VERSION, factory)
      expect(r.kind).toBe('oldWithData')
      if (r.kind !== 'oldWithData') return
      expect(r.nativeVersion).toBe(20)
      expect(r.dexieVersion).toBe(2)
      const byId = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.id).localeCompare(String(b.id))
      expect([...r.data.sessions].sort(byId)).toStrictEqual([...V2.sessions].sort(byId))
      expect([...r.data.venues].sort(byId)).toStrictEqual([...V2.venues].sort(byId))
      expect([...r.data.stakes].sort(byId)).toStrictEqual([...V2.stakes].sort(byId))
      expect(r.data.hands).toEqual([])
      expect(r.data.settings).toEqual(V2.settings)
    }
  })

  it('3.7 第 7 步：讀取舊資料不觸發升級——讀完後原生版本仍為 20、object store 不變，資料未被修改', async () => {
    const name = dbName()
    await createNativeOld(name, 20, { sessions: V2.sessions, venues: V2.venues, stakes: V2.stakes, settings: settingsRows(V2.settings) })
    await inspectBeforeUpgrade(name, DB_VERSION)
    await inspectBeforeUpgrade(name, DB_VERSION, factoryWithoutDatabases())
    expect(await nativeInfo(name)).toEqual({ version: 20, stores: ['sessions', 'settings', 'stakes', 'venues'] })
    expect((await indexedDB.databases()).find((d) => d.name === name)?.version).toBe(20)
  })

  it('3.7 第 3 步：讀完立即關閉連線——之後 Dexie 可以正常開啟並升級到 version 3，資料完整', async () => {
    const name = dbName()
    await createNativeOld(name, 20, { sessions: V2.sessions, venues: V2.venues, stakes: V2.stakes, settings: settingsRows(V2.settings) })
    const r = await inspectBeforeUpgrade(name, DB_VERSION)
    expect(r.kind).toBe('oldWithData')
    const db = createDb(name)
    await db.open()
    expect(db.verno).toBe(3)
    expect(await db.sessions.count()).toBe(V2.sessions.length)
    expect(await db.hands.count()).toBe(0)
    db.close()
    expect(await nativeInfo(name)).toEqual({ version: 30, stores: ['hands', 'sessions', 'settings', 'stakes', 'venues'] })
  })

  it('原生版本 → Dexie 版本：÷ 10', () => {
    expect(dexieVersionOf(10)).toBe(1)
    expect(dexieVersionOf(20)).toBe(2)
    expect(dexieVersionOf(30)).toBe(3)
  })
})

describe('8.4 升級前的備份（buildLegacyBackup）', () => {
  const NOW = new Date(2026, 9, 3, 12, 34)

  it('8.4 表格：舊資料庫 Dexie version 1 → schemaVersion 1、version 2 → 2、version 3 → 3', () => {
    expect(backupSchemaForDbVersion(1)).toBe(1)
    expect(backupSchemaForDbVersion(2)).toBe(2)
    expect(backupSchemaForDbVersion(3)).toBe(3)
    expect(backupSchemaForDbVersion(0)).toBeNull()
  })

  for (const [label, nativeVersion, fixture, schemaVersion] of [
    ['version 1（原生 10）', 10, V1, 1],
    ['version 2（原生 20）', 20, V2, 2],
  ] as const) {
    it(`8.4 ${label} 的舊資料 → schemaVersion ${schemaVersion}、不含 hands 欄位、資料原樣；parseBackupText 匯入成功（遷移到 ${CURRENT_SCHEMA_VERSION}）`, async () => {
      const name = dbName()
      // 舊資料庫的 settings 含草稿與上次備份時間：備份不包含（8.4）
      await createNativeOld(name, nativeVersion, {
        sessions: fixture.sessions,
        venues: fixture.venues,
        stakes: fixture.stakes,
        settings: settingsRows(fixture.settings, { recordDraft: { version: 1, type: 'cash', venueTouched: false, values: {} }, lastBackupAt: '2026-09-01T00:00:00+08:00' }),
      })
      const r = await inspectBeforeUpgrade(name, DB_VERSION)
      expect(r.kind).toBe('oldWithData')
      if (r.kind !== 'oldWithData') return
      const version = backupSchemaForDbVersion(r.dexieVersion)
      expect(version).toBe(schemaVersion)
      const backup = buildLegacyBackup(r.data as LegacyData, version!, NOW)
      expect(backup.app).toBe('poker-tracker')
      expect(backup.schemaVersion).toBe(schemaVersion)
      expect(backup.exportedAt).toBe(isoWithOffset(NOW))
      expect('hands' in backup).toBe(false)
      expect(backup.settings).toEqual(fixture.settings)
      const byId = (a: Record<string, unknown>, b: Record<string, unknown>) => (String(a.id) < String(b.id) ? -1 : 1)
      expect(backup.sessions).toStrictEqual([...fixture.sessions].sort(byId))
      expect(backup.venues).toStrictEqual(fixture.venues)
      expect(backup.stakes).toStrictEqual(fixture.stakes)

      // 新版以 8.5 匯入：schemaVersion 小於目前版本，先遷移（1 → 2 → 3 或 2 → 3）再驗證
      const parsed = parseBackupText(serializeBackup(backup))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(parsed.backup.hands).toEqual([])
      expect(parsed.backup.sessions).toHaveLength(fixture.sessions.length)
      for (const s of parsed.backup.sessions) {
        const original = fixture.sessions.find((x) => x.id === s.id)!
        // version 1 的場次沒有 backers：1 → 2 遷移補 []；version 2 原樣保留
        expect(s).toStrictEqual(schemaVersion === 1 ? { ...original, backers: [] } : original)
      }
      const migrated = migrateBackup(JSON.parse(serializeBackup(backup)) as BackupData)
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(migrated.hands).toEqual([])
    })
  }

  it('8.4 schemaVersion 3 時含 hands 欄位（依 id 排序）；venues、stakes 依 sortOrder', () => {
    const backup = buildLegacyBackup(
      {
        sessions: [{ id: 'b' }, { id: 'a' }],
        venues: [{ id: 'v2', sortOrder: 0 }, { id: 'v1', sortOrder: 1 }],
        stakes: [{ id: 's2', sortOrder: 1 }, { id: 's1', sortOrder: 1 }],
        hands: [{ id: 'h2' }, { id: 'h1' }],
        settings: { handDraft: {}, lastHandSeq: 3 },
      },
      3,
      NOW,
    )
    expect((backup.sessions as { id: string }[]).map((s) => s.id)).toEqual(['a', 'b'])
    expect((backup.venues as { id: string }[]).map((s) => s.id)).toEqual(['v2', 'v1'])
    expect((backup.stakes as { id: string }[]).map((s) => s.id)).toEqual(['s1', 's2'])
    expect((backup.hands as { id: string }[]).map((s) => s.id)).toEqual(['h1', 'h2'])
    expect(backup.settings).toEqual({ lastHandSeq: 3 })
  })
})
