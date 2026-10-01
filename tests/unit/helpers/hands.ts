// 手牌單元測試共用的建構函式（SPEC-v2-hands 7.9 範例與各 HC 案例）
import {
  finalizeHandContent,
  type Action,
  type Card,
  type Hand,
  type HandContent,
  type HandDetail,
  type HandGameType,
  type HandSource,
  type Seat,
  type Street,
} from '../../../src/domain/hands'

let counter = 0x7000

/** 合法的 UUID v4 格式（依序遞增） */
export function handUuid(): string {
  counter++
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
}

export const HAND_TS = '2026-10-01T21:05:00+08:00'

/** 座位：seatNo、stack，可帶手牌與蓋牌 */
export function seat(seatNo: number, stack: number, cards: Card[] = [], mucked = false): Seat {
  return { seatNo, stack, cards, mucked, name: null }
}

/** 行動簡寫：act('preflop', 4, 'raise', 500) */
export function act(street: Street, seatNo: number, type: Action['type'], to: number | null = null): Action {
  return { street, seatNo, type, to }
}

export function detail(overrides: Partial<HandDetail> & Pick<HandDetail, 'seats'>): HandDetail {
  return {
    tableSize: Math.max(overrides.seats.length, 2),
    buttonSeat: overrides.seats[0]!.seatNo,
    heroSeat: overrides.seats[0]!.seatNo,
    sb: 100,
    bb: 200,
    ante: 0,
    straddle: 0,
    actions: [],
    rake: 0,
    collected: [],
    ...overrides,
  }
}

/** 7.9 範例的 detail（collected 已依 4.8 填入；與規格 JSON 相同） */
export function example79Detail(): HandDetail {
  return {
    tableSize: 6,
    buttonSeat: 4,
    heroSeat: 4,
    sb: 100,
    bb: 200,
    ante: 0,
    straddle: 0,
    seats: [
      seat(1, 20000),
      seat(2, 20000),
      seat(3, 20000),
      seat(4, 20000, ['As', 'Ks']),
      seat(5, 24000),
      seat(6, 17100, ['Kd', 'Qs']),
    ],
    actions: [
      act('preflop', 1, 'fold'),
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'raise', 500),
      act('preflop', 5, 'fold'),
      act('preflop', 6, 'call'),
      act('flop', 6, 'check'),
      act('flop', 4, 'bet', 700),
      act('flop', 6, 'call'),
      act('turn', 6, 'check'),
      act('turn', 4, 'bet', 1600),
      act('turn', 6, 'raise', 15900),
      act('turn', 4, 'call'),
    ],
    rake: 400,
    collected: [{ seatNo: 4, potIndex: 0, amount: 33900 }],
  }
}

export const EXAMPLE_79_BOARD: Card[] = ['Kh', '7d', '2c', '9s', '3h']

/** 7.9 範例的完整 Hand（規格 JSON 加上省略的 id、tags、note、時間戳） */
export function example79Hand(overrides: Partial<Hand> = {}): Hand {
  return {
    id: handUuid(),
    exportSeq: 1,
    kind: 'complete',
    source: 'manual',
    gameType: 'cash',
    amountUnit: 'yuan',
    sessionId: null,
    playedAt: '2026-09-30T21:15:00',
    bb: 200,
    heroCards: ['As', 'Ks'],
    heroPosition: 'BTN',
    board: [...EXAMPLE_79_BOARD],
    heroNet: 16800,
    detail: example79Detail(),
    tags: [],
    note: null,
    sourceHandId: null,
    rawText: null,
    parserVersion: null,
    createdAt: HAND_TS,
    updatedAt: HAND_TS,
    ...overrides,
  }
}

/** 由內容推導系統欄位（amountUnit、collected、kind、摘要），組成可儲存的 Hand */
export function buildHand(
  content: Partial<HandContent> & { detail: HandDetail | null },
  fixed: Partial<Pick<Hand, 'id' | 'exportSeq' | 'createdAt' | 'updatedAt'>> = {},
): Hand {
  const source: HandSource = content.source ?? 'manual'
  const gameType: HandGameType = content.gameType ?? 'cash'
  const full: HandContent = {
    source,
    gameType,
    sessionId: null,
    playedAt: '2026-09-30T21:15:00',
    bb: null,
    heroCards: [],
    heroPosition: null,
    board: [],
    heroNet: null,
    tags: [],
    note: null,
    sourceHandId: source === 'gg' ? 'RC1000000001' : null,
    rawText: source === 'gg' ? 'Poker Hand #RC1000000001: seed' : null,
    parserVersion: source === 'gg' ? 1 : null,
    ...content,
  }
  return {
    id: fixed.id ?? handUuid(),
    exportSeq: fixed.exportSeq ?? 1,
    createdAt: fixed.createdAt ?? HAND_TS,
    updatedAt: fixed.updatedAt ?? HAND_TS,
    ...finalizeHandContent(full),
  }
}
