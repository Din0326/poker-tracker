// 12.2 必測案例中的完整手牌（HC11 恆等式、備份測試共用）
import type { Hand, HandDetail } from '../../../src/domain/hands'
import { EXAMPLE_79_BOARD, act, buildHand, detail, example79Detail, example79Hand, seat } from './hands'

const runoutBoard = ['2c', '7d', '9h', 'Js', '4c']

function hc5Detail(rake: number): HandDetail {
  return detail({
    tableSize: 3,
    buttonSeat: 1,
    heroSeat: 1,
    rake,
    seats: [seat(1, 1000, ['Ah', 'Ad']), seat(2, 3000, ['Kh', 'Kd']), seat(3, 5000, ['Qh', 'Qd'])],
    actions: [act('preflop', 1, 'raise', 1000), act('preflop', 2, 'raise', 3000), act('preflop', 3, 'call')],
  })
}

function hc6Detail(sb: number, bb: number): HandDetail {
  const checks = (street: 'flop' | 'turn' | 'river') => [act(street, 3, 'check'), act(street, 1, 'check')]
  return detail({
    tableSize: 3,
    buttonSeat: 1,
    heroSeat: 1,
    sb,
    bb,
    seats: [seat(1, 10000, ['2c', '3d']), seat(2, 10000), seat(3, 10000, ['4h', '5c'])],
    actions: [
      act('preflop', 1, 'call'),
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'check'),
      ...checks('flop'),
      ...checks('turn'),
      ...checks('river'),
    ],
  })
}

function hc2Detail(): HandDetail {
  const base = example79Detail()
  return {
    ...base,
    seats: base.seats.map((s) => ({ ...s, cards: s.seatNo === 4 ? ['As', 'Ks'] : [] })),
    actions: [1, 2, 3, 4, 5].map((n) => act('preflop', n, 'fold')),
    rake: 0,
    collected: [],
  }
}

/** 對手蓋牌的攤牌手牌：河牌 Hero 下注、對手跟注後蓋牌 */
function muckDetail(): HandDetail {
  return detail({
    tableSize: 2,
    buttonSeat: 1,
    heroSeat: 1,
    rake: 50,
    seats: [seat(1, 20000, ['Ah', 'Ad']), seat(2, 20000, [], true)],
    actions: [
      act('preflop', 1, 'call'),
      act('preflop', 2, 'check'),
      act('flop', 2, 'check'),
      act('flop', 1, 'check'),
      act('turn', 2, 'check'),
      act('turn', 1, 'check'),
      act('river', 2, 'check'),
      act('river', 1, 'bet', 600),
      act('river', 2, 'call'),
    ],
  })
}

/** 12.2 表中的所有完整手牌（每個都以 buildHand 由系統推導 collected、kind 與摘要） */
export function completeCaseHands(): { name: string; hand: Hand }[] {
  return [
    { name: '7.9 範例（HC1）', hand: example79Hand() },
    { name: 'HC2 BB walk', hand: buildHand({ detail: hc2Detail() }) },
    { name: 'HC5 三人邊池', hand: buildHand({ detail: hc5Detail(0), board: runoutBoard }) },
    { name: 'HC5 rake 300', hand: buildHand({ detail: hc5Detail(300), board: runoutBoard }) },
    { name: 'HC6 平分（元）', hand: buildHand({ detail: hc6Detail(25, 50), board: ['Ts', 'Js', 'Qs', 'Ks', 'As'] }) },
    {
      name: 'HC6 平分（籌碼）',
      hand: buildHand({ detail: hc6Detail(25, 50), board: ['Ts', 'Js', 'Qs', 'Ks', 'As'], gameType: 'tournament' }),
    },
    { name: 'HC6 能整除', hand: buildHand({ detail: hc6Detail(50, 100), board: ['Ts', 'Js', 'Qs', 'Ks', 'As'] }) },
    { name: 'HC10 rake 3500', hand: buildHand({ detail: hc5Detail(3500), board: runoutBoard }) },
    { name: '對手蓋牌', hand: buildHand({ detail: muckDetail(), board: EXAMPLE_79_BOARD }) },
  ]
}

export { hc2Detail, hc5Detail, hc6Detail, muckDetail, runoutBoard }
