// 賣股份在報表、列表的口徑與顯示（6、6.3、6.4、7.1；v1.2）
import { describe, expect, it } from 'vitest'
import type { Backer, Stake, Venue } from '../../src/domain'
import { buildGroups } from '../../src/features/report/grouping'
import { buildCurve, buildTypeBreakdown, hasStakedSessions } from '../../src/features/report/reportModel'
import { buildLookup, groupByMonth, soldBadge } from '../../src/features/sessions/sessionView'
import { makeSession } from './helpers/fixtures'

const A: Backer = { name: 'A', sharePermille: 100, markupPermille: 1200 }
const B: Backer = { name: 'B', sharePermille: 200, markupPermille: 1200 }

// C14 場次：你的盈利 +28,600（全額 +40,000）
const c14 = makeSession({
  type: 'mtt',
  stakeId: null,
  venueId: 'v1',
  startAt: '2026-09-20T13:00',
  buyIns: [{ amount: 10000, fee: 0 }],
  cashOut: 50000,
  backers: [A, B],
})
const plain = makeSession({ type: 'mtt', stakeId: null, venueId: 'v1', startAt: '2026-09-21T13:00', buyIns: [{ amount: 3000, fee: 0 }], cashOut: 0 })
const venues: Venue[] = [{ id: 'v1', name: '6bet', archived: false, sortOrder: 0 }]
const stakes: Stake[] = []

describe('7.1 列表', () => {
  it('有出資者的場次標籤 `賣30%`；比例非整數時 1 位小數；沒有出資者為 null', () => {
    expect(soldBadge(c14)).toBe('賣30%')
    expect(soldBadge(makeSession({ backers: [{ name: 'A', sharePermille: 125, markupPermille: 1000 }] }))).toBe('賣12.5%')
    expect(soldBadge(plain)).toBeNull()
  })

  it('月份彙總盈利為 Σ 你的盈利', () => {
    const [g] = groupByMonth([plain, c14])
    expect(g).toMatchObject({ count: 2, profit: 28600 - 3000 })
  })
})

describe('6 報表口徑', () => {
  it('P5.5 有賣股場次時顯示口徑小字，沒有時不顯示', () => {
    expect(hasStakedSessions([plain, c14])).toBe(true)
    expect(hasStakedSessions([plain])).toBe(false)
    expect(hasStakedSessions([])).toBe(false)
  })

  it('6.3 曲線累積你的盈利；有出資者的點帶賣出比例（tooltip 加註「（賣 30%）」）', () => {
    const points = buildCurve([plain, c14])
    expect(points.map((p) => [p.profit, p.cumulative, p.soldPermille])).toEqual([
      [28600, 28600, 300],
      [-3000, 25600, null],
    ])
  })

  it('6.2 總體頁小表與 6.4 分組統計的盈利為你的份額', () => {
    const breakdown = buildTypeBreakdown([plain, c14])
    expect(breakdown.find((r) => r.type === 'mtt')?.profit.text).toBe('+$25,600')
    const [group] = buildGroups([plain, c14], 'mtt', 'venue', buildLookup(venues, stakes), new Map())
    expect(group?.profit).toBe(25600)
    expect(Object.fromEntries(group!.cells.map((c) => [c.key, c.value.text]))).toMatchObject({
      profit: '+$25,600',
      // ROI = 25,600 ÷（6,400 + 3,000）；ITM 用全額 cashOut：1/2
      roi: '+272.3%',
      itm: '1/2（50.0%）',
    })
  })
})
