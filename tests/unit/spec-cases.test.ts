import { describe, expect, it } from 'vitest'
import {
  averagePlacePercentile,
  bbPerHour,
  itm,
  summarize,
  tournamentMetrics,
} from '../../src/domain/aggregate'
import {
  formatAvgEntries,
  formatBbPerHour,
  formatFraction,
  formatHourly,
  formatMoney,
  formatPercent,
  formatPlacePercentile,
  formatSignedMoney,
  formatSignedPercent,
} from '../../src/domain/format'
import { filterByPeriod, resolvePeriod } from '../../src/domain/period'
import { buyInSchema, sessionSchema } from '../../src/domain/schemas'
import { buyInTotal, entryCount, feeTotal, fullProfit, myProfit, sessionResult } from '../../src/domain/session'
import type { Stake } from '../../src/domain/types'
import { makeSession, withResult } from './helpers/fixtures'

// 10.2 計算公式必測案例 C1–C12，期望值完全依規格表

describe('10.2 計算公式必測案例', () => {
  it('C1 限時 MTT 兩次買入：買入 6,600、服務費 600、進場 2、盈利 +2,400', () => {
    const s = makeSession({
      type: 'timed_mtt',
      buyIns: [
        { amount: 3400, fee: 400 },
        { amount: 3200, fee: 200 },
      ],
      cashOut: 9000,
    })
    expect(buyInTotal(s)).toBe(6600)
    expect(feeTotal(s)).toBe(600)
    expect(entryCount(s)).toBe(2)
    expect(myProfit(s)).toBe(2400)
    expect(fullProfit(s)).toBe(2400)
    expect(formatSignedMoney(myProfit(s))).toBe('+$2,400')
    expect(sessionSchema.safeParse(s).success).toBe(true)
  })

  it('C2 現金桌買入 10,000 到手 0：盈利 −10,000，判定為輸', () => {
    const s = withResult('cash', 10000, 0)
    expect(myProfit(s)).toBe(-10000)
    expect(fullProfit(s)).toBe(-10000)
    expect(sessionResult(s)).toBe('loss')
    expect(formatSignedMoney(myProfit(s))).toBe('−$10,000')
  })

  it('C3 買入 5,000 到手 5,000：盈利 0，判定為平，不計入贏的場次', () => {
    const s = withResult('cash', 5000, 5000)
    expect(myProfit(s)).toBe(0)
    expect(fullProfit(s)).toBe(0)
    expect(sessionResult(s)).toBe('even')
    const m = summarize([s])
    expect(m.winCount).toBe(0)
    expect(m.winRate).toBe(0)
    expect(formatFraction(m.winCount, m.count)).toBe('0/1（0.0%）')
    expect(formatSignedMoney(m.profit)).toBe('$0')
  })

  it('C4 現金桌 50/100 +2,000 2 小時 與 100/200 +2,000 2 小時：bb/hr = (20 + 10) ÷ 4 = 7.5', () => {
    const stakes = new Map<string, Stake>([
      ['s50', { id: 's50', sb: 50, bb: 100, archived: false, sortOrder: 0 }],
      ['s100', { id: 's100', sb: 100, bb: 200, archived: false, sortOrder: 1 }],
    ])
    const a = withResult('cash', 10000, 12000, { stakeId: 's50', durationMin: 120 })
    const b = withResult('cash', 10000, 12000, { stakeId: 's100', durationMin: 120 })
    const v = bbPerHour([a, b], stakes)
    expect(v).toBe(7.5)
    expect(formatBbPerHour(v)).toBe('+7.5 bb/hr')
  })

  it('C5 空集合：所有比率指標為 —，金額為 $0', () => {
    const m = summarize([])
    expect(m.count).toBe(0)
    for (const v of [m.winRate, m.avgProfit, m.roi, m.hourly, m.feeRate]) expect(v).toBeNull()
    expect(bbPerHour([], new Map())).toBeNull()
    expect(itm([]).rate).toBeNull()
    expect(averagePlacePercentile([])).toEqual({ value: null, n: 0 })
    expect(tournamentMetrics([])).toEqual({ avgEntries: null, abi: null })

    expect(formatFraction(m.winCount, m.count)).toBe('—')
    expect(formatSignedMoney(m.avgProfit)).toBe('—')
    expect(formatSignedPercent(m.roi)).toBe('—')
    expect(formatHourly(m.hourly)).toBe('—')
    expect(formatPercent(m.feeRate)).toBe('—')
    expect(formatBbPerHour(bbPerHour([], new Map()))).toBe('—')
    expect(formatFraction(itm([]).itmCount, itm([]).count)).toBe('—')
    expect(formatPlacePercentile(averagePlacePercentile([]))).toBe('—')
    expect(formatAvgEntries(tournamentMetrics([]).avgEntries)).toBe('—')
    expect(formatMoney(tournamentMetrics([]).abi)).toBe('—')

    expect(formatSignedMoney(m.profit)).toBe('$0')
    expect(formatMoney(m.totalBuyIn)).toBe('$0')
    expect(formatMoney(m.totalCashOut)).toBe('$0')
    expect(formatMoney(m.totalFee)).toBe('$0')
  })

  it('C6 買入 1,000 服務費 1,000：合法（fee = amount 邊界）', () => {
    expect(buyInSchema.safeParse({ amount: 1000, fee: 1000 }).success).toBe(true)
    const s = makeSession({ type: 'mtt', buyIns: [{ amount: 1000, fee: 1000 }], cashOut: 0 })
    expect(sessionSchema.safeParse(s).success).toBe(true)
    expect(buyInSchema.safeParse({ amount: 1000, fee: 1001 }).success).toBe(false)
  })

  it('C7 平均盈利 −2.5：顯示 −$3', () => {
    const m = summarize([withResult('cash', 10, 8), withResult('cash', 10, 7)])
    expect(m.avgProfit).toBe(-2.5)
    expect(formatSignedMoney(m.avgProfit)).toBe('−$3')
  })

  it('C8 MTT 三場 10/100、30/100、未填：平均名次百分位 前 20.0%（n=2）', () => {
    const sessions = [
      makeSession({ type: 'mtt', fieldSize: 100, finishPlace: 10 }),
      makeSession({ type: 'mtt', fieldSize: 100, finishPlace: 30 }),
      makeSession({ type: 'mtt' }),
    ]
    const p = averagePlacePercentile(sessions)
    expect(p.n).toBe(2)
    expect(p.value).toBeCloseTo(0.2, 12)
    expect(formatPlacePercentile(p)).toBe('前 20.0%（n=2）')
  })

  it('C9 今天 2026-05-31 近三個月：起日 2026-02-28 00:00', () => {
    const r = resolvePeriod({ kind: 'last3Months' }, '2026-05-31')
    expect(r).toEqual({ ok: true, range: { from: '2026-02-28', to: '2026-05-31' } })
    const inside = makeSession({ startAt: '2026-02-28T00:00' })
    const before = makeSession({ startAt: '2026-02-27T23:00' })
    const lastHour = makeSession({ startAt: '2026-05-31T23:00' })
    const result = filterByPeriod([before, inside, lastHour], { kind: 'last3Months' }, '2026-05-31')
    expect(result.ok && result.sessions).toEqual([inside, lastHour])
  })

  it('C10 自訂期間起迄同一天：該日 00:00–23:59 的場次都包含', () => {
    const first = makeSession({ startAt: '2026-09-27T00:00' })
    const last = makeSession({ startAt: '2026-09-27T23:00' })
    const prev = makeSession({ startAt: '2026-09-26T23:00' })
    const next = makeSession({ startAt: '2026-09-28T00:00' })
    const result = filterByPeriod(
      [prev, first, last, next],
      { kind: 'custom', from: '2026-09-27', to: '2026-09-27' },
      '2026-09-28',
    )
    expect(result.ok && result.sessions).toEqual([first, last])
  })

  it('C11 ITM%：10 場中 3 場到手 > 0 顯示 3/10（30.0%）', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => withResult('mtt', 1000, i < 3 ? 5000 : 0))
    const m = itm(sessions)
    expect(m).toEqual({ itmCount: 3, count: 10, rate: 0.3 })
    expect(formatFraction(m.itmCount, m.count)).toBe('3/10（30.0%）')
  })

  it('C12 ABI：一場 1 次買入 3,000、一場 2 次共 6,000，ABI = 9,000 ÷ 3 = 3,000', () => {
    const sessions = [
      makeSession({ type: 'mtt', buyIns: [{ amount: 3000, fee: 0 }] }),
      makeSession({
        type: 'timed_mtt',
        buyIns: [
          { amount: 3000, fee: 0 },
          { amount: 3000, fee: 0 },
        ],
      }),
    ]
    const m = tournamentMetrics(sessions)
    expect(m.abi).toBe(3000)
    expect(formatMoney(m.abi)).toBe('$3,000')
    expect(m.avgEntries).toBe(1.5)
    expect(formatAvgEntries(m.avgEntries)).toBe('1.50')
  })
})
