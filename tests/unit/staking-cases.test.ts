import { describe, expect, it } from 'vitest'
import { bbPerHour, itm, summarize, tournamentMetrics } from '../../src/domain/aggregate'
import {
  formatBbPerHour,
  formatBbProfit,
  formatCsvPermille,
  formatFraction,
  formatHourly,
  formatMarkup,
  formatMoney,
  formatPercent,
  formatPermille,
  formatSignedMoney,
  formatSignedPercent,
} from '../../src/domain/format'
import {
  backerPay,
  backerPayTotal,
  backerPayout,
  backerPayoutTotal,
  bbProfit,
  buyInTotal,
  feeTotal,
  fullProfit,
  myCashOut,
  myCost,
  myProfit,
  sessionResult,
  stakingBreakdown,
} from '../../src/domain/session'
import type { Backer, Session, SessionType, Stake } from '../../src/domain/types'
import { buildMetricCards } from '../../src/features/report/reportModel'
import { makeSession, withResult } from './helpers/fixtures'

// 10.2 賣股份必測案例 C13–C26（v1.2，4.6），期望值完全依規格表。
// 「A 10% ×1.2」表示出資者 A、sharePermille 100、markupPermille 1200；未註明服務費者服務費為 0。

const backer = (name: string, sharePermille: number, markupPermille = 1000): Backer => ({
  name,
  sharePermille,
  markupPermille,
})

function staked(
  type: SessionType,
  buyIn: number,
  cashOut: number,
  backers: Backer[],
  extra: Partial<Session> = {},
): Session {
  return makeSession({ type, buyIns: [{ amount: buyIn, fee: 0 }], cashOut, backers, ...extra })
}

const c13Backers = [backer('A', 100), backer('B', 200)]
const c14Backers = [backer('A', 100, 1200), backer('B', 200, 1200)]

/** 以浮點數實作的錯誤版本（只用來證明 C21 的測試能抓到浮點陷阱） */
const floatPay = (total: number, b: Backer) => Math.round(total * (b.sharePermille / 1000) * (b.markupPermille / 1000))

describe('10.2 賣股份必測案例（C13–C26）', () => {
  it('C13 MTT 買入 10,000；A 10% ×1.0、B 20% ×1.0；到手 50,000', () => {
    const s = staked('mtt', 10000, 50000, c13Backers)
    const total = buyInTotal(s)
    expect(c13Backers.map((b) => backerPay(total, b))).toEqual([1000, 2000])
    expect(backerPayTotal(s)).toBe(3000)
    expect(c13Backers.map((b) => backerPayout(s.cashOut, b))).toEqual([5000, 10000])
    expect(backerPayoutTotal(s)).toBe(15000)
    expect(myCost(s)).toBe(7000)
    expect(myCashOut(s)).toBe(35000)
    expect(myProfit(s)).toBe(28000)
    expect(formatSignedMoney(myProfit(s))).toBe('+$28,000')
    expect(fullProfit(s)).toBe(40000)
    expect(sessionResult(s)).toBe('win')
    // 詳情用的明細與上方各函式一致
    expect(stakingBreakdown(s)).toMatchObject({
      payTotal: 3000,
      payoutTotal: 15000,
      myCost: 7000,
      myCashOut: 35000,
      myProfit: 28000,
      fullProfit: 40000,
      soldPermille: 300,
      myPermille: 700,
    })
  })

  it('C14 同 C13，但 A、B 皆 ×1.2', () => {
    const s = staked('mtt', 10000, 50000, c14Backers)
    expect(c14Backers.map((b) => backerPay(10000, b))).toEqual([1200, 2400])
    expect(backerPayTotal(s)).toBe(3600)
    expect(myCost(s)).toBe(6400)
    expect(c14Backers.map((b) => backerPayout(50000, b))).toEqual([5000, 10000])
    expect(backerPayoutTotal(s)).toBe(15000)
    expect(myCashOut(s)).toBe(35000)
    expect(myProfit(s)).toBe(28600)
  })

  it('C15 C13、C14 的條件，到手改為 0', () => {
    const a = staked('mtt', 10000, 0, c13Backers)
    const b = staked('mtt', 10000, 0, c14Backers)
    expect(myProfit(a)).toBe(-7000)
    expect(myProfit(b)).toBe(-6400)
    for (const s of [a, b]) {
      expect(backerPayoutTotal(s)).toBe(0)
      expect(fullProfit(s)).toBe(-10000)
      expect(sessionResult(s)).toBe('loss')
    }
  })

  it('C16 全部賣出不加價：MTT 買入 5,000；A 100% ×1.0；到手 12,000', () => {
    const s = staked('mtt', 5000, 12000, [backer('A', 1000)])
    expect(backerPayTotal(s)).toBe(5000)
    expect(backerPayoutTotal(s)).toBe(12000)
    expect(myCost(s)).toBe(0)
    expect(myCashOut(s)).toBe(0)
    expect(myProfit(s)).toBe(0)
    expect(sessionResult(s)).toBe('even')
    expect(fullProfit(s)).toBe(7000)
    // 只含此場的集合 ROI 為 —（分母 0）
    const m = summarize([s])
    expect(m.roi).toBeNull()
    expect(formatSignedPercent(m.roi)).toBe('—')
  })

  it('C17 全部賣出加價：MTT 買入 5,000；A 100% ×1.1；到手 0', () => {
    const s = staked('mtt', 5000, 0, [backer('A', 1000, 1100)])
    expect(backerPayTotal(s)).toBe(5500)
    expect(backerPayoutTotal(s)).toBe(0)
    expect(myCost(s)).toBe(-500)
    expect(myCashOut(s)).toBe(0)
    expect(myProfit(s)).toBe(500)
    expect(sessionResult(s)).toBe('win')
    expect(fullProfit(s)).toBe(-5000)
    const m = summarize([s])
    // 只含此場的集合 ROI 為 —（分母 < 0）；總投入顯示 −$500
    expect(m.roi).toBeNull()
    expect(formatSignedPercent(m.roi)).toBe('—')
    expect(m.totalBuyIn).toBe(-500)
    expect(formatMoney(m.totalBuyIn)).toBe('−$500')
  })

  it('C18 捨入：買入 1,005；A 33.3% ×1.0；到手 2,005', () => {
    const a = backer('A', 333)
    const s = staked('mtt', 1005, 2005, [a])
    // pay = 334.665 → 335；payout = 667.665 → 668
    expect(backerPay(1005, a)).toBe(335)
    expect(backerPayout(2005, a)).toBe(668)
    expect(myCost(s)).toBe(670)
    expect(myCashOut(s)).toBe(1337)
    expect(myProfit(s)).toBe(667)
    expect(fullProfit(s)).toBe(1000)
  })

  it('C19 0.5 進位：買入 1,005；A 50% ×1.0；到手 1,001', () => {
    const a = backer('A', 500)
    const s = staked('mtt', 1005, 1001, [a])
    // pay = 502.5 → 503；payout = 500.5 → 501
    expect(backerPay(1005, a)).toBe(503)
    expect(backerPayout(1001, a)).toBe(501)
    expect(myCost(s)).toBe(502)
    expect(myCashOut(s)).toBe(500)
    expect(myProfit(s)).toBe(-2)
    expect(fullProfit(s)).toBe(-4)
  })

  it('C20 多位出資者合計 100%：買入 1,000；A 33.3% ×1.0、B 33.3% ×1.2、C 33.4% ×1.0；到手 2,000', () => {
    const backers = [backer('A', 333), backer('B', 333, 1200), backer('C', 334)]
    const s = staked('mtt', 1000, 2000, backers)
    // B：399.6 進位為 400
    expect(backers.map((b) => backerPay(1000, b))).toEqual([333, 400, 334])
    expect(backerPayTotal(s)).toBe(1067)
    expect(backers.map((b) => backerPayout(2000, b))).toEqual([666, 666, 668])
    expect(backerPayoutTotal(s)).toBe(2000)
    expect(myCost(s)).toBe(-67)
    expect(myCashOut(s)).toBe(0)
    expect(myProfit(s)).toBe(67)
    expect(fullProfit(s)).toBe(1000)
  })

  it('C21 浮點陷阱：買入 1,050；A 20% ×1.15 → pay = 242（浮點數實作會得 241）', () => {
    const a = backer('A', 200, 1150)
    expect(backerPay(1050, a)).toBe(242)
    // 證明此測試能抓到浮點數實作：同樣的輸入以浮點數計算得 241，與正確值不同
    expect(floatPay(1050, a)).toBe(241)
    expect(floatPay(1050, a)).not.toBe(backerPay(1050, a))
    expect(myCost(staked('mtt', 1050, 0, [a]))).toBe(1050 - 242)
  })

  it('C22 彙總口徑：MTT 兩場（第 1 場同 C13 但服務費 1,000；第 2 場買入 3,000、到手 0、無出資者）', () => {
    const first = makeSession({
      type: 'mtt',
      buyIns: [{ amount: 10000, fee: 1000 }],
      cashOut: 50000,
      backers: c13Backers,
      stakeId: null,
    })
    const second = makeSession({ type: 'mtt', buyIns: [{ amount: 3000, fee: 0 }], cashOut: 0, stakeId: null })
    const m = summarize([first, second])
    expect(m.profit).toBe(25000)
    expect(formatSignedMoney(m.profit)).toBe('+$25,000')
    expect(formatFraction(m.winCount, m.count)).toBe('1/2（50.0%）')
    expect(m.totalBuyIn).toBe(10000)
    expect(m.totalCashOut).toBe(35000)
    expect(m.roi).toBe(2.5)
    expect(formatSignedPercent(m.roi)).toBe('+250.0%')
    // 不得為全額口徑的 37,000 ÷ 13,000 = +284.6%
    expect(formatSignedPercent(m.roi)).not.toBe('+284.6%')
    const t = tournamentMetrics([first, second])
    expect(t.abi).toBe(6500)
    expect(formatMoney(t.abi)).toBe('$6,500')
    expect(m.totalFee).toBe(1000)
    expect(m.feeRate).toBeCloseTo(1000 / 13000, 15)
    expect(formatPercent(m.feeRate)).toBe('7.7%')
    // 報表 MTT 頁籤的指標卡同樣顯示 ROI +250.0%、ABI $6,500
    const cards = Object.fromEntries(buildMetricCards([first, second], 'mtt', new Map()).map((c) => [c.key, c.value.text]))
    expect(cards).toMatchObject({
      profit: '+$25,000',
      winRate: '1/2（50.0%）',
      roi: '+250.0%',
      abi: '$6,500',
      totalBuyIn: '$10,000',
      totalCashOut: '$35,000',
      totalFee: '$1,000',
      feeRate: '7.7%',
    })
  })

  it('C23 現金桌 50/100，買入 10,000；A 50% ×1.0；到手 14,000；2 小時', () => {
    const stake: Stake = { id: 's50', sb: 50, bb: 100, archived: false, sortOrder: 0 }
    const s = staked('cash', 10000, 14000, [backer('A', 500)], { stakeId: 's50', durationMin: 120 })
    expect(backerPayTotal(s)).toBe(5000)
    expect(backerPayoutTotal(s)).toBe(7000)
    expect(myProfit(s)).toBe(2000)
    expect(fullProfit(s)).toBe(4000)
    expect(bbProfit(s, stake)).toBe(20)
    expect(formatBbProfit(bbProfit(s, stake))).toBe('+20.0 bb')
    const m = summarize([s])
    expect(m.hourly).toBe(1000)
    expect(formatHourly(m.hourly)).toBe('+$1,000/hr')
    const v = bbPerHour([s], new Map([['s50', stake]]))
    expect(v).toBe(10)
    expect(formatBbPerHour(v)).toBe('+10.0 bb/hr')
    // 全額口徑會是 20.0
    expect(formatBbPerHour(v)).not.toBe('+20.0 bb/hr')
  })

  it('C24 ITM 用全額：MTT 兩場皆 A 100% ×1.0，到手分別 8,000、0', () => {
    const a = staked('mtt', 1000, 8000, [backer('A', 1000)], { stakeId: null })
    const b = staked('mtt', 1000, 0, [backer('A', 1000)], { stakeId: null })
    // 第 1 場你的到手為 0，但 cashOut > 0 仍算進錢圈
    expect(myCashOut(a)).toBe(0)
    const r = itm([a, b])
    expect(formatFraction(r.itmCount, r.count)).toBe('1/2（50.0%）')
  })

  it('C25 顯示格式（4.4）', () => {
    expect(formatPermille(125)).toBe('12.5%')
    expect(formatPermille(300)).toBe('30%')
    expect(formatPermille(1000)).toBe('100%')
    expect(formatMarkup(1000)).toBe('×1.0')
    expect(formatMarkup(1150)).toBe('×1.15')
    expect(formatMarkup(1125)).toBe('×1.125')
    expect(formatCsvPermille(300)).toBe('30.0')
    expect(formatCsvPermille(0)).toBe('0.0')
  })

  it('C26 無出資者（backers: []）：現金桌買入 10,000，到手 0；結果與 v1.1 完全相同', () => {
    const s = withResult('cash', 10000, 0)
    expect(s.backers).toEqual([])
    expect(myProfit(s)).toBe(-10000)
    expect(fullProfit(s)).toBe(-10000)
    expect(backerPayTotal(s)).toBe(0)
    expect(backerPayoutTotal(s)).toBe(0)
    expect(myCost(s)).toBe(buyInTotal(s))
    expect(myCashOut(s)).toBe(s.cashOut)

    // C1–C12 的資料（backers 皆為 []）：所有彙總指標與 v1.1 的全額公式逐一相同
    const sessions = [
      makeSession({ type: 'timed_mtt', buyIns: [{ amount: 3400, fee: 400 }, { amount: 3200, fee: 200 }], cashOut: 9000, stakeId: null }),
      withResult('cash', 10000, 0),
      withResult('cash', 5000, 5000),
      withResult('cash', 10000, 12000, { durationMin: 120 }),
      makeSession({ type: 'mtt', buyIns: [{ amount: 1000, fee: 1000 }], cashOut: 0, stakeId: null }),
      makeSession({ type: 'mtt', buyIns: [{ amount: 3000, fee: 0 }], cashOut: 300, stakeId: null, fieldSize: 100, finishPlace: 10 }),
    ]
    const m = summarize(sessions)
    const v11Profit = sessions.reduce((sum, x) => sum + x.cashOut - buyInTotal(x), 0)
    const v11BuyIn = sessions.reduce((sum, x) => sum + buyInTotal(x), 0)
    const v11CashOut = sessions.reduce((sum, x) => sum + x.cashOut, 0)
    const v11Fee = sessions.reduce((sum, x) => sum + feeTotal(x), 0)
    const v11Minutes = sessions.reduce((sum, x) => sum + x.durationMin, 0)
    expect(m.profit).toBe(v11Profit)
    expect(m.winCount).toBe(sessions.filter((x) => x.cashOut - buyInTotal(x) > 0).length)
    expect(m.totalBuyIn).toBe(v11BuyIn)
    expect(m.totalCashOut).toBe(v11CashOut)
    expect(m.fullBuyInTotal).toBe(v11BuyIn)
    expect(m.roi).toBe(v11Profit / v11BuyIn)
    expect(m.hourly).toBe(v11Profit / (v11Minutes / 60))
    expect(m.feeRate).toBe(v11Fee / v11BuyIn)
    expect(m.avgProfit).toBe(v11Profit / sessions.length)
    for (const x of sessions) expect(myProfit(x)).toBe(fullProfit(x))
  })
})
