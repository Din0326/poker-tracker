import { describe, expect, it } from 'vitest'
import { formatBbProfit, formatDuration, formatFieldSizeOnly, formatFinishPlace, formatTimestamp } from '../../src/domain/format'
import { localIso } from './helpers/time'

// 7.2 詳情用的顯示格式
const MINUS = '−'

describe('7.2 formatDuration', () => {
  it('`4 小時 30 分`；0 分與 0 小時也顯示（規格未載明，保守顯示兩段）', () => {
    expect(formatDuration(270)).toBe('4 小時 30 分')
    expect(formatDuration(240)).toBe('4 小時 0 分')
    expect(formatDuration(5)).toBe('0 小時 5 分')
    expect(formatDuration(4320)).toBe('72 小時 0 分')
  })
})

describe('7.2 formatBbProfit', () => {
  it('小數 1 位、帶正負號', () => {
    expect(formatBbProfit(20)).toBe('+20.0 bb')
    expect(formatBbProfit(-12.25)).toBe(`${MINUS}12.3 bb`)
    expect(formatBbProfit(0)).toBe('0.0 bb')
    expect(formatBbProfit(-0.04)).toBe('0.0 bb')
    expect(formatBbProfit(null)).toBe('—')
  })
})

describe('7.2 formatFinishPlace', () => {
  it('`第 12 名 / 180 人（前 6.7%）`', () => {
    expect(formatFinishPlace(12, 180, 12 / 180)).toBe('第 12 名 / 180 人（前 6.7%）')
    expect(formatFinishPlace(1, 2, 0.5)).toBe('第 1 名 / 2 人（前 50.0%）')
  })
})

describe('7.2 formatFieldSizeOnly', () => {
  it('MTT 只填參賽人數：`共 180 人`', () => {
    expect(formatFieldSizeOnly(180)).toBe('共 180 人')
    expect(formatFieldSizeOnly(2)).toBe('共 2 人')
    // 與 formatFinishPlace 一致，人數不加千分位
    expect(formatFieldSizeOnly(1200)).toBe('共 1200 人')
  })
})

describe('7.2 formatTimestamp', () => {
  it('以本地時間顯示 `YYYY/MM/DD HH:mm`', () => {
    // 以本地時間建構後轉為含時區的 ISO，與時區設定無關
    expect(formatTimestamp(localIso(2026, 9, 28, 21, 5, 0))).toBe('2026/09/28 21:05')
    expect(formatTimestamp('not a date')).toBe('—')
  })
})
