// 元件測試用的完整模式表單值：以 7.9 範例的牌局設定為底（6 人、100 / 200、按鈕與你在座位 4、座位 5 24000、座位 6 17100）
import type { Action } from '../../../src/domain/hands'
import type { HandFormValues, SeatValues } from '../../../src/features/hands/handFormModel'
import { entryValues } from './renderHandForm'

export const ACTIONS_79: Action[] = [
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
]

export const BOARD_79 = ['Kh', '7d', '2c', '9s', '3h']

function seats(stacks: Record<number, string>, empty: number[] = []): SeatValues[] {
  return Array.from({ length: 10 }, (_, i) => ({ empty: empty.includes(i + 1), stack: stacks[i + 1] ?? '20000', edited: stacks[i + 1] !== undefined }))
}

/** 7.9 的牌局設定（尚未開始翻前） */
export function setup79(patch: Partial<HandFormValues> = {}): HandFormValues {
  return entryValues({
    mode: 'complete',
    date: '2026-09-30',
    hour: '21',
    minute: '15',
    tableSize: 6,
    sb: '100',
    setupBb: '200',
    ante: '0',
    defaultStack: '20000',
    seats: seats({ 5: '24000', 6: '17100' }),
    buttonSeat: 4,
    heroSeat: 4,
    heroCards: ['As', 'Ks'],
    ...patch,
  })
}

/** 7.9 範例推進到第 n 個行動之後（公牌依已確認的街） */
export function at79(actionCount: number, patch: Partial<HandFormValues> = {}): HandFormValues {
  const actions = ACTIONS_79.slice(0, actionCount)
  const streets = new Set(actions.map((a) => a.street))
  const boardSteps = [streets.has('flop') ? 3 : 0, streets.has('turn') ? 4 : 0].filter((n) => n > 0)
  const done = boardSteps[boardSteps.length - 1] ?? 0
  return setup79({
    setupDone: true,
    actions,
    boardSteps,
    board: Array.from({ length: 5 }, (_, i) => (i < done ? BOARD_79[i]! : null)),
    ...patch,
  })
}

/** 7.9 範例到結果步驟（河牌自動發完已確認） */
export function result79(patch: Partial<HandFormValues> = {}): HandFormValues {
  return setup79({ setupDone: true, actions: ACTIONS_79, boardSteps: [3, 4, 5], board: [...BOARD_79], ...patch })
}

export { seats as seatRows }
