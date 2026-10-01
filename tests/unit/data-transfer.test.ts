// 8.5 完整取代（同一個 transaction，失敗整個還原）、8.9 清除所有資料、匯出讀取
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb, createRepositories, type PokerDb } from '../../src/db'
import { buildBackup, type BackupFile } from '../../src/domain'
import { clearAllData, loadAllData, replaceAllData } from '../../src/features/settings/dataTransfer'

let seq = 0
const opened: PokerDb[] = []

async function setup() {
  const db = createDb(`transfer-${Date.now()}-${++seq}`)
  opened.push(db)
  const repos = createRepositories(db, { now: () => new Date(2026, 8, 28, 21, 5) })
  const venue = await repos.venues.create('A 場')
  const stake = await repos.stakes.create(50, 100)
  await repos.sessions.create({
    type: 'cash',
    startAt: '2026-09-27T20:00',
    durationMin: 60,
    buyIns: [{ amount: 1000, fee: 0 }],
    cashOut: 1500,
    stakeId: stake.id,
    venueId: venue.id,
  })
  await repos.settings.set('lastType', 'cash')
  await repos.settings.set('recordDraft', { version: 1 })
  await repos.settings.set('lastBackupAt', '2026-01-01T00:00:00+08:00')
  return { db, repos }
}

afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

function otherBackup(): BackupFile {
  return {
    app: 'poker-tracker',
    schemaVersion: 1,
    exportedAt: '2026-09-20T10:00:00+08:00',
    venues: [{ id: uuid(1), name: 'B 場', archived: true, sortOrder: 0 }],
    stakes: [],
    sessions: [
      {
        id: uuid(2),
        type: 'mtt',
        startAt: '2026-09-01T19:00',
        durationMin: 120,
        buyIns: [{ amount: 3000, fee: 300 }],
        cashOut: 0,
        stakeId: null,
        venueId: uuid(1),
        name: null,
        note: null,
        fieldSize: null,
        finishPlace: null,
        createdAt: '2026-09-01T23:00:00+08:00',
        updatedAt: '2026-09-01T23:00:00+08:00',
      },
    ],
    settings: { profitColorScheme: 'greenGain' },
  }
}

describe('loadAllData', () => {
  it('讀出四張表，settings 轉為 key → value', async () => {
    const { db } = await setup()
    const data = await loadAllData(db)
    expect(data.sessions).toHaveLength(1)
    expect(data.venues).toHaveLength(1)
    expect(data.stakes).toHaveLength(1)
    expect(data.settings).toMatchObject({ lastType: 'cash', recordDraft: { version: 1 } })
  })
})

describe('8.5 replaceAllData', () => {
  it('完整取代：舊資料全部清除，寫入備份內容；recordDraft 不存在、lastBackupAt = exportedAt', async () => {
    const { db } = await setup()
    const backup = otherBackup()
    await replaceAllData(db, backup)
    const data = await loadAllData(db)
    expect(data.sessions).toEqual(backup.sessions)
    expect(data.venues).toEqual(backup.venues)
    expect(data.stakes).toEqual([])
    expect(data.settings).toEqual({ profitColorScheme: 'greenGain', lastBackupAt: backup.exportedAt })
  })

  it('匯出 → 取代後再匯出：內容相同（除 exportedAt）', async () => {
    const { db } = await setup()
    const first = buildBackup(await loadAllData(db), new Date(2026, 8, 28, 22, 0))
    await replaceAllData(db, otherBackup())
    await replaceAllData(db, first)
    const second = buildBackup(await loadAllData(db), new Date(2026, 8, 28, 22, 0))
    expect(second).toEqual(first)
  })

  it('寫入途中失敗時整個還原，不留下半套資料', async () => {
    const { db } = await setup()
    const before = await loadAllData(db)
    const bad = otherBackup()
    // 同 id 的場次兩筆：bulkAdd 在清除之後才失敗
    bad.sessions = [bad.sessions[0]!, bad.sessions[0]!]
    await expect(replaceAllData(db, bad)).rejects.toThrow()
    expect(await loadAllData(db)).toEqual(before)
  })
})

describe('8.9 clearAllData', () => {
  it('清除四張表（含設定）', async () => {
    const { db } = await setup()
    await clearAllData(db)
    expect(await loadAllData(db)).toEqual({ sessions: [], venues: [], stakes: [], settings: {} })
  })
})
