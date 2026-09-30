import { describe, expect, it } from 'vitest'
import type { Stake, Venue } from '../../src/domain/types'
import { GROUP_COLUMNS_BY_TAB, GROUP_OPTIONS_BY_TAB, buildGroups } from '../../src/features/report/grouping'
import { buildLookup } from '../../src/features/sessions/sessionView'
import { makeSession } from './helpers/fixtures'

const venues: Venue[] = [
  { id: 'v1', name: 'Ace', archived: false, sortOrder: 0 },
  { id: 'v2', name: 'Old Club', archived: true, sortOrder: 1 },
  { id: 'v3', name: 'Bee', archived: false, sortOrder: 2 },
]
const stakes: Stake[] = [
  { id: 's1', sb: 50, bb: 100, archived: false, sortOrder: 0 },
  { id: 's2', sb: 100, bb: 200, archived: true, sortOrder: 1 },
]
const lookup = buildLookup(venues, stakes)

const cells = (row: ReturnType<typeof buildGroups>[number]) =>
  Object.fromEntries(row.cells.map((c) => [c.key, c.value.text]))

describe('6.4 分組選項與欄位', () => {
  it('各頁籤可選分組（第一個為預設）', () => {
    expect(GROUP_OPTIONS_BY_TAB).toEqual({
      all: ['venue'],
      cash: ['venue', 'stake'],
      mtt: ['venue', 'name'],
      timed_mtt: ['venue', 'name'],
    })
  })
  it('各頁籤的欄位', () => {
    expect(GROUP_COLUMNS_BY_TAB).toEqual({
      all: ['count', 'profit', 'totalFee'],
      cash: ['count', 'profit', 'hourly', 'bbPerHour'],
      mtt: ['count', 'profit', 'roi', 'itm'],
      timed_mtt: ['count', 'profit', 'roi', 'hourly'],
    })
  })
})

describe('6.4 場地分組', () => {
  const sessions = [
    makeSession({ type: 'cash', venueId: 'v1', stakeId: 's1', buyIns: [{ amount: 1000, fee: 100 }], cashOut: 3000 }),
    makeSession({ type: 'cash', venueId: 'v2', stakeId: 's2', buyIns: [{ amount: 1000, fee: 0 }], cashOut: 9000 }),
    makeSession({ type: 'cash', venueId: null, stakeId: 's1', buyIns: [{ amount: 1000, fee: 0 }], cashOut: 99000 }),
    makeSession({ type: 'mtt', venueId: 'v1', buyIns: [{ amount: 1000, fee: 50 }], cashOut: 0 }),
  ]

  it('依盈利由高到低；未指定永遠排最後（即使盈利最高）；已封存照常列入並加註', () => {
    const rows = buildGroups(sessions, 'all', 'venue', lookup, lookup.stakes)
    expect(rows.map((r) => r.label)).toEqual(['Old Club（已封存）', 'Ace', '未指定'])
    expect(rows.map((r) => cells(r))).toEqual([
      { count: '1', profit: '+$8,000', totalFee: '$0' },
      { count: '2', profit: '+$1,000', totalFee: '$150' },
      { count: '1', profit: '+$98,000', totalFee: '$0' },
    ])
    expect(rows.map((r) => r.link)).toEqual([{ venueId: 'v2' }, { venueId: 'v1' }, { venueId: null }])
  })

  it('同盈利依場次數多到少，再依顯示名稱', () => {
    const rows = buildGroups(
      [
        makeSession({ venueId: 'v3', cashOut: 2000 }),
        makeSession({ venueId: 'v1', cashOut: 2000 }),
        makeSession({ venueId: 'v2', cashOut: 1500 }),
        makeSession({ venueId: 'v2', cashOut: 1500 }),
      ],
      'all',
      'venue',
      lookup,
      lookup.stakes,
    )
    expect(rows.map((r) => r.label)).toEqual(['Old Club（已封存）', 'Ace', 'Bee'])
  })
})

describe('6.4 盲注分組（現金桌）', () => {
  it('欄位為場次數、盈利、時薪、bb/hr；已封存盲注加註', () => {
    const rows = buildGroups(
      [
        makeSession({ type: 'cash', stakeId: 's1', cashOut: 3000, durationMin: 120 }),
        makeSession({ type: 'cash', stakeId: 's2', cashOut: 500, durationMin: 60 }),
      ],
      'cash',
      'stake',
      lookup,
      lookup.stakes,
    )
    expect(rows.map((r) => [r.label, cells(r)])).toEqual([
      ['50/100', { count: '1', profit: '+$2,000', hourly: '+$1,000/hr', bbPerHour: '+10.0 bb/hr' }],
      ['100/200（已封存）', { count: '1', profit: '−$500', hourly: '−$500/hr', bbPerHour: '−2.5 bb/hr' }],
    ])
    expect(rows[1]!.link).toEqual({ stakeId: 's2' })
  })
})

describe('6.4 名稱分組', () => {
  const sessions = [
    makeSession({ type: 'mtt', name: ' sunday major ', startAt: '2026-09-01T20:00', cashOut: 0 }),
    makeSession({ type: 'mtt', name: 'Sunday Major', startAt: '2026-09-20T20:00', cashOut: 5000 }),
    makeSession({ type: 'mtt', name: 'SUNDAY MAJOR', startAt: '2026-09-10T20:00', cashOut: 0 }),
    makeSession({ type: 'mtt', name: null, cashOut: 50000 }),
    makeSession({ type: 'mtt', name: '   ', cashOut: 0 }),
    makeSession({ type: 'mtt', name: 'Daily', cashOut: 1000 }),
  ]

  it('去除前後空白、不分大小寫為同一組；顯示名稱取最近一場的去空白原文；未命名排最後', () => {
    const rows = buildGroups(sessions, 'mtt', 'name', lookup, lookup.stakes)
    expect(rows.map((r) => r.label)).toEqual(['Sunday Major', 'Daily', '未命名'])
    expect(rows.map((r) => r.count)).toEqual([3, 1, 2])
    expect(cells(rows[0]!)).toEqual({ count: '3', profit: '+$2,000', roi: '+66.7%', itm: '1/3（33.3%）' })
    expect(rows.map((r) => r.link)).toEqual([{ name: 'Sunday Major' }, { name: 'Daily' }, { name: null }])
  })

  it('最近一場同 startAt 時依 createdAt 決定', () => {
    const rows = buildGroups(
      [
        makeSession({ type: 'timed_mtt', name: 'Late ', startAt: '2026-09-01T20:00', createdAt: '2026-09-02T01:00:00+08:00' }),
        makeSession({ type: 'timed_mtt', name: 'late', startAt: '2026-09-01T20:00', createdAt: '2026-09-02T00:00:00+08:00' }),
      ],
      'timed_mtt',
      'name',
      lookup,
      lookup.stakes,
    )
    expect(rows.map((r) => r.label)).toEqual(['Late'])
  })

  it('空集合沒有任何組', () => {
    expect(buildGroups([], 'mtt', 'name', lookup, lookup.stakes)).toEqual([])
  })
})
