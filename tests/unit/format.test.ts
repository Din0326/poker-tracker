import { describe, expect, it } from 'vitest'
import {
  formatAvgEntries,
  formatBbPerHour,
  formatFraction,
  formatHourly,
  formatHours,
  formatMoney,
  formatPercent,
  formatPlacePercentile,
  formatSignedMoney,
  formatSignedPercent,
  roundHalfAwayFromZero,
  stakeLabel,
} from '../../src/domain/format'

const MINUS = '−'

describe('A6 roundHalfAwayFromZero', () => {
  it('以絕對值進位', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3)
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2)
    expect(roundHalfAwayFromZero(0.05, 1)).toBe(0.1)
    expect(roundHalfAwayFromZero(-0.05, 1)).toBe(-0.1)
    expect(roundHalfAwayFromZero(1.25, 1)).toBe(1.3)
    expect(roundHalfAwayFromZero(1.125, 2)).toBe(1.13)
  })

  it('處理浮點誤差', () => {
    expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01)
    expect(roundHalfAwayFromZero(-1.005, 2)).toBe(-1.01)
    expect(roundHalfAwayFromZero(2.675, 2)).toBe(2.68)
    expect(roundHalfAwayFromZero(1.45, 1)).toBe(1.5)
    // 0.0105 × 100 在浮點數為 1.0499999999999998
    expect(roundHalfAwayFromZero(0.0105 * 100, 1)).toBe(1.1)
    expect(roundHalfAwayFromZero(0.1 + 0.2, 1)).toBe(0.3)
  })

  it('進位後為 0 時回傳 +0，不是 −0', () => {
    expect(Object.is(roundHalfAwayFromZero(-0.04, 1), 0)).toBe(true)
    expect(Object.is(roundHalfAwayFromZero(-0.4), 0)).toBe(true)
    expect(Object.is(roundHalfAwayFromZero(-0), 0)).toBe(true)
  })

  it('極小值與非有限值', () => {
    expect(roundHalfAwayFromZero(1e-9, 1)).toBe(0)
    expect(roundHalfAwayFromZero(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('A7 金額', () => {
  it('帶正負號：盈利、平均每場盈利', () => {
    expect(formatSignedMoney(1523)).toBe('+$1,523')
    expect(formatSignedMoney(-4000)).toBe(`${MINUS}$4,000`)
    expect(formatSignedMoney(0)).toBe('$0')
    expect(formatSignedMoney(-0.4)).toBe('$0')
    expect(formatSignedMoney(0.4)).toBe('$0')
    expect(formatSignedMoney(1234567.5)).toBe('+$1,234,568')
    expect(formatSignedMoney(-1234567.5)).toBe(`${MINUS}$1,234,568`)
    expect(formatSignedMoney(99_999_999)).toBe('+$99,999,999')
    expect(formatSignedMoney(null)).toBe('—')
  })

  it('不帶號：總投入、總到手、總服務費、ABI', () => {
    expect(formatMoney(1523)).toBe('$1,523')
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(999)).toBe('$999')
    expect(formatMoney(1000)).toBe('$1,000')
    expect(formatMoney(2999.5)).toBe('$3,000')
    expect(formatMoney(null)).toBe('—')
  })

  it('時薪：金額加 /hr，帶正負號', () => {
    expect(formatHourly(250)).toBe('+$250/hr')
    expect(formatHourly(-1250.5)).toBe(`${MINUS}$1,251/hr`)
    expect(formatHourly(0)).toBe('$0/hr')
    expect(formatHourly(null)).toBe('—')
  })
})

describe('A6 A7 百分比與 bb/hr', () => {
  it('ROI 帶正負號、小數 1 位', () => {
    expect(formatSignedPercent(0.075)).toBe('+7.5%')
    expect(formatSignedPercent(-0.123)).toBe(`${MINUS}12.3%`)
    expect(formatSignedPercent(0)).toBe('0.0%')
    expect(formatSignedPercent(-0.0004)).toBe('0.0%')
    expect(formatSignedPercent(-0.0005)).toBe(`${MINUS}0.1%`)
    expect(formatSignedPercent(1.5)).toBe('+150.0%')
    expect(formatSignedPercent(null)).toBe('—')
  })

  it('服務費比例不帶號', () => {
    expect(formatPercent(600 / 6600)).toBe('9.1%')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(0.0105)).toBe('1.1%')
    expect(formatPercent(null)).toBe('—')
  })

  it('bb/hr 帶正負號、小數 1 位', () => {
    expect(formatBbPerHour(7.5)).toBe('+7.5 bb/hr')
    expect(formatBbPerHour(-12.25)).toBe(`${MINUS}12.3 bb/hr`)
    expect(formatBbPerHour(-0.04)).toBe('0.0 bb/hr')
    expect(formatBbPerHour(0)).toBe('0.0 bb/hr')
    expect(formatBbPerHour(null)).toBe('—')
  })
})

describe('其他格式', () => {
  it('贏率、ITM%：全形括號', () => {
    expect(formatFraction(13, 26)).toBe('13/26（50.0%）')
    expect(formatFraction(8, 40)).toBe('8/40（20.0%）')
    expect(formatFraction(1, 3)).toBe('1/3（33.3%）')
    expect(formatFraction(2, 3)).toBe('2/3（66.7%）')
    expect(formatFraction(0, 0)).toBe('—')
  })

  it('平均名次百分位', () => {
    expect(formatPlacePercentile({ value: 0.235, n: 12 })).toBe('前 23.5%（n=12）')
    expect(formatPlacePercentile({ value: 12 / 180, n: 1 })).toBe('前 6.7%（n=1）')
    expect(formatPlacePercentile({ value: null, n: 0 })).toBe('—')
  })

  it('平均進場次數小數 2 位', () => {
    expect(formatAvgEntries(1)).toBe('1.00')
    expect(formatAvgEntries(4 / 3)).toBe('1.33')
    expect(formatAvgEntries(1.005)).toBe('1.01')
    expect(formatAvgEntries(null)).toBe('—')
  })

  it('A8 總時數固定 1 位小數', () => {
    expect(formatHours(4)).toBe('4.0 小時')
    expect(formatHours(123.5)).toBe('123.5 小時')
    expect(formatHours(0)).toBe('0.0 小時')
    expect(formatHours(7 / 60)).toBe('0.1 小時')
    expect(formatHours(1.25)).toBe('1.3 小時')
  })

  it('盲注顯示名稱 sb/bb', () => {
    expect(stakeLabel({ sb: 50, bb: 100 })).toBe('50/100')
  })
})
