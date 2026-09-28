import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createDb } from '../../src/db'
import { sessionSchema, stakeSchema, venueSchema } from '../../src/domain/schemas'
import { SESSION_TYPES } from '../../src/domain/types'
import { generateSeedData } from '../../src/dev/seed'

describe('A9 5,000 筆測試資料產生器', () => {
  const today = '2026-09-28'
  const data = generateSeedData({ today })

  it('預設產生 5,000 筆場次，並產生所需的場地與盲注', () => {
    expect(data.sessions).toHaveLength(5000)
    expect(data.venues.length).toBeGreaterThan(0)
    expect(data.stakes.length).toBeGreaterThan(0)
  })

  it('每筆場次、場地、盲注都通過 Zod schema', () => {
    const bad = data.sessions.filter((s) => !sessionSchema.safeParse(s).success)
    expect(bad).toEqual([])
    for (const v of data.venues) expect(venueSchema.safeParse(v).success).toBe(true)
    for (const s of data.stakes) expect(stakeSchema.safeParse(s).success).toBe(true)
  })

  it('參照的 venueId、stakeId 都存在；id 不重複；不含未來日期', () => {
    const venueIds = new Set(data.venues.map((v) => v.id))
    const stakeIds = new Set(data.stakes.map((s) => s.id))
    for (const s of data.sessions) {
      if (s.venueId !== null) expect(venueIds.has(s.venueId)).toBe(true)
      if (s.stakeId !== null) expect(stakeIds.has(s.stakeId)).toBe(true)
      expect(s.startAt.slice(0, 10) < today).toBe(true)
    }
    const ids = [...data.sessions, ...data.venues, ...data.stakes].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('涵蓋三種類型', () => {
    const types = new Set(data.sessions.map((s) => s.type))
    expect([...types].sort()).toEqual([...SESSION_TYPES].sort())
  })

  it('同一組參數結果相同（可重現）', () => {
    expect(generateSeedData({ today, count: 50 })).toEqual(generateSeedData({ today, count: 50 }))
  })

  it('可整批寫入 Dexie', async () => {
    const db = createDb(`seed-${Date.now()}`)
    await db.transaction('rw', db.sessions, db.venues, db.stakes, async () => {
      await db.venues.bulkAdd(data.venues)
      await db.stakes.bulkAdd(data.stakes)
      await db.sessions.bulkAdd(data.sessions)
    })
    expect(await db.sessions.count()).toBe(5000)
    await db.delete()
  })
})
