import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AlreadyExistsError,
  DuplicateNameError,
  DuplicateStakeError,
  InUseError,
  RecordNotFoundError,
  ReferenceNotFoundError,
  SCHEMA_V1,
  TypeImmutableError,
  ValidationError,
  createDb,
  createRepositories,
  toIsoWithOffset,
  type PokerDb,
  type SessionInput,
} from '../../src/db'
import { sessionSchema } from '../../src/domain/schemas'

// 每個測試使用獨立的 DB 名稱，互不影響
let seq = 0
const opened: PokerDb[] = []

function setup(now: () => Date = () => new Date(2026, 8, 28, 21, 5, 0)) {
  const db = createDb(`test-${Date.now()}-${++seq}`)
  opened.push(db)
  return { db, repos: createRepositories(db, { now }) }
}

afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

describe('3.7 Dexie schema', () => {
  it('version(1) 的 stores 完全等於規格 3.7', async () => {
    const { db } = setup()
    expect(SCHEMA_V1).toEqual({
      sessions: 'id, type, startAt, venueId, stakeId',
      venues: 'id, name, archived',
      stakes: 'id, archived',
      settings: 'key',
    })
    expect(db.verno).toBe(1)
    const actual = Object.fromEntries(
      db.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')]),
    )
    expect(actual).toEqual(SCHEMA_V1)

    // 開啟後實際建立的 IndexedDB object store 與索引
    await db.open()
    const idb = db.backendDB()
    expect([...idb.objectStoreNames].sort()).toEqual(['sessions', 'settings', 'stakes', 'venues'])
    const tx = idb.transaction(['sessions', 'venues', 'stakes', 'settings'], 'readonly')
    expect([...tx.objectStore('sessions').indexNames].sort()).toEqual(['stakeId', 'startAt', 'type', 'venueId'])
    expect([...tx.objectStore('venues').indexNames].sort()).toEqual(['archived', 'name'])
    expect([...tx.objectStore('stakes').indexNames]).toEqual(['archived'])
    expect([...tx.objectStore('settings').indexNames]).toEqual([])
    expect(tx.objectStore('settings').keyPath).toBe('key')
  })
})

describe('venues repository', () => {
  it('create：去除前後空白、sortOrder 為最大值 + 1（無資料時為 0）', async () => {
    const { repos } = setup()
    const a = await repos.venues.create('  6bet  ')
    expect(a.name).toBe('6bet')
    expect(a.sortOrder).toBe(0)
    expect(a.archived).toBe(false)
    const b = await repos.venues.create('Star')
    expect(b.sortOrder).toBe(1)
    expect((await repos.venues.list()).map((v) => v.name)).toEqual(['6bet', 'Star'])
  })

  it('名稱不分大小寫不可重複（含已封存）', async () => {
    const { repos } = setup()
    const a = await repos.venues.create('Star Poker')
    await expect(repos.venues.create('star poker')).rejects.toBeInstanceOf(DuplicateNameError)
    await expect(repos.venues.create('  STAR POKER ')).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })
    await repos.venues.archive(a.id)
    await expect(repos.venues.create('Star Poker')).rejects.toBeInstanceOf(DuplicateNameError)
  })

  it('名稱驗證：空白、超過 30 字', async () => {
    const { repos } = setup()
    await expect(repos.venues.create('   ')).rejects.toBeInstanceOf(ValidationError)
    await expect(repos.venues.create('a'.repeat(31))).rejects.toMatchObject({ code: 'VALIDATION' })
    expect((await repos.venues.create('😀'.repeat(30))).name).toBe('😀'.repeat(30))
  })

  it('rename：同樣檢查重複；可改成自己的大小寫變化', async () => {
    const { repos } = setup()
    const a = await repos.venues.create('Alpha')
    await repos.venues.create('Beta')
    await expect(repos.venues.rename(a.id, 'BETA')).rejects.toBeInstanceOf(DuplicateNameError)
    expect((await repos.venues.rename(a.id, ' ALPHA ')).name).toBe('ALPHA')
    await expect(repos.venues.rename('nope', 'X')).rejects.toBeInstanceOf(RecordNotFoundError)
  })

  it('archive / unarchive 與 listActive（以 filter 篩選，不用 boolean 索引）', async () => {
    const { repos } = setup()
    const a = await repos.venues.create('A')
    const b = await repos.venues.create('B')
    await repos.venues.archive(a.id)
    expect((await repos.venues.listActive()).map((v) => v.id)).toEqual([b.id])
    expect((await repos.venues.list()).length).toBe(2)
    await repos.venues.unarchive(a.id)
    expect((await repos.venues.listActive()).map((v) => v.id)).toEqual([a.id, b.id])
  })

  it('move：與同一封存狀態的相鄰項交換 sortOrder；邊界不變動', async () => {
    const { repos } = setup()
    const a = await repos.venues.create('A')
    const b = await repos.venues.create('B')
    const c = await repos.venues.create('C')
    expect(await repos.venues.move(c.id, 'up')).toBe(true)
    expect((await repos.venues.list()).map((v) => v.name)).toEqual(['A', 'C', 'B'])
    expect(await repos.venues.move(a.id, 'up')).toBe(false)
    expect(await repos.venues.move(b.id, 'down')).toBe(false)
    // B 封存後，A 下移會與 C 交換（跳過已封存項目）
    await repos.venues.archive(b.id)
    await repos.venues.move(a.id, 'down')
    expect((await repos.venues.listActive()).map((v) => v.name)).toEqual(['C', 'A'])
  })

  it('delete：未被參照可刪；被參照丟出 InUseError；usageCount 正確', async () => {
    const { repos } = setup()
    const used = await repos.venues.create('Used')
    const free = await repos.venues.create('Free')
    await repos.sessions.create({ ...timedMtt, venueId: used.id })
    await repos.sessions.create({ ...timedMtt, venueId: used.id })
    expect(await repos.venues.usageCount(used.id)).toBe(2)
    expect(await repos.venues.usageCount(free.id)).toBe(0)
    await expect(repos.venues.delete(used.id)).rejects.toBeInstanceOf(InUseError)
    await expect(repos.venues.delete(used.id)).rejects.toMatchObject({ code: 'IN_USE', usageCount: 2 })
    await repos.venues.delete(free.id)
    expect(await repos.venues.get(free.id)).toBeUndefined()
    // 被參照的場地仍可改名（3.6）
    expect((await repos.venues.rename(used.id, 'Renamed')).name).toBe('Renamed')
  })
})

describe('stakes repository', () => {
  it('create：同一組 sb、bb 不可重複；sortOrder 排最後', async () => {
    const { repos } = setup()
    const a = await repos.stakes.create(50, 100)
    const b = await repos.stakes.create(100, 200)
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1])
    await expect(repos.stakes.create(50, 100)).rejects.toBeInstanceOf(DuplicateStakeError)
    await repos.stakes.archive(a.id)
    await expect(repos.stakes.create(50, 100)).rejects.toMatchObject({ code: 'DUPLICATE_STAKE' })
    expect((await repos.stakes.create(50, 200)).sb).toBe(50)
  })

  it('create：sb ≥ 1、bb ≥ sb', async () => {
    const { repos } = setup()
    await expect(repos.stakes.create(0, 100)).rejects.toBeInstanceOf(ValidationError)
    await expect(repos.stakes.create(200, 100)).rejects.toBeInstanceOf(ValidationError)
    await expect(repos.stakes.create(1.5, 3)).rejects.toBeInstanceOf(ValidationError)
  })

  it('update：未被參照可改 sb、bb；被參照不可改；不可改成重複', async () => {
    const { repos } = setup()
    const a = await repos.stakes.create(50, 100)
    const b = await repos.stakes.create(100, 200)
    expect(await repos.stakes.update(a.id, 25, 50)).toMatchObject({ sb: 25, bb: 50, sortOrder: 0 })
    await expect(repos.stakes.update(a.id, 100, 200)).rejects.toBeInstanceOf(DuplicateStakeError)
    await repos.sessions.create({ ...cash, stakeId: b.id })
    await expect(repos.stakes.update(b.id, 200, 400)).rejects.toBeInstanceOf(InUseError)
    expect(await repos.stakes.get(b.id)).toMatchObject({ sb: 100, bb: 200 })
  })

  it('delete：被參照不可刪；未被參照可刪', async () => {
    const { repos } = setup()
    const a = await repos.stakes.create(50, 100)
    const b = await repos.stakes.create(100, 200)
    await repos.sessions.create({ ...cash, stakeId: a.id })
    expect(await repos.stakes.usageCount(a.id)).toBe(1)
    await expect(repos.stakes.delete(a.id)).rejects.toBeInstanceOf(InUseError)
    await repos.stakes.delete(b.id)
    expect((await repos.stakes.list()).map((s) => s.id)).toEqual([a.id])
  })

  it('archive / unarchive / move / listActive', async () => {
    const { repos } = setup()
    const a = await repos.stakes.create(50, 100)
    const b = await repos.stakes.create(100, 200)
    await repos.stakes.move(b.id, 'up')
    expect((await repos.stakes.list()).map((s) => s.id)).toEqual([b.id, a.id])
    await repos.stakes.archive(b.id)
    expect((await repos.stakes.listActive()).map((s) => s.id)).toEqual([a.id])
    await repos.stakes.unarchive(b.id)
    expect((await repos.stakes.listActive()).length).toBe(2)
  })
})

const timedMtt: SessionInput = {
  type: 'timed_mtt',
  startAt: '2026-09-27T20:00',
  durationMin: 240,
  buyIns: [
    { amount: 3400, fee: 400 },
    { amount: 3200, fee: 200 },
  ],
  cashOut: 9000,
}

const cash: SessionInput = {
  type: 'cash',
  startAt: '2026-09-27T14:00',
  durationMin: 300,
  buyIns: [{ amount: 10000, fee: 0 }],
  cashOut: 12000,
}

describe('sessions repository', () => {
  it('create：產生 UUID 與含偏移的時間戳，通過 schema', async () => {
    const now = new Date(2026, 8, 28, 21, 5, 0)
    const { repos } = setup(() => now)
    const s = await repos.sessions.create(timedMtt)
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(s.createdAt).toMatch(ISO_WITH_OFFSET)
    expect(s.createdAt).toBe(toIsoWithOffset(now))
    expect(Date.parse(s.createdAt)).toBe(now.getTime())
    expect(s.updatedAt).toBe(s.createdAt)
    expect(sessionSchema.safeParse(s).success).toBe(true)
    expect(await repos.sessions.get(s.id)).toEqual(s)
  })

  it('create：不使用的欄位強制為 null；name 去除空白、空字串存 null；note 原樣保留', async () => {
    const { repos } = setup()
    const stake = await repos.stakes.create(50, 100)
    const s = await repos.sessions.create({ ...cash, stakeId: stake.id, fieldSize: 100, finishPlace: 3, name: '   ', note: '' })
    expect(s).toMatchObject({ fieldSize: null, finishPlace: null, name: null, note: null, venueId: null })
    const t = await repos.sessions.create({ ...timedMtt, stakeId: stake.id, fieldSize: 10, name: '  Daily  ', note: ' a\nb ' })
    expect(t).toMatchObject({ stakeId: null, fieldSize: null, finishPlace: null, name: 'Daily', note: ' a\nb ' })
    const m = await repos.sessions.create({ ...timedMtt, type: 'mtt', fieldSize: 100, finishPlace: 3 })
    expect(m).toMatchObject({ fieldSize: 100, finishPlace: 3, stakeId: null })
  })

  it('create：驗證失敗丟出 ValidationError', async () => {
    const { repos } = setup()
    await expect(repos.sessions.create(cash)).rejects.toBeInstanceOf(ValidationError) // 現金桌未選盲注
    await expect(repos.sessions.create({ ...timedMtt, durationMin: 0 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(repos.sessions.create({ ...timedMtt, name: 'x'.repeat(51) })).rejects.toBeInstanceOf(ValidationError)
    expect(await repos.sessions.list()).toEqual([])
  })

  it('create：venueId / stakeId 必須存在', async () => {
    const { repos } = setup()
    await expect(repos.sessions.create({ ...timedMtt, venueId: 'missing' })).rejects.toBeInstanceOf(ReferenceNotFoundError)
    await expect(repos.sessions.create({ ...cash, stakeId: 'missing' })).rejects.toMatchObject({
      code: 'REFERENCE_NOT_FOUND',
      field: 'stakeId',
    })
    expect(await repos.sessions.list()).toEqual([])
  })

  it('update：type 不可變更；保留 createdAt，更新 updatedAt', async () => {
    let t = new Date(2026, 8, 28, 21, 5, 0)
    const { repos } = setup(() => t)
    const s = await repos.sessions.create(timedMtt)
    t = new Date(2026, 8, 29, 9, 30, 15)
    await expect(repos.sessions.update(s.id, { type: 'mtt' })).rejects.toBeInstanceOf(TypeImmutableError)
    await expect(repos.sessions.update(s.id, { type: 'cash' })).rejects.toMatchObject({ code: 'TYPE_IMMUTABLE' })
    const u = await repos.sessions.update(s.id, { cashOut: 0, name: ' Main ' })
    expect(u).toMatchObject({ id: s.id, type: 'timed_mtt', cashOut: 0, name: 'Main', createdAt: s.createdAt })
    expect(u.updatedAt).toBe(toIsoWithOffset(t))
    expect(u.updatedAt).not.toBe(s.updatedAt)
    expect(await repos.sessions.get(s.id)).toEqual(u)
    // 同 type 可以帶入
    expect((await repos.sessions.update(s.id, { type: 'timed_mtt', durationMin: 60 })).durationMin).toBe(60)
    await expect(repos.sessions.update('nope', {})).rejects.toBeInstanceOf(RecordNotFoundError)
    await expect(repos.sessions.update(s.id, { cashOut: -1 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('delete 回傳原資料；restore 後資料完全相同（含 id 與時間戳）', async () => {
    const { repos } = setup()
    const venue = await repos.venues.create('V')
    const s = await repos.sessions.create({ ...timedMtt, venueId: venue.id, name: 'Event', note: 'n' })
    const deleted = await repos.sessions.delete(s.id)
    expect(deleted).toEqual(s)
    expect(await repos.sessions.get(s.id)).toBeUndefined()
    await repos.sessions.restore(deleted)
    expect(await repos.sessions.get(s.id)).toEqual(s)
    await expect(repos.sessions.restore(deleted)).rejects.toBeInstanceOf(AlreadyExistsError)
    await expect(repos.sessions.delete('nope')).rejects.toBeInstanceOf(RecordNotFoundError)
  })

  it('restore：驗證 schema 與參照', async () => {
    const { repos } = setup()
    const s = await repos.sessions.create(timedMtt)
    const deleted = await repos.sessions.delete(s.id)
    await expect(repos.sessions.restore({ ...deleted, venueId: 'missing' })).rejects.toBeInstanceOf(
      ReferenceNotFoundError,
    )
    await expect(repos.sessions.restore({ ...deleted, cashOut: -5 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('list 回傳全部場次', async () => {
    const { repos } = setup()
    await repos.sessions.create(timedMtt)
    await repos.sessions.create({ ...timedMtt, type: 'mtt' })
    expect((await repos.sessions.list()).length).toBe(2)
  })
})

describe('settings repository', () => {
  it('get / set / delete，型別安全並驗證', async () => {
    const { repos } = setup()
    expect(await repos.settings.get('lastType')).toBeUndefined()
    await repos.settings.set('lastType', 'mtt')
    expect(await repos.settings.get('lastType')).toBe('mtt')
    await repos.settings.set('lastVenueByType', { cash: 'v1', mtt: null })
    expect(await repos.settings.get('lastVenueByType')).toEqual({ cash: 'v1', mtt: null })
    await repos.settings.set('profitColorScheme', 'greenGain')
    await repos.settings.set('recordDraft', { amount: '100' })
    await repos.settings.set('lastBackupAt', '2026-09-28T21:05:00+08:00')
    await repos.settings.set('lastStakeId', 's1')
    expect(await repos.settings.get('recordDraft')).toEqual({ amount: '100' })
    await repos.settings.delete('recordDraft')
    expect(await repos.settings.get('recordDraft')).toBeUndefined()
    // 執行期傳入錯誤值仍會被擋下
    await expect(repos.settings.set('lastType', 'poker' as never)).rejects.toBeInstanceOf(ValidationError)
    await expect(repos.settings.set('lastBackupAt', '2026-09-28')).rejects.toBeInstanceOf(ValidationError)
  })
})
