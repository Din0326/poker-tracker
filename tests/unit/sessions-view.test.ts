import { describe, expect, it } from 'vitest'
import { sortReverseChronological, type Stake, type Venue } from '../../src/domain'
import {
  buildLookup,
  entriesBadge,
  groupByMonth,
  profitColorClass,
  rowDate,
  sessionTitle,
  startAtText,
} from '../../src/features/sessions/sessionView'
import { makeSession } from './helpers/fixtures'

// 7.1 列表的標題、日期、×N 標籤、月份分組彙總

const venue: Venue = { id: 'v1', name: '6bet', archived: false, sortOrder: 0 }
const archivedVenue: Venue = { id: 'v2', name: '舊場館', archived: true, sortOrder: 1 }
const stake: Stake = { id: 'stake-1', sb: 50, bb: 100, archived: false, sortOrder: 0 }
const archivedStake: Stake = { id: 'stake-2', sb: 100, bb: 200, archived: true, sortOrder: 1 }
const lookup = buildLookup([venue, archivedVenue], [stake, archivedStake])

describe('7.1 sessionTitle', () => {
  it('1. 有 name 時用 name', () => {
    expect(sessionTitle(makeSession({ name: '週末局', venueId: 'v1' }), lookup)).toBe('週末局')
    expect(sessionTitle(makeSession({ type: 'mtt', name: '週日賽', venueId: 'v1' }), lookup)).toBe('週日賽')
  })

  it('2. 現金桌：場地 · 盲注；錦標賽：場地名稱', () => {
    expect(sessionTitle(makeSession({ venueId: 'v1' }), lookup)).toBe('6bet · 50/100')
    expect(sessionTitle(makeSession({ type: 'mtt', venueId: 'v1' }), lookup)).toBe('6bet')
    expect(sessionTitle(makeSession({ type: 'timed_mtt', venueId: 'v1' }), lookup)).toBe('6bet')
  })

  it('3. 現金桌：盲注；錦標賽：類型名稱', () => {
    expect(sessionTitle(makeSession({ venueId: null }), lookup)).toBe('50/100')
    expect(sessionTitle(makeSession({ type: 'mtt', venueId: null }), lookup)).toBe('MTT')
    expect(sessionTitle(makeSession({ type: 'timed_mtt', venueId: null }), lookup)).toBe('限時 MTT')
  })

  it('已封存的場地與盲注照常顯示名稱', () => {
    expect(sessionTitle(makeSession({ venueId: 'v2', stakeId: 'stake-2' }), lookup)).toBe('舊場館 · 100/200')
    expect(sessionTitle(makeSession({ type: 'mtt', venueId: 'v2' }), lookup)).toBe('舊場館')
  })

  it('參照不存在時退回下一順位', () => {
    expect(sessionTitle(makeSession({ venueId: 'missing' }), lookup)).toBe('50/100')
    expect(sessionTitle(makeSession({ stakeId: 'missing' }), lookup)).toBe('現金桌')
  })
})

describe('7.1 entriesBadge、rowDate', () => {
  it('錦標賽進場 2 次以上加 ×N，現金桌與 1 次不加', () => {
    const two = [
      { amount: 1000, fee: 0 },
      { amount: 1000, fee: 0 },
    ]
    expect(entriesBadge(makeSession({ type: 'mtt', buyIns: two }))).toBe('×2')
    expect(entriesBadge(makeSession({ type: 'timed_mtt', buyIns: [...two, ...two] }))).toBe('×4')
    expect(entriesBadge(makeSession({ type: 'mtt' }))).toBeNull()
    expect(entriesBadge(makeSession({ type: 'cash' }))).toBeNull()
  })

  it('日期 MM/DD', () => {
    expect(rowDate(makeSession({ startAt: '2026-09-27T20:00' }))).toBe('09/27')
    expect(rowDate(makeSession({ startAt: '2026-01-05T00:00' }))).toBe('01/05')
  })

  it('開始時間 `2026/09/27 20 時`', () => {
    expect(startAtText({ startAt: '2026-09-27T20:00' })).toBe('2026/09/27 20 時')
    expect(startAtText({ startAt: '2026-09-27T05:00' })).toBe('2026/09/27 5 時')
  })

  it('盈虧顏色 class：0 不上色', () => {
    expect(profitColorClass(1)).toBe('text-(--color-gain)')
    expect(profitColorClass(-1)).toBe('text-(--color-loss)')
    expect(profitColorClass(0)).toBe('')
    expect(profitColorClass(null)).toBe('')
  })
})

describe('7.1 groupByMonth（排序後分組）', () => {
  const sep1 = makeSession({ id: 'a', startAt: '2026-09-27T20:00', createdAt: '2026-09-28T01:00:00+08:00', cashOut: 3000 })
  const sep2 = makeSession({ id: 'b', startAt: '2026-09-27T20:00', createdAt: '2026-09-28T02:00:00+08:00', cashOut: 0 })
  const sep3 = makeSession({ id: 'c', startAt: '2026-09-01T00:00', cashOut: 1500 })
  const aug = makeSession({ id: 'd', startAt: '2026-08-31T23:00', cashOut: 500 })
  const lastYear = makeSession({ id: 'e', startAt: '2025-12-31T10:00', cashOut: 1000 })

  it('依 startAt 由新到舊、同時間依 createdAt 由新到舊，跨月跨年分組', () => {
    const sorted = sortReverseChronological([aug, sep1, lastYear, sep3, sep2])
    expect(sorted.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd', 'e'])
    const groups = groupByMonth(sorted)
    expect(groups.map((g) => g.key)).toEqual(['2026-09', '2026-08', '2025-12'])
    expect(groups[0]).toMatchObject({ year: 2026, month: 9, count: 3, profit: 2000 - 1000 + 500 })
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['b', 'a', 'c'])
    expect(groups[1]).toMatchObject({ year: 2026, month: 8, count: 1, profit: -500 })
    expect(groups[2]).toMatchObject({ year: 2025, month: 12, count: 1, profit: 0 })
  })

  it('空陣列回傳空分組', () => {
    expect(groupByMonth([])).toEqual([])
  })
})
