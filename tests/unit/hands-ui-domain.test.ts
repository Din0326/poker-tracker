// H1 新增的 domain/hands 純函式：4.12 顯示格式、5.6 標籤建議、行動紀錄的跟注金額與全下、5.8 由位置推算按鈕
import { describe, expect, it } from 'vitest'
import {
  buttonSeatForPosition,
  cardName,
  cardText,
  describeActions,
  filterTagSuggestions,
  formatHandAmount,
  formatHandBb,
  formatSignedHandAmount,
  formatStackBb,
  handTagHistory,
  positionText,
  type Action,
} from '../../src/domain/hands'

describe('4.12 金額格式依單位（HC29 畫面部分）', () => {
  it('元：$ 前綴、整數、千分位', () => {
    expect(formatHandAmount(200, 'yuan')).toBe('$200')
    expect(formatHandAmount(16800, 'yuan')).toBe('$16,800')
    expect(formatSignedHandAmount(16800, 'yuan')).toBe('+$16,800')
    expect(formatSignedHandAmount(-17100, 'yuan')).toBe('−$17,100')
    expect(formatSignedHandAmount(0, 'yuan')).toBe('$0')
  })

  it('分：固定 2 位小數（整數運算）', () => {
    expect(formatHandAmount(25, 'cent')).toBe('$0.25')
    expect(formatHandAmount(100, 'cent')).toBe('$1.00')
    expect(formatHandAmount(123456, 'cent')).toBe('$1,234.56')
    expect(formatSignedHandAmount(0, 'cent')).toBe('$0.00')
  })

  it('籌碼：不加 $', () => {
    expect(formatHandAmount(1500, 'chip')).toBe('1,500')
    expect(formatSignedHandAmount(0, 'chip')).toBe('0')
    expect(formatSignedHandAmount(null, 'chip')).toBe('—')
  })

  it('bb 顯示（HC27）與籌碼的 bb', () => {
    expect(formatHandBb(16800, 200)).toBe('+84.0 bb')
    expect(formatHandBb(356, 25)).toBe('+14.2 bb')
    expect(formatHandBb(-1250, 100)).toBe('−12.5 bb')
    expect(formatHandBb(-25, 10)).toBe('−2.5 bb')
    expect(formatHandBb(-1, 40)).toBe('0.0 bb')
    expect(formatStackBb(20000, 200)).toBe('100.0 bb')
    expect(formatStackBb(10050, 100)).toBe('100.5 bb')
  })
})

describe('3.6 牌面顯示、3.7 位置顯示', () => {
  it('T 顯示為 10、花色符號；完整名稱', () => {
    expect(cardText('As')).toBe('A♠')
    expect(cardText('Th')).toBe('10♥')
    expect(cardText('2c')).toBe('2♣')
    expect(cardName('Kd')).toBe('方塊 K')
    expect(cardName('Th')).toBe('紅心 10')
  })

  it('UTG1 顯示為 UTG+1', () => {
    expect(positionText('UTG1')).toBe('UTG+1')
    expect(positionText('BTN')).toBe('BTN')
  })
})

describe('5.6 標籤建議', () => {
  const hands = [
    { tags: ['3bet', 'Bluff'], playedAt: '2026-09-01T20:00:00', createdAt: '2026-09-01T23:00:00+08:00' },
    { tags: ['bluff', 'river'], playedAt: '2026-09-20T20:00:00', createdAt: '2026-09-20T23:00:00+08:00' },
    { tags: ['squeeze'], playedAt: '2026-09-20T20:00:00', createdAt: '2026-09-20T23:30:00+08:00' },
    { tags: [], playedAt: '2026-09-30T20:00:00', createdAt: '2026-09-30T23:00:00+08:00' },
  ]

  it('去重不分大小寫、保留最近寫法；依最近使用（playedAt，同時間依 createdAt）排序', () => {
    expect(handTagHistory(hands)).toEqual(['squeeze', 'bluff', 'river', '3bet'])
  })

  it('部分符合、排除本手已加的標籤（不分大小寫）、最多 8 筆', () => {
    const history = handTagHistory(hands)
    expect(filterTagSuggestions(history, 'U', [])).toEqual(['squeeze', 'bluff'])
    expect(filterTagSuggestions(history, '', ['BLUFF'])).toEqual(['squeeze', 'river', '3bet'])
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`)
    expect(filterTagSuggestions(many, '', [])).toHaveLength(8)
  })
})

describe('行動紀錄（跟注金額與全下由重播推導，3.4）', () => {
  it('7.9 範例：跟注 $300、加注到 $15,900 全下、跟注 $14,300', () => {
    const config = {
      seats: [1, 2, 3, 4, 5, 6].map((seatNo) => ({ seatNo, stack: seatNo === 5 ? 24000 : seatNo === 6 ? 17100 : 20000 })),
      buttonSeat: 4,
      sb: 100,
      bb: 200,
      ante: 0,
      straddle: 0,
    }
    const a = (street: Action['street'], seatNo: number, type: Action['type'], to: number | null = null): Action => ({ street, seatNo, type, to })
    const entries = describeActions(config, [
      a('preflop', 1, 'fold'),
      a('preflop', 2, 'fold'),
      a('preflop', 3, 'fold'),
      a('preflop', 4, 'raise', 500),
      a('preflop', 5, 'fold'),
      a('preflop', 6, 'call'),
      a('flop', 6, 'check'),
      a('flop', 4, 'bet', 700),
      a('flop', 6, 'call'),
      a('turn', 6, 'check'),
      a('turn', 4, 'bet', 1600),
      a('turn', 6, 'raise', 15900),
      a('turn', 4, 'call'),
    ])
    expect(entries.map((e) => [e.action.type, e.amount, e.allIn])).toEqual([
      ['fold', null, false],
      ['fold', null, false],
      ['fold', null, false],
      ['raise', 500, false],
      ['fold', null, false],
      ['call', 300, false],
      ['check', null, false],
      ['bet', 700, false],
      ['call', 700, false],
      ['check', null, false],
      ['bet', 1600, false],
      ['raise', 15900, true],
      ['call', 14300, false],
    ])
  })

  it('跟注不足時為全下；遇到不合法的行動時停止', () => {
    const config = { seats: [{ seatNo: 1, stack: 5000 }, { seatNo: 2, stack: 600 }], buttonSeat: 1, sb: 100, bb: 200, ante: 0, straddle: 0 }
    const entries = describeActions(config, [
      { street: 'preflop', seatNo: 1, type: 'raise', to: 1000 },
      { street: 'preflop', seatNo: 2, type: 'call', to: null },
      { street: 'flop', seatNo: 2, type: 'check', to: null },
    ])
    expect(entries.map((e) => [e.action.type, e.amount, e.allIn])).toEqual([
      ['raise', 1000, false],
      ['call', 400, true],
    ])
  })
})

describe('5.8 補齊：依位置推算按鈕座位', () => {
  const six = [1, 2, 3, 4, 5, 6]
  it('6 人桌你在座位 1：CO → 按鈕座位 2；BTN → 1；BB → 5', () => {
    expect(buttonSeatForPosition(six, 1, 'CO')).toBe(2)
    expect(buttonSeatForPosition(six, 1, 'BTN')).toBe(1)
    expect(buttonSeatForPosition(six, 1, 'BB')).toBe(5)
  })
  it('位置在該人數不存在時推算不出（null）', () => {
    expect(buttonSeatForPosition(six, 1, 'UTG3')).toBeNull()
    expect(buttonSeatForPosition(six, 7, 'CO')).toBeNull()
  })
})
