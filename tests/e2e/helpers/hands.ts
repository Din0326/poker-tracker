import { finalizeHandContent, type Hand, type HandContent, type HandDetail, type Seat } from '../../../src/domain/hands'
import { fixture, uuid } from './sessions'

// v2 H0 的 E2E 用手牌：H0 沒有手牌 UI，測試以 domain 函式組成合法手牌後直接寫入 IndexedDB（hands 表）

const TS = '2026-09-28T23:00:00+08:00'
const seat = (seatNo: number, stack: number, cards: string[] = [], mucked = false): Seat => ({ seatNo, stack, cards, mucked, name: null })

/** SPEC-v2-hands 7.9 範例的 detail（collected 由系統計算） */
function example79Detail(): HandDetail {
  return {
    tableSize: 6,
    buttonSeat: 4,
    heroSeat: 4,
    sb: 100,
    bb: 200,
    ante: 0,
    straddle: 0,
    seats: [seat(1, 20000), seat(2, 20000), seat(3, 20000), seat(4, 20000, ['As', 'Ks']), seat(5, 24000), seat(6, 17100, ['Kd', 'Qs'])],
    actions: [
      { street: 'preflop', seatNo: 1, type: 'fold', to: null },
      { street: 'preflop', seatNo: 2, type: 'fold', to: null },
      { street: 'preflop', seatNo: 3, type: 'fold', to: null },
      { street: 'preflop', seatNo: 4, type: 'raise', to: 500 },
      { street: 'preflop', seatNo: 5, type: 'fold', to: null },
      { street: 'preflop', seatNo: 6, type: 'call', to: null },
      { street: 'flop', seatNo: 6, type: 'check', to: null },
      { street: 'flop', seatNo: 4, type: 'bet', to: 700 },
      { street: 'flop', seatNo: 6, type: 'call', to: null },
      { street: 'turn', seatNo: 6, type: 'check', to: null },
      { street: 'turn', seatNo: 4, type: 'bet', to: 1600 },
      { street: 'turn', seatNo: 6, type: 'raise', to: 15900 },
      { street: 'turn', seatNo: 4, type: 'call', to: null },
    ],
    rake: 400,
    collected: [],
  }
}

function build(content: Partial<HandContent> & Pick<HandContent, 'detail'>, id: string, exportSeq: number, updatedAt = TS): Hand {
  const source = content.source ?? 'manual'
  return {
    id,
    exportSeq,
    createdAt: TS,
    updatedAt,
    ...finalizeHandContent({
      source,
      gameType: 'cash',
      sessionId: null,
      playedAt: '2026-09-27T21:15:00',
      bb: null,
      heroCards: [],
      heroPosition: null,
      board: [],
      heroNet: null,
      tags: [],
      note: null,
      sourceHandId: null,
      rawText: null,
      parserVersion: null,
      ...content,
    }),
  }
}

export const H_79 = uuid(0x7001)
export const H_MEMO = uuid(0x7002)
export const H_MTT = uuid(0x7003)
export const H_SIDE = uuid(0x7005)
export const H_GG = uuid(0x7006)

/**
 * 5 手：c1（現金桌場次）底下 2 手（7.9 完整、簡易備忘）、m1（MTT）底下 1 手錦標賽備忘、
 * 獨立的三人邊池完整手牌與 GG 手牌。exportSeq 1、2、3、5、6（4 已刪除，序號不重用）
 */
export function fixtureHands(updatedAt = TS): Hand[] {
  return [
    build(
      { detail: example79Detail(), board: ['Kh', '7d', '2c', '9s', '3h'], sessionId: fixture.c1.id, tags: ['3bet'], note: '第一行\n第二行' },
      H_79,
      1,
      updatedAt,
    ),
    build({ detail: null, sessionId: fixture.c1.id, heroCards: ['Ah', 'Kd'], heroPosition: 'CO', bb: 100, heroNet: -1250 }, H_MEMO, 2, updatedAt),
    build({ detail: null, gameType: 'tournament', sessionId: fixture.m1.id, heroCards: ['Qh', 'Qd'], bb: 400 }, H_MTT, 3, updatedAt),
    build(
      {
        detail: {
          ...example79Detail(),
          tableSize: 3,
          buttonSeat: 1,
          heroSeat: 1,
          rake: 300,
          seats: [seat(1, 1000, ['Ah', 'Ad']), seat(2, 3000, ['Kh', 'Kd']), seat(3, 5000, ['Qh', 'Qd'])],
          actions: [
            { street: 'preflop', seatNo: 1, type: 'raise', to: 1000 },
            { street: 'preflop', seatNo: 2, type: 'raise', to: 3000 },
            { street: 'preflop', seatNo: 3, type: 'call', to: null },
          ],
        },
        board: ['2c', '7d', '9h', 'Js', '4c'],
      },
      H_SIDE,
      5,
      updatedAt,
    ),
    build(
      {
        detail: { ...example79Detail(), rake: 44, collected: [{ seatNo: 4, potIndex: 0, amount: 34256 }] },
        board: ['Kh', '7d', '2c', '9s', '3h'],
        source: 'gg',
        playedAt: '2026-09-20T22:05:13',
        sourceHandId: 'RC1000000001',
        rawText: 'Poker Hand #RC1000000001: e2e fixture',
        parserVersion: 1,
      },
      H_GG,
      6,
      updatedAt,
    ),
  ]
}

export const H_PARTIAL = uuid(0x7007)

/**
 * 未完成的完整紀錄（3.9：屬簡易手牌、帶 detail）：7.9 範例打到翻牌 BB 過牌後暫存（詳情顯示「繼續補齊」）。
 * 不在 fixtureHands 內，需要時另外寫入。
 */
export function partialHand(): Hand {
  const base = example79Detail()
  return build(
    {
      detail: { ...base, seats: base.seats.map((s) => (s.seatNo === 6 ? { ...s, cards: [] } : s)), actions: base.actions.slice(0, 7), rake: 0 },
      board: ['Kh', '7d', '2c'],
      sessionId: null,
    },
    H_PARTIAL,
    7,
  )
}
