import { describe, expect, it } from 'vitest'
import {
  MissingStakeError,
  averagePlacePercentile,
  bbPerHour,
  itm,
  summarize,
  tournamentMetrics,
} from '../../src/domain/aggregate'
import { bbProfit, buyInTotal, entryCount, feeTotal, fullProfit, myProfit, sessionResult } from '../../src/domain/session'
import type { Stake } from '../../src/domain/types'
import { makeSession, withResult } from './helpers/fixtures'

const stake = (id: string, sb: number, bb: number): [string, Stake] => [id, { id, sb, bb, archived: false, sortOrder: 0 }]

describe('4.1 單一場次', () => {
  it('服務費不從盈利扣除', () => {
    const s = makeSession({ buyIns: [{ amount: 1000, fee: 300 }], cashOut: 1500 })
    expect(buyInTotal(s)).toBe(1000)
    expect(feeTotal(s)).toBe(300)
    expect(entryCount(s)).toBe(1)
    expect(fullProfit(s)).toBe(500)
    expect(myProfit(s)).toBe(500)
    expect(sessionResult(s)).toBe('win')
  })

  it('現金桌 bb 盈利 = 盈利 ÷ bb，不捨入', () => {
    const s = withResult('cash', 10000, 10150)
    expect(bbProfit(s, { bb: 100 })).toBe(1.5)
    expect(bbProfit(withResult('cash', 100, 0), { bb: 300 })).toBeCloseTo(-1 / 3, 15)
  })
})

describe('4.2 彙總指標', () => {
  const sessions = [
    makeSession({ buyIns: [{ amount: 1000, fee: 100 }], cashOut: 3000, durationMin: 90 }), // +2000
    makeSession({ buyIns: [{ amount: 2000, fee: 0 }], cashOut: 0, durationMin: 30 }), // −2000
    makeSession({ type: 'mtt', buyIns: [{ amount: 1100, fee: 100 }, { amount: 1100, fee: 100 }], cashOut: 5000, durationMin: 240 }), // +2800
    makeSession({ buyIns: [{ amount: 500, fee: 0 }], cashOut: 500, durationMin: 60 }), // 0
  ]

  it('各項加總與比率', () => {
    const m = summarize(sessions)
    expect(m.profit).toBe(2800)
    expect(m.count).toBe(4)
    expect(m.winCount).toBe(2)
    expect(m.winRate).toBe(0.5)
    expect(m.avgProfit).toBe(700)
    expect(m.totalBuyIn).toBe(5700)
    expect(m.totalCashOut).toBe(8500)
    expect(m.roi).toBe(2800 / 5700)
    expect(m.totalMinutes).toBe(420)
    expect(m.totalHours).toBe(7)
    expect(m.hourly).toBe(400)
    expect(m.totalFee).toBe(300)
    expect(m.feeRate).toBe(300 / 5700)
  })

  it('不提前捨入：比率保留完整浮點值', () => {
    const m = summarize([makeSession({ buyIns: [{ amount: 3, fee: 1 }], cashOut: 4, durationMin: 7 })])
    expect(m.roi).toBe(1 / 3)
    expect(m.feeRate).toBe(1 / 3)
    expect(m.totalHours).toBe(7 / 60)
    expect(m.hourly).toBe(1 / (7 / 60))
  })

  it('Σ 買入總額為 0 不會發生，但空集合時 ROI、服務費比例為 null', () => {
    const m = summarize([])
    expect(m.roi).toBeNull()
    expect(m.feeRate).toBeNull()
    expect(m.hourly).toBeNull()
    expect(m.profit).toBe(0)
    expect(m.totalHours).toBe(0)
  })
})

describe('4.3 類型專屬指標', () => {
  it('bb/hr 只計入現金桌，時數也只算現金桌', () => {
    const stakes = new Map([stake('a', 50, 100)])
    const cash = withResult('cash', 1000, 1300, { stakeId: 'a', durationMin: 60 }) // +3bb
    const mtt = withResult('mtt', 1000, 0, { durationMin: 600 })
    expect(bbPerHour([cash, mtt], stakes)).toBe(3)
  })

  it('bb/hr 在只有錦標賽時為 null', () => {
    expect(bbPerHour([withResult('mtt', 1000, 0)], new Map())).toBeNull()
  })

  it('bb/hr 找不到盲注時丟出 MissingStakeError', () => {
    const s = withResult('cash', 1000, 0, { stakeId: 'missing' })
    expect(() => bbPerHour([s], new Map())).toThrow(MissingStakeError)
  })

  it('ITM% 只計入 mtt；到手 0 不算', () => {
    const r = itm([withResult('mtt', 100, 1), withResult('mtt', 100, 0), withResult('timed_mtt', 100, 500), withResult('cash', 100, 500)])
    expect(r).toEqual({ itmCount: 1, count: 2, rate: 0.5 })
  })

  it('平均名次百分位只計 mtt 且兩欄都有填', () => {
    const r = averagePlacePercentile([
      makeSession({ type: 'mtt', fieldSize: 3, finishPlace: 1 }),
      makeSession({ type: 'mtt', fieldSize: 50 }),
    ])
    expect(r).toEqual({ value: 1 / 3, n: 1 })
    expect(averagePlacePercentile([makeSession({ type: 'mtt', fieldSize: 50 })])).toEqual({ value: null, n: 0 })
  })

  it('平均進場次數與 ABI 計入 mtt 與 timed_mtt，不計現金桌', () => {
    const r = tournamentMetrics([
      makeSession({ type: 'mtt', buyIns: [{ amount: 1000, fee: 0 }] }),
      makeSession({ type: 'timed_mtt', buyIns: [{ amount: 2000, fee: 0 }, { amount: 2000, fee: 0 }, { amount: 1000, fee: 0 }] }),
      makeSession({ type: 'cash', buyIns: [{ amount: 99999, fee: 0 }] }),
    ])
    expect(r.avgEntries).toBe(2)
    expect(r.abi).toBe(6000 / 4)
  })
})
