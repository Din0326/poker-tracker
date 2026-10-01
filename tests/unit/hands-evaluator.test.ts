// SPEC-v2-hands 4.10 牌力評估與描述、4.11 下注快捷金額：HC13、HC14、HC15（12.3 H0「牌力、快捷金額」）
import { describe, expect, it } from 'vitest'
import {
  compareHandValues,
  describeHandValue,
  evaluateBest,
  evaluateFive,
  evaluateHand,
  quickBetSizes,
  quickBetSizesFor,
  replay,
  type Card,
} from '../../src/domain/hands'
import { act, detail, seat } from './helpers/hands'

const cards = (s: string): Card[] => s.split(' ')
const best = (hole: string, board: string) => evaluateHand(cards(hole), cards(board))
const describeOf = (five: string) => describeHandValue(evaluateFive(cards(five)))

describe('HC13 牌力', () => {
  it('HC13 `Ah 2c` + `3d 4s 5h Kc Kd` 為順子 Five high，勝過 `Kh Qh`（三條 K）', () => {
    const board = '3d 4s 5h Kc Kd'
    const wheel = best('Ah 2c', board)
    expect(wheel.category).toBe('straight')
    expect(wheel.ranks).toEqual([5])
    const trips = best('Kh Qh', board)
    expect(trips.category).toBe('threeOfAKind')
    expect(compareHandValues(wheel, trips)).toBeGreaterThan(0)
  })

  it('HC13 同花勝順子', () => {
    const board = '9h 8h 7c 6h 2d'
    const flush = best('Ah 3h', board)
    const straight = best('Ts Jd', board)
    expect(flush.category).toBe('flush')
    expect(straight.category).toBe('straight')
    expect(compareHandValues(flush, straight)).toBeGreaterThan(0)
  })

  it('HC13 `As Ks` 勝 `Kd Qs`（公牌 `Kh 7d 2c 9s 3h`，踢腳）', () => {
    const a = best('As Ks', 'Kh 7d 2c 9s 3h')
    const b = best('Kd Qs', 'Kh 7d 2c 9s 3h')
    expect(a.category).toBe('pair')
    expect(b.category).toBe('pair')
    expect(compareHandValues(a, b)).toBeGreaterThan(0)
  })

  it('HC13 公牌皇家同花順時兩人平手', () => {
    const a = best('2c 3d', 'Ts Js Qs Ks As')
    const b = best('4h 5c', 'Ts Js Qs Ks As')
    expect(a.category).toBe('straightFlush')
    expect(compareHandValues(a, b)).toBe(0)
  })

  it('已知牌型由大到小：皇家同花順 > 同花順 > 四條 > 葫蘆 > 同花 > 順子 > 三條 > 兩對 > 一對 > 高牌', () => {
    const ordered = [
      'As Ks Qs Js Ts',
      '9h 8h 7h 6h 5h',
      '5h 4h 3h 2h Ah',
      'Kc Kd Kh Ks 2c',
      'Kc Kd Kh 7s 7c',
      'Ad Jd 8d 6d 3d',
      'Td 9c 8h 7s 6c',
      '5d 4c 3h 2s Ac',
      'Qc Qd Qh 9s 2c',
      'Kc Kd 7h 7s 2c',
      'Kc Kd 9h 7s 2c',
      'Ac Qd 9h 7s 2c',
    ].map((h) => evaluateFive(cards(h)))
    expect(ordered.map((v) => v.category)).toEqual([
      'straightFlush',
      'straightFlush',
      'straightFlush',
      'fourOfAKind',
      'fullHouse',
      'flush',
      'straight',
      'straight',
      'threeOfAKind',
      'twoPair',
      'pair',
      'highCard',
    ])
    for (let i = 1; i < ordered.length; i++) expect(compareHandValues(ordered[i - 1]!, ordered[i]!)).toBeGreaterThan(0)
  })

  it('踢腳比較：同牌型依 5 張逐張比較；花色不分大小', () => {
    expect(compareHandValues(evaluateFive(cards('Ac Kd 9h 7s 3c')), evaluateFive(cards('Ad Kc 9s 7h 2c')))).toBeGreaterThan(0)
    expect(compareHandValues(evaluateFive(cards('Kc Kd 7h 7s Ac')), evaluateFive(cards('Kh Ks 7d 7c Qc')))).toBeGreaterThan(0)
    expect(compareHandValues(evaluateFive(cards('Kc Kd 8h 8s 2c')), evaluateFive(cards('Kh Ks 7d 7c Ac')))).toBeGreaterThan(0)
    expect(compareHandValues(evaluateFive(cards('Qc Qd Qh 5s 5c')), evaluateFive(cards('Jh Js Jd Ac Ad')))).toBeGreaterThan(0)
    expect(compareHandValues(evaluateFive(cards('Ac Kc 9c 7c 3c')), evaluateFive(cards('Ah Kh 9h 7h 3h')))).toBe(0)
    // A-2-3-4-5 是最小的順子
    expect(compareHandValues(evaluateFive(cards('6c 5d 4h 3s 2c')), evaluateFive(cards('5c 4d 3h 2s Ac')))).toBeGreaterThan(0)
  })

  it('7 張取最佳 5 張：兩對以上時第三對不計、同花取最大 5 張', () => {
    const v = evaluateBest(cards('Ac Ad Kc Kd Qc Qd 2h'))
    expect(v.category).toBe('twoPair')
    expect(v.ranks).toEqual([14, 13, 12])
    const f = evaluateBest(cards('Ah 2h 5h 9h Jh Kh 3c'))
    expect(f.ranks).toEqual([14, 13, 11, 9, 5])
  })
})

describe('HC14 牌型描述', () => {
  it('HC14 4.10 表格每列的例子逐字相符', () => {
    expect(describeOf('Ac Qd 9h 7s 2c')).toBe('high card Ace')
    expect(describeOf('Kc Kd 9h 7s 2c')).toBe('a pair of Kings')
    expect(describeOf('Kc Kd 7h 7s 2c')).toBe('two pair, Kings and Sevens')
    expect(describeOf('9c 9d 9h 7s 2c')).toBe('three of a kind, Nines')
    expect(describeOf('Ac Kd Qh Js Tc')).toBe('a straight, Ten to Ace')
    expect(describeOf('5c 4d 3h 2s Ac')).toBe('a straight, Ace to Five')
    expect(describeOf('Ad Jd 8d 6d 3d')).toBe('a flush, Ace high')
    expect(describeOf('Kc Kd Kh 7s 7c')).toBe('a full house, Kings full of Sevens')
    expect(describeOf('Kc Kd Kh Ks 2c')).toBe('four of a kind, Kings')
    expect(describeOf('9h 8h 7h 6h 5h')).toBe('a straight flush, Five to Nine')
  })

  it('HC14 `a Royal Flush`；`a straight, Ace to Five`；`two pair, Kings and Sevens`', () => {
    expect(describeOf('As Ks Qs Js Ts')).toBe('a Royal Flush')
    expect(describeOf('Ac 2d 3h 4s 5c')).toBe('a straight, Ace to Five')
    expect(describeOf('Kc 7d Kh 7s 2c')).toBe('two pair, Kings and Sevens')
    // A-2-3-4-5 同花順
    expect(describeOf('Ah 2h 3h 4h 5h')).toBe('a straight flush, Ace to Five')
    // 點數單數 / 複數（4.10）
    expect(describeOf('2c 2d 9h 7s 3c')).toBe('a pair of Deuces')
    expect(describeOf('6c 6d 6h 7s 3c')).toBe('three of a kind, Sixes')
    expect(describeOf('8c 6d 5h 3s 2c')).toBe('high card Eight')
  })
})

describe('HC15 下注快捷（元單位，盲注 25 / 50，籌碼 100,000）', () => {
  // 籌碼足夠，不會被全下夾限；最小合法金額 bet 為 bb 50、raise 為 B + L
  const flop = (pot: number) => quickBetSizes({ pot, currentBet: 0, minRaise: 50, committed: 0, stack: 100000, bb: 50 })

  it('HC15 翻牌底池 550、無人下注：最小 50、½ 池 275、⅔ 池 367（366.67 進位）、底池 550', () => {
    const s = flop(550)
    expect(s.min).toEqual({ to: 50, allIn: false })
    expect(s.half).toEqual({ to: 275, allIn: false })
    expect(s.twoThirds).toEqual({ to: 367, allIn: false })
    expect(s.pot).toEqual({ to: 550, allIn: false })
    expect(s.allIn).toEqual({ to: 100000, allIn: true })
  })

  it('HC15 翻牌底池 275、無人下注：最小 50、½ 池 138（137.5 進位）、⅔ 池 183（183.33 捨去）、底池 275', () => {
    const s = flop(275)
    expect(s.min).toEqual({ to: 50, allIn: false })
    expect(s.half).toEqual({ to: 138, allIn: false })
    expect(s.twoThirds).toEqual({ to: 183, allIn: false })
    expect(s.pot).toEqual({ to: 275, allIn: false })
  })

  it('HC15 轉牌前底池 1,250、對手下注 800（P = 2,050、C = 800、B = 800、L = 800）：最小 1600、½ 池 2225、⅔ 池 2700、底池 3650', () => {
    const s = quickBetSizes({ pot: 2050, currentBet: 800, minRaise: 800, committed: 0, stack: 100000, bb: 50 })
    expect(s.min).toEqual({ to: 1600, allIn: false })
    expect(s.half).toEqual({ to: 2225, allIn: false })
    expect(s.twoThirds).toEqual({ to: 2700, allIn: false })
    expect(s.pot).toEqual({ to: 3650, allIn: false })
    // 金額全部為整數（按鈕顯示 `$275`、`$367` 等的格式屬 4.12，H1 / H2）
    for (const v of Object.values(s)) expect(Number.isInteger(v.to)).toBe(true)
  })

  it('HC15 同一情境以引擎狀態推導 P、C、B（盲注 25 / 50，轉牌前底池 1,250、對手下注 800）', () => {
    // 2 人：翻前 1 跟注、2 過牌（底池 100）；翻牌 2 下注 575、1 跟注（底池 1250）；轉牌 2 下注 800
    const d = detail({ tableSize: 2, buttonSeat: 1, heroSeat: 1, sb: 25, bb: 50, seats: [seat(1, 100000), seat(2, 100000)] })
    const r = replay({
      ...d,
      actions: [
        act('preflop', 1, 'call'),
        act('preflop', 2, 'check'),
        act('flop', 2, 'bet', 575),
        act('flop', 1, 'call'),
        act('turn', 2, 'bet', 800),
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.potAtStart.turn).toBe(1250)
    const s = quickBetSizesFor(r.state)!
    expect([s.min.to, s.half.to, s.twoThirds.to, s.pot.to]).toEqual([1600, 2225, 2700, 3650])
  })

  it('HC15 翻前底池加注：盲注 100 / 200、UTG 面對 200 → 700', () => {
    const s = quickBetSizes({ pot: 300, currentBet: 200, minRaise: 200, committed: 0, stack: 20000, bb: 200 })
    expect(s.pot.to).toBe(700)
    expect(s.min.to).toBe(400)
  })

  it('HC15 夾限：低於最小合法金額改為最小（bet 為 bb、raise 為 B + L）；≥ 全下金額改為全下', () => {
    // 底池 300、無人下注：½ 池 150 < bb 200 → 200
    const small = quickBetSizes({ pot: 300, currentBet: 0, minRaise: 200, committed: 0, stack: 20000, bb: 200 })
    expect(small.half).toEqual({ to: 200, allIn: false })
    expect(small.min).toEqual({ to: 200, allIn: false })
    // raise：B 1000、L 1500，½ 池 1000 + round((1500 + 1000) / 2) = 2250 < B + L 2500 → 2500
    const raise = quickBetSizes({ pot: 1500, currentBet: 1000, minRaise: 1500, committed: 0, stack: 20000, bb: 200 })
    expect(raise.half).toEqual({ to: 2500, allIn: false })
    expect(raise.min).toEqual({ to: 2500, allIn: false })
    // 剩 2,500（A 0）：底池 3650 ≥ 全下 → 全下 2500
    const short = quickBetSizes({ pot: 2050, currentBet: 800, minRaise: 800, committed: 0, stack: 2500, bb: 200 })
    expect(short.pot).toEqual({ to: 2500, allIn: true })
    expect(short.twoThirds).toEqual({ to: 2500, allIn: true })
    expect(short.allIn).toEqual({ to: 2500, allIn: true })
    // 最小合法金額超過全下：最小也改為全下
    const tiny = quickBetSizes({ pot: 2050, currentBet: 800, minRaise: 800, committed: 0, stack: 1200, bb: 200 })
    expect(tiny.min).toEqual({ to: 1200, allIn: true })
    // 已投入 A 計入全下金額 A + S
    const committed = quickBetSizes({ pot: 3000, currentBet: 1000, minRaise: 500, committed: 500, stack: 1000, bb: 200 })
    expect(committed.allIn).toEqual({ to: 1500, allIn: true })
    expect(committed.min).toEqual({ to: 1500, allIn: true })
  })
})
