// H3 匯出與往返測試共用的完整手牌（SPEC-v2-hands 第 9 節列出的案例：HC7 2 人桌、HC8 straddle、HC9 錦標賽前注、
// 10 人桌、分單位手牌、多個邊池等）；7.9 範例與 HC2、HC5、HC6、對手蓋牌見 handCases.ts
import type { Hand, HandDetail } from '../../../src/domain/hands'
import { act, buildHand, detail, seat } from './hands'

type Fixed = Partial<Pick<Hand, 'id' | 'exportSeq' | 'createdAt' | 'updatedAt'>>

const BOARD = ['2c', '7d', '9h', 'Js', '4c']

/** HC7 2 人桌：按鈕座位 1（Hero，同時是小盲）、大盲座位 2；打到河牌攤牌 */
export function hc7Hand(fixed: Fixed = {}): Hand {
  const d = detail({
    tableSize: 2,
    buttonSeat: 1,
    heroSeat: 1,
    seats: [seat(1, 20000, ['Ah', 'Kh']), seat(2, 20000, ['Qs', 'Qd'])],
    actions: [
      act('preflop', 1, 'call'),
      act('preflop', 2, 'check'),
      act('flop', 2, 'check'),
      act('flop', 1, 'bet', 200),
      act('flop', 2, 'call'),
      act('turn', 2, 'check'),
      act('turn', 1, 'check'),
      act('river', 2, 'check'),
      act('river', 1, 'check'),
    ],
  })
  return buildHand({ detail: d, board: BOARD }, fixed)
}

/** HC8 straddle：6 人、sb 100 / bb 200、straddle 400（座位 4 = UTG），Hero 為按鈕座位 1 */
export function hc8Hand(fixed: Fixed = {}): Hand {
  const d = detail({
    tableSize: 6,
    buttonSeat: 1,
    heroSeat: 1,
    straddle: 400,
    seats: [seat(1, 20000, ['Ah', 'Kh']), seat(2, 20000), seat(3, 20000), seat(4, 20000), seat(5, 20000), seat(6, 20000)],
    actions: [
      act('preflop', 5, 'fold'),
      act('preflop', 6, 'call'),
      act('preflop', 1, 'raise', 1200),
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'fold'),
      act('preflop', 6, 'call'),
      act('flop', 6, 'check'),
      act('flop', 1, 'bet', 1000),
      act('flop', 6, 'fold'),
    ],
  })
  return buildHand({ detail: d, board: ['2c', '7d', '9h'] }, fixed)
}

/** HC9 錦標賽前注：8 人、sb 100 / bb 200 / ante 25（籌碼），3 人過牌到攤牌 */
export function hc9Hand(fixed: Fixed = {}): Hand {
  const d = detail({
    tableSize: 8,
    buttonSeat: 1,
    heroSeat: 1,
    ante: 25,
    seats: [
      seat(1, 1500, ['Ah', 'Kh']),
      seat(2, 10000, ['Qs', 'Qd']),
      seat(3, 10000, ['7c', '7s']),
      seat(4, 10000),
      seat(5, 10000),
      seat(6, 10000),
      seat(7, 10000),
      seat(8, 10000),
    ],
    actions: [
      act('preflop', 4, 'fold'),
      act('preflop', 5, 'fold'),
      act('preflop', 6, 'fold'),
      act('preflop', 7, 'fold'),
      act('preflop', 8, 'fold'),
      act('preflop', 1, 'call'),
      act('preflop', 2, 'call'),
      act('preflop', 3, 'check'),
      ...(['flop', 'turn', 'river'] as const).flatMap((s) => [act(s, 2, 'check'), act(s, 3, 'check'), act(s, 1, 'check')]),
    ],
  })
  return buildHand({ detail: d, board: BOARD, gameType: 'tournament' }, fixed)
}

/** 10 人桌：所有人棄牌到 Hero（按鈕座位 1）加注，盲注棄牌，退回未跟注部分 */
export function tenMaxHand(fixed: Fixed = {}): Hand {
  const seats = Array.from({ length: 10 }, (_, i) => seat(i + 1, 20000, i === 0 ? ['Ah', 'Kh'] : []))
  const d = detail({
    tableSize: 10,
    buttonSeat: 1,
    heroSeat: 1,
    seats,
    actions: [
      ...[4, 5, 6, 7, 8, 9, 10].map((n) => act('preflop', n, 'fold')),
      act('preflop', 1, 'raise', 600),
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'fold'),
    ],
  })
  return buildHand({ detail: d }, fixed)
}

/** 8.8 GG 範例的解析結果（分單位，gg 來源；對手沿用原站匿名名稱） */
export function ggCentHand(patch: Partial<HandDetail> = {}, fixed: Fixed = { exportSeq: 3 }): Hand {
  return buildHand(
    {
      source: 'gg',
      playedAt: '2026-09-20T22:05:13',
      board: ['8s', '4h', '2d', 'Jc'],
      detail: {
        tableSize: 6,
        buttonSeat: 1,
        heroSeat: 2,
        sb: 10,
        bb: 25,
        ante: 0,
        straddle: 0,
        seats: [
          { ...seat(1, 2500), name: '7f3a9c21' },
          seat(2, 2500, ['Qh', 'Qd']),
          { ...seat(3, 3120), name: 'b04e5d18' },
          { ...seat(4, 2500), name: '2c8e6f07' },
          { ...seat(5, 1840), name: 'e91d4a3b' },
          { ...seat(6, 2500), name: '5a6b7c8d' },
        ],
        actions: [
          act('preflop', 4, 'fold'),
          act('preflop', 5, 'raise', 65),
          act('preflop', 6, 'fold'),
          act('preflop', 1, 'fold'),
          act('preflop', 2, 'raise', 225),
          act('preflop', 3, 'fold'),
          act('preflop', 5, 'call'),
          act('flop', 2, 'bet', 150),
          act('flop', 5, 'call'),
          act('turn', 2, 'bet', 375),
          act('turn', 5, 'fold'),
        ],
        rake: 44,
        collected: [{ seatNo: 2, potIndex: 0, amount: 731 }],
        ...patch,
      },
    },
    fixed,
  )
}

/** 4 人、3 個池：UTG（座位 4）全下 5000，其餘依序全下跟注（Hero 為按鈕座位 1，籌碼最短） */
export function multiSidePotHand(fixed: Fixed = {}): Hand {
  const d = detail({
    tableSize: 4,
    buttonSeat: 1,
    heroSeat: 1,
    seats: [seat(1, 1000, ['2c', '3d']), seat(2, 2000, ['Ah', 'Ad']), seat(3, 3000, ['Kh', 'Kd']), seat(4, 5000, ['Qh', 'Qd'])],
    actions: [act('preflop', 4, 'raise', 5000), act('preflop', 1, 'call'), act('preflop', 2, 'call'), act('preflop', 3, 'call')],
  })
  return buildHand({ detail: d, board: ['7s', '8s', '9c', 'Jd', '4h'] }, fixed)
}
