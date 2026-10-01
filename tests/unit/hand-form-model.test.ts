// SPEC-v2-hands 第 5 節新增 / 編輯手牌頁的純邏輯（features/hands/handFormModel.ts）
import { describe, expect, it } from 'vitest'
import { finalizeHandContent, type Action, type Hand, type HandSetup } from '../../src/domain/hands'
import type { Session, Stake } from '../../src/domain/types'
import {
  FIRST_USE_SETUP,
  addAction,
  boardMissingError,
  boardSlotsValid,
  canUndo,
  completeFromSimple,
  confirmBoard,
  createEntryValues,
  defaultTime,
  deriveStage,
  handToValues,
  parseAmount,
  parseHandDraft,
  reconstructBoardSteps,
  simpleHeroNet,
  stepStatuses,
  toCompleteInput,
  toHandDraft,
  toSimpleInput,
  undoStep,
  usedCards,
  validateNewTag,
  type HandFormValues,
} from '../../src/features/hands/handFormModel'

const NOW = new Date(2026, 9, 1, 21, 17, 40)

function entry(patch: Partial<HandFormValues> = {}, lastHandSetup?: HandSetup): HandFormValues {
  return { ...createEntryValues({ now: NOW, lastHandSetup, session: null, stake: null }), ...patch }
}

const ACTIONS_79: Action[] = [
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

/** 7.9 的牌局設定（已開始翻前） */
function v79(patch: Partial<HandFormValues> = {}): HandFormValues {
  const base = entry({ mode: 'complete', heroCards: ['As', 'Ks'], buttonSeat: 4, heroSeat: 4 })
  return {
    ...base,
    seats: base.seats.map((s, i) => (i === 4 ? { ...s, stack: '24000', edited: true } : i === 5 ? { ...s, stack: '17100', edited: true } : s)),
    setupDone: true,
    ...patch,
  }
}

describe('3.8 金額輸入：整數、千分位逗號、不經浮點數', () => {
  it('parseAmount', () => {
    expect(parseAmount('1000')).toEqual({ ok: true, value: 1000 })
    expect(parseAmount('1,000')).toEqual({ ok: true, value: 1000 })
    expect(parseAmount('007')).toEqual({ ok: true, value: 7 })
    expect(parseAmount('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseAmount('12.5')).toEqual({ ok: false, reason: 'notInteger' })
    expect(parseAmount('12.')).toEqual({ ok: false, reason: 'notInteger' })
    expect(parseAmount('99999999')).toEqual({ ok: true, value: 99999999 })
    expect(parseAmount('100000000')).toEqual({ ok: false, reason: 'tooLarge' })
    expect(parseAmount('9'.repeat(30))).toEqual({ ok: false, reason: 'tooLarge' })
  })
})

describe('5.1 預帶值', () => {
  it('首次使用：簡易模式、現金桌、6 人、100 / 200、ante 0、straddle 關、預設籌碼 20,000；時間為現在，分鐘捨去到 5 的倍數', () => {
    const v = entry()
    expect(v).toMatchObject({ mode: 'simple', gameType: 'cash', tableSize: 6, sb: '100', setupBb: '200', ante: '0', straddle: false, defaultStack: '20000', buttonSeat: 1, heroSeat: 1, sessionId: '' })
    expect(defaultTime(NOW)).toEqual({ date: '2026-10-01', hour: '21', minute: '15' })
    expect(v.seats.every((s) => s.stack === '20000' && !s.empty && !s.edited)).toBe(true)
    expect(FIRST_USE_SETUP.defaultStack).toBe(100 * FIRST_USE_SETUP.bb)
  })

  it('帶 sessionId：gameType 依場次類型；現金桌 sb、bb 帶入該場盲注（元，直接帶入），其餘帶入 lastHandSetup', () => {
    const last: HandSetup = { gameType: 'cash', tableSize: 9, sb: 100, bb: 200, ante: 25, straddle: 400, defaultStack: 30000, heroSeat: 7 }
    const session = { id: 's1', type: 'cash' } as Session
    const stake = { sb: 1, bb: 2 } as Stake
    const v = createEntryValues({ now: NOW, lastHandSetup: last, session, stake })
    expect(v).toMatchObject({ sessionId: 's1', gameType: 'cash', sb: '1', setupBb: '2', tableSize: 9, ante: '25', straddle: true, defaultStack: '30000', heroSeat: 7 })
    const mtt = createEntryValues({ now: NOW, lastHandSetup: last, session: { id: 'm', type: 'timed_mtt' } as Session, stake: null })
    // 錦標賽：lastHandSetup 是現金桌 → 前注、預設籌碼改用首次預設（ante 0、100 bb），盲注沿用
    expect(mtt).toMatchObject({ gameType: 'tournament', sb: '100', setupBb: '200', ante: '0', defaultStack: '20000' })
  })
})

describe('完整模式的步驟（5.3）', () => {
  it('開始翻前前為步驟 1；之後依行動與公牌推導', () => {
    expect(deriveStage(entry({ mode: 'complete' })).step).toBe('setup')
    const pre = deriveStage(v79())
    expect(pre).toMatchObject({ step: 'preflop', phase: 'action' })
    const flopBoard = deriveStage(v79({ actions: ACTIONS_79.slice(0, 6) }))
    expect(flopBoard).toMatchObject({ step: 'flop', phase: 'board', runout: false })
    const runout = deriveStage(v79({ actions: ACTIONS_79, boardSteps: [3, 4], board: ['Kh', '7d', '2c', '9s', null] }))
    expect(runout).toMatchObject({ step: 'river', phase: 'board', runout: true })
    expect(deriveStage(v79({ actions: ACTIONS_79, boardSteps: [3, 4, 5], board: ['Kh', '7d', '2c', '9s', '3h'] })).step).toBe('result')
  })

  it('進度列：已完成可回看、尚未到達或不會到達的步驟停用', () => {
    const v = v79({ actions: ACTIONS_79.slice(0, 6) })
    expect(stepStatuses(v, deriveStage(v))).toEqual({ setup: 'done', preflop: 'done', flop: 'current', turn: 'disabled', river: 'disabled', result: 'disabled' })
    // 翻前其他人都棄牌：翻牌以後不會到達
    const walk = v79({ actions: [1, 2, 3, 4, 5].map((seatNo) => ({ street: 'preflop', seatNo, type: 'fold', to: null }) as Action) })
    expect(stepStatuses(walk, deriveStage(walk))).toEqual({ setup: 'done', preflop: 'done', flop: 'disabled', turn: 'disabled', river: 'disabled', result: 'current' })
  })

  it('公牌未選滿的錯誤訊息依街；選滿後確認公牌', () => {
    const v = v79({ actions: ACTIONS_79.slice(0, 6), board: ['Kh', '7d', null, null, null] })
    expect(boardMissingError(v, deriveStage(v))).toBe('請選擇翻牌 3 張')
    const full = { ...v, board: ['Kh', '7d', '2c', null, null] }
    expect(boardMissingError(full, deriveStage(full))).toBeNull()
    expect(confirmBoard(full, deriveStage(full)).boardSteps).toEqual([3])
  })

  it('加入行動：由引擎判斷合法（不合法回傳 null）', () => {
    const v = v79()
    const next = addAction(v, deriveStage(v), { type: 'fold', to: null })!
    expect(next.actions).toEqual([{ street: 'preflop', seatNo: 1, type: 'fold', to: null }])
    expect(addAction(v, deriveStage(v), { type: 'check', to: null })).toBeNull()
    expect(addAction(v, deriveStage(v), { type: 'raise', to: 300 })).toBeNull()
  })

  it('復原上一步：移除最後一筆行動；最後一步是選公牌時清除該街公牌；一路退回到步驟 1 之後', () => {
    let v = v79({ actions: ACTIONS_79.slice(0, 7), boardSteps: [3], board: ['Kh', '7d', '2c', '9s', null] })
    v = undoStep(v)
    expect(v.actions).toHaveLength(6)
    expect(v.boardSteps).toEqual([3])
    v = undoStep(v)
    expect(v.boardSteps).toEqual([])
    // 清除該街（翻牌）公牌；其他暫存的牌不受影響
    expect(v.board).toEqual([null, null, null, '9s', null])
    while (canUndo(v)) v = undoStep(v)
    expect(v.actions).toEqual([])
    expect(v.setupDone).toBe(true)
    expect(deriveStage(v)).toMatchObject({ step: 'preflop', phase: 'action' })
    expect(undoStep(v)).toBe(v)
  })

  it('自動發完時一次確認剩餘公牌；復原時一次清除', () => {
    const v = v79({ actions: ACTIONS_79, boardSteps: [3, 4, 5], board: ['Kh', '7d', '2c', '9s', '3h'] })
    const undone = undoStep(v)
    expect(undone.boardSteps).toEqual([3, 4])
    expect(undone.board).toEqual(['Kh', '7d', '2c', '9s', null])
  })
})

describe('轉成 handRepo 的輸入', () => {
  it('簡易：贏 / 輸 / 平；贏輸未填金額視為未填結果；手牌 2 張或 []', () => {
    expect(simpleHeroNet({ result: 'win', resultAmount: '1500' })).toBe(1500)
    expect(simpleHeroNet({ result: 'loss', resultAmount: '1500' })).toBe(-1500)
    expect(simpleHeroNet({ result: 'even', resultAmount: '' })).toBe(0)
    expect(simpleHeroNet({ result: 'win', resultAmount: '' })).toBeNull()
    expect(simpleHeroNet({ result: '', resultAmount: '200' })).toBeNull()
    const input = toSimpleInput(entry({ heroCards: ['As', 'Kd'], board: ['Kh', '7d', '2c', null, null], bb: '1,000', position: 'BTN', tags: [' a '], note: '' }))
    expect(input).toMatchObject({ source: 'manual', detail: null, playedAt: '2026-10-01T21:15:00', bb: 1000, heroCards: ['As', 'Kd'], board: ['Kh', '7d', '2c'], heroPosition: 'BTN', tags: ['a'], note: null, sessionId: null })
  })

  it('完整：7.9 的輸入經 finalizeHandContent 後為完整手牌，collected 與 7.9 相同', () => {
    const v = v79({ actions: ACTIONS_79, boardSteps: [3, 4, 5], board: ['Kh', '7d', '2c', '9s', '3h'], showdown: { '6': { cards: ['Kd', 'Qs'], mucked: false } }, rake: '400' })
    const stage = deriveStage(v)
    if (stage.step === 'setup') throw new Error('stage')
    const input = toCompleteInput(v, stage)
    const content = finalizeHandContent({ ...input, sessionId: null, bb: null, heroCards: [], heroPosition: null, heroNet: null, tags: [], note: null, sourceHandId: null, rawText: null, parserVersion: null, board: input.board ?? [] })
    expect(content.kind).toBe('complete')
    expect(content.heroNet).toBe(16800)
    expect(content.detail!.collected).toEqual([{ seatNo: 4, potIndex: 0, amount: 33900 }])
  })

  it('未完成時只寫入已確認的公牌（暫存的牌不寫入）', () => {
    const v = v79({ actions: ACTIONS_79.slice(0, 6), board: ['Kh', '7d', '2c', '9s', null] })
    const stage = deriveStage(v)
    if (stage.step === 'setup') throw new Error('stage')
    expect(toCompleteInput(v, stage).board).toEqual([])
  })
})

describe('5.6 標籤新增規則；5.4 已使用的牌；公牌牌位', () => {
  it('validateNewTag', () => {
    expect(validateNewTag([], 'a'.repeat(20))).toBeNull()
    expect(validateNewTag([], ` ${'a'.repeat(21)} `)).toBe('標籤最多 20 字')
    expect(validateNewTag(['Bluff'], ' bluff ')).toBe('標籤重複')
    expect(validateNewTag(Array.from({ length: 10 }, (_, i) => `t${i}`), 'x')).toBe('最多 10 個標籤')
  })

  it('usedCards 含 Hero 手牌、公牌（含暫存）、攤牌牌', () => {
    const v = entry({ heroCards: ['As', null], board: ['Kh', null, null, '9s', null], showdown: { '6': { cards: ['Qd', null], mucked: false } } })
    expect([...usedCards(v)].sort()).toEqual(['9s', 'As', 'Kh', 'Qd'])
  })

  it('公牌必須為 0、3、4、5 張且依序', () => {
    expect(boardSlotsValid([null, null, null, null, null])).toBe(true)
    expect(boardSlotsValid(['Kh', '7d', '2c', null, null])).toBe(true)
    expect(boardSlotsValid(['Kh', '7d', null, null, null])).toBe(false)
    expect(boardSlotsValid(['Kh', null, '2c', '9s', null])).toBe(false)
  })
})

describe('5.8 編輯與補齊', () => {
  const memo: Hand = {
    id: '00000000-0000-4000-8000-000000000001',
    exportSeq: 1,
    createdAt: '2026-09-28T23:00:00+08:00',
    updatedAt: '2026-09-28T23:00:00+08:00',
    ...finalizeHandContent({
      source: 'manual',
      gameType: 'cash',
      sessionId: null,
      playedAt: '2026-09-27T21:15:00',
      bb: 25,
      heroCards: ['As', 'Kd'],
      heroPosition: 'HJ',
      board: ['Kh', '7d', '2c'],
      heroNet: -300,
      detail: null,
      tags: ['x'],
      note: 'n',
      sourceHandId: null,
      rawText: null,
      parserVersion: null,
    }),
  }

  it('簡易備忘轉為表單值（結果：輸 300）', () => {
    expect(handToValues(memo, undefined)).toMatchObject({ mode: 'simple', date: '2026-09-27', hour: '21', minute: '15', bb: '25', position: 'HJ', result: 'loss', resultAmount: '300', tags: ['x'], note: 'n' })
  })

  it('補齊為完整手牌：預填大盲（小盲 = 大盲 ÷ 2 四捨五入，25 → 13）、依位置推算按鈕，結果不預填', () => {
    const v = completeFromSimple(handToValues(memo, undefined), undefined)
    expect(v).toMatchObject({ mode: 'complete', setupBb: '25', sb: '13', heroCards: ['As', 'Kd'], board: ['Kh', '7d', '2c', null, null], setupDone: false, actions: [], heroSeat: 1 })
    // 6 人桌你在座位 1 為 HJ：按鈕在座位 3（3 BTN、4 SB、5 BB、6 UTG、1 HJ、2 CO）
    expect(v.buttonSeat).toBe(3)
    expect(v.defaultStack).toBe('2500')
  })

  it('有 detail 的手牌：進度停在最後狀態（由行動與公牌還原 boardSteps）', () => {
    expect(reconstructBoardSteps(ACTIONS_79, 5)).toEqual([3, 4, 5])
    expect(reconstructBoardSteps(ACTIONS_79.slice(0, 6), 3)).toEqual([3])
    expect(reconstructBoardSteps(ACTIONS_79.slice(0, 7), 3)).toEqual([3])
    expect(reconstructBoardSteps(ACTIONS_79.slice(0, 6), 0)).toEqual([])
  })
})

describe('5.7 草稿', () => {
  it('寫入與還原（含尚未通過驗證的原始字串）', () => {
    const v = v79({ actions: ACTIONS_79.slice(0, 6), bb: '12.5', note: 'x' })
    expect(parseHandDraft(JSON.parse(JSON.stringify(toHandDraft(v))))).toEqual({ values: v, actionsDropped: false })
  })

  it('格式不符時丟棄草稿', () => {
    expect(parseHandDraft(undefined)).toBeNull()
    expect(parseHandDraft({ version: 99, values: {} })).toBeNull()
    expect(parseHandDraft({ ...toHandDraft(entry()), extra: 1 })).toBeNull()
  })

  it('行動重播失敗時捨棄行動部分、保留牌局設定', () => {
    const bad = v79({ actions: [...ACTIONS_79.slice(0, 6), { street: 'flop', seatNo: 1, type: 'check', to: null }], boardSteps: [3], board: ['Kh', '7d', '2c', null, null] })
    const r = parseHandDraft(toHandDraft(bad))!
    expect(r.actionsDropped).toBe(true)
    expect(r.values).toMatchObject({ actions: [], boardSteps: [], setupDone: false, buttonSeat: 4, heroSeat: 4, sb: '100' })
    expect(r.values.board).toEqual(['Kh', '7d', '2c', null, null])
  })

  it('牌局設定不合法但已標記開始翻前時也視為無法還原', () => {
    const r = parseHandDraft(toHandDraft(v79({ sb: '' })))!
    expect(r.actionsDropped).toBe(true)
    expect(r.values.setupDone).toBe(false)
  })
})
