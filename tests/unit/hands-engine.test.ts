// SPEC-v2-hands 4.1–4.9：位置、強制下注、行動順序、合法行動、回合結束、自動發完、未跟注退回、邊池、分配
// 12.2 必測案例 HC1–HC10、HC32–HC35（12.3 H0「引擎、底池」）與邊界情況
import { describe, expect, it } from 'vitest'
import {
  analyzeDetail,
  applyAction,
  buildPots,
  classifyHand,
  computeCollected,
  effectiveStack,
  legalActions,
  netResults,
  positionsBySeat,
  potsAfterRake,
  replay,
  startHand,
  totalPot,
  type EngineState,
  type HandDetail,
} from '../../src/domain/hands'
import { EXAMPLE_79_BOARD, act, buildHand, detail, example79Detail, seat } from './helpers/hands'

/** 重播成功並回傳最後狀態 */
function play(d: Pick<HandDetail, 'seats' | 'buttonSeat' | 'sb' | 'bb' | 'ante' | 'straddle' | 'actions'>): EngineState {
  const r = replay(d)
  if (!r.ok) throw new Error(`replay failed at ${r.actionIndex}: ${r.code}`)
  return r.state
}

const stackOf = (s: EngineState, seatNo: number) => s.players.find((p) => p.seatNo === seatNo)!

describe('HC1 7.9 範例的計算（元單位，盲注 100 / 200）', () => {
  const d = example79Detail()
  const hand = buildHand({ detail: { ...d, collected: [] }, board: EXAMPLE_79_BOARD })

  it('HC1 amountUnit yuan；位置 6 種正確', () => {
    expect(hand.amountUnit).toBe('yuan')
    const pos = positionsBySeat(
      d.seats.map((s) => s.seatNo),
      d.buttonSeat,
    )
    expect(Object.fromEntries(pos)).toEqual({ 5: 'SB', 6: 'BB', 1: 'UTG', 2: 'HJ', 3: 'CO', 4: 'BTN' })
    expect(hand.heroPosition).toBe('BTN')
  })

  it('HC1 翻牌開始底池 1100、轉牌開始 2500；Hero 轉牌跟注 14300 後剩 2900；底池總額 34300', () => {
    const s = play(d)
    expect(s.potAtStart.flop).toBe(1100)
    expect(s.potAtStart.turn).toBe(2500)
    // 轉牌 Hero 跟注前（第 12 筆行動後）toCall 14300
    const beforeCall = play({ ...d, actions: d.actions.slice(0, 12) })
    expect(legalActions(beforeCall)).toMatchObject({ seatNo: 4, toCall: 14300, callAmount: 14300, stack: 17200 })
    expect(stackOf(s, 4).stack).toBe(2900)
    expect(stackOf(s, 6).stack).toBe(0)
    expect(totalPot(s.players)).toBe(34300)
    // BB 全下、Hero 是唯一有籌碼者 → 自動發完
    expect(s.status).toBe('showdown')
    expect(s.runout).toBe(true)
    expect(s.refunds).toEqual([])
  })

  it('HC1 單一池資格 {4, 6}；Hero 贏；collected [{4,0,33900}]', () => {
    const s = play(d)
    expect(buildPots(s.players)).toEqual([{ amount: 34300, eligible: [4, 6] }])
    expect(computeCollected(d, EXAMPLE_79_BOARD)).toEqual([{ seatNo: 4, potIndex: 0, amount: 33900 }])
    expect(hand.detail!.collected).toEqual([{ seatNo: 4, potIndex: 0, amount: 33900 }])
    expect(hand.kind).toBe('complete')
  })

  it('HC1 net：座位 4 +16800、6 −17100、5 −100，其餘 0；Σnet = −400；heroNet 16800（+84.0 bb）；有效籌碼 20000（100.0 bb）', () => {
    const net = netResults(d, EXAMPLE_79_BOARD)!
    expect(Object.fromEntries(net)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 16800, 5: -100, 6: -17100 })
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(-400)
    expect(hand.heroNet).toBe(16800)
    // bb 換算以整數檢查（顯示格式屬 4.12，H2）：16800 ÷ 200 = 84.0
    expect((hand.heroNet! * 10) / hand.bb!).toBe(840)
    expect(effectiveStack(d)).toBe(20000)
    expect((effectiveStack(d) * 10) / d.bb).toBe(1000)
  })
})

describe('HC2 BB walk', () => {
  // 座位、籌碼、按鈕、盲注同 7.9（大盲為座位 6），翻前所有人依序棄牌到大盲
  const base = example79Detail()
  const d: HandDetail = {
    ...base,
    seats: base.seats.map((s) => ({ ...s, cards: s.seatNo === 4 ? ['As', 'Ks'] : [] })),
    actions: [1, 2, 3, 4, 5].map((n) => act('preflop', n, 'fold')),
    rake: 0,
    collected: [],
  }

  it('HC2 小盲棄牌後手牌結束；大盲退回 100；底池總額 200；大盲 collected 200、net +100；小盲 net −100', () => {
    const before = play({ ...d, actions: d.actions.slice(0, 4) })
    expect(before.status).toBe('betting')
    expect(before.toAct).toBe(5)
    const s = play(d)
    expect(s.status).toBe('foldEnded')
    expect(s.toAct).toBeNull()
    expect(s.refunds).toEqual([{ street: 'preflop', seatNo: 6, amount: 100 }])
    expect(totalPot(s.players)).toBe(200)
    expect(computeCollected(d, [])).toEqual([{ seatNo: 6, potIndex: 0, amount: 200 }])
    const hand = buildHand({ detail: d })
    expect(hand.kind).toBe('complete')
    expect(hand.detail!.collected).toEqual([{ seatNo: 6, potIndex: 0, amount: 200 }])
    const net = netResults(hand.detail!, [])!
    expect(net.get(6)).toBe(100)
    expect(net.get(5)).toBe(-100)
    expect(hand.heroNet).toBe(0)
    // 匯出文字（Uncalled bet、collected、Total pot）屬 H3
  })

  it('HC2 再加一筆行動被拒（手牌已結束）', () => {
    const r = replay({ ...d, actions: [...d.actions, act('preflop', 6, 'check')] })
    expect(r).toMatchObject({ ok: false, actionIndex: 5, code: 'handEnded' })
  })
})

describe('HC3 最小加注（sb 100 / bb 200，UTG 加注到 600）', () => {
  // 6 人、按鈕座位 4：5 SB、6 BB、1 UTG、2 HJ、3 CO；HJ 籌碼 800
  const d = detail({
    tableSize: 6,
    buttonSeat: 4,
    heroSeat: 4,
    seats: [seat(1, 20000), seat(2, 800), seat(3, 20000), seat(4, 20000), seat(5, 20000), seat(6, 20000)],
  })
  const afterRaise = play({ ...d, actions: [act('preflop', 1, 'raise', 600)] })

  it('HC3 下一位最小加注到 1000；加注到 900 被拒「最少要加注到 $1,000」', () => {
    expect(afterRaise.currentBet).toBe(600)
    expect(afterRaise.minRaise).toBe(400)
    expect(afterRaise.toAct).toBe(2)
    // 輪到 CO（座位 3，籌碼足夠）時的最小加注
    const co = play({ ...d, actions: [act('preflop', 1, 'raise', 600), act('preflop', 2, 'fold')] })
    expect(legalActions(co)).toMatchObject({ seatNo: 3, canRaise: true, minTo: 1000, maxTo: 20000 })
    expect(applyAction(co, act('preflop', 3, 'raise', 900))).toEqual({ ok: false, code: 'raiseTooSmall' })
    expect(applyAction(co, act('preflop', 3, 'raise', 1000)).ok).toBe(true)
  })

  it('HC3 籌碼剩 800（該街可投入到 800）的玩家可全下到 800（不完整加注）：L 不變、不重新開放', () => {
    expect(legalActions(afterRaise)).toMatchObject({ seatNo: 2, canRaise: true, minTo: 800, maxTo: 800 })
    const r = applyAction(afterRaise, act('preflop', 2, 'raise', 800))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.currentBet).toBe(800)
    expect(r.state.minRaise).toBe(400)
    expect(stackOf(r.state, 2).stack).toBe(0)
    // 下一位（CO）最小加注到 800 + 400 = 1200
    expect(legalActions(r.state)).toMatchObject({ seatNo: 3, minTo: 1200 })
    // 不足最小加注又不是全下：被拒
    expect(applyAction(afterRaise, act('preflop', 2, 'raise', 700))).toEqual({ ok: false, code: 'raiseTooSmall' })
  })
})

describe('HC4 不完整全下不重新開放', () => {
  // 3 人：座位 1 按鈕（C）、2 小盲（A）、3 大盲（B）；翻前平跟進翻牌，翻牌順序 A、B、C
  // TDA Rule 47 A 推導（4.3）：A 下注 1000（L 1000）；B 加注到 3000（完整，L 2000）；C 全下到 4000（不完整，L 仍 2000）。
  // 輪回 A：上次行動後投入 1000，面對 4000 − 1000 = 3000 ≥ 2000 → 可加注，最小到 6000。
  // A 跟注 4000 後輪回 B：上次行動後投入 3000，面對 4000 − 3000 = 1000 < 2000 → 不可加注。
  const d = detail({
    tableSize: 3,
    buttonSeat: 1,
    heroSeat: 2,
    seats: [seat(1, 4200), seat(2, 20000), seat(3, 20000)],
    actions: [
      act('preflop', 1, 'call'),
      act('preflop', 2, 'call'),
      act('preflop', 3, 'check'),
      act('flop', 2, 'bet', 1000),
      act('flop', 3, 'raise', 3000),
      act('flop', 1, 'raise', 4000),
    ],
  })

  it('HC4 C 全下到 4000（增量 1000 < 2000）為不完整加注；輪到 A：可加注（面對 B 的完整加注）', () => {
    const s = play(d)
    expect(stackOf(s, 1).stack).toBe(0)
    expect(s.currentBet).toBe(4000)
    expect(s.minRaise).toBe(2000)
    expect(legalActions(s)).toMatchObject({ seatNo: 2, canRaise: true, toCall: 3000, minTo: 6000 })
  })

  it('HC4 A 跟注 4000 後輪到 B：只能棄牌或跟注，不能加注；引擎拒絕 B 的 raise', () => {
    const s = play({ ...d, actions: [...d.actions, act('flop', 2, 'call')] })
    expect(legalActions(s)).toMatchObject({ seatNo: 3, canRaise: false, canCall: true, canFold: true, canCheck: false, toCall: 1000 })
    expect(applyAction(s, act('flop', 3, 'raise', 8000))).toEqual({ ok: false, code: 'raiseNotReopened' })
    const called = applyAction(s, act('flop', 3, 'call'))
    expect(called.ok && called.state.street).toBe('turn')
  })
})

describe('HC5 三人邊池（sb 100 / bb 200；BTN 全下 1000，SB 全下 3000，BB 跟注到 3000，BB 起始 5000）', () => {
  // 座位 1 BTN（Hero）、2 SB、3 BB
  const board = ['2c', '7d', '9h', 'Js', '4c']
  const base = detail({
    tableSize: 3,
    buttonSeat: 1,
    heroSeat: 1,
    seats: [seat(1, 1000, ['Ah', 'Ad']), seat(2, 3000, ['Kh', 'Kd']), seat(3, 5000, ['Qh', 'Qd'])],
    actions: [act('preflop', 1, 'raise', 1000), act('preflop', 2, 'raise', 3000), act('preflop', 3, 'call')],
  })

  it('HC5 無退回；主池 3000（資格 3 人）、邊池 4000（資格 SB、BB）；BB 是唯一有籌碼者 → 自動發完', () => {
    const s = play(base)
    expect(s.refunds).toEqual([])
    expect(buildPots(s.players)).toEqual([
      { amount: 3000, eligible: [1, 2, 3] },
      { amount: 4000, eligible: [2, 3] },
    ])
    expect(stackOf(s, 3).stack).toBe(2000)
    expect(s.status).toBe('showdown')
    expect(s.runout).toBe(true)
  })

  it('HC5 依牌力分配兩池：AA 拿主池、KK 拿邊池', () => {
    const hand = buildHand({ detail: base, board })
    expect(hand.kind).toBe('complete')
    expect(hand.detail!.collected).toEqual([
      { seatNo: 1, potIndex: 0, amount: 3000 },
      { seatNo: 2, potIndex: 1, amount: 4000 },
    ])
    expect(hand.heroNet).toBe(2000)
    // 主池贏家換成 KK 時，KK 拿下兩池
    const kkBest = buildHand({
      detail: { ...base, seats: [seat(1, 1000, ['Qh', 'Qd']), seat(2, 3000, ['Kh', 'Kd']), seat(3, 5000, ['5h', '6d'])] },
      board,
    })
    expect(kkBest.detail!.collected).toEqual([
      { seatNo: 2, potIndex: 0, amount: 3000 },
      { seatNo: 2, potIndex: 1, amount: 4000 },
    ])
  })

  it('HC5 rake 300 時主池扣為 2700、邊池 4000', () => {
    const s = play(base)
    expect(potsAfterRake(buildPots(s.players), 300)).toEqual([2700, 4000])
    const hand = buildHand({ detail: { ...base, rake: 300 }, board })
    expect(hand.detail!.collected).toEqual([
      { seatNo: 1, potIndex: 0, amount: 2700 },
      { seatNo: 2, potIndex: 1, amount: 4000 },
    ])
  })
})

describe('HC6 平分餘數（chop）', () => {
  // 3 人、按鈕座位 1、sb 25 / bb 50；BTN 跟注、SB 棄牌、BB 過牌，之後全部過牌；兩人都用公牌皇家同花順
  const board = ['Ts', 'Js', 'Qs', 'Ks', 'As']
  const checks = (street: 'flop' | 'turn' | 'river') => [act(street, 3, 'check'), act(street, 1, 'check')]
  const chopDetail = (sb: number, bb: number): HandDetail =>
    detail({
      tableSize: 3,
      buttonSeat: 1,
      heroSeat: 1,
      sb,
      bb,
      seats: [seat(1, 10000, ['2c', '3d']), seat(2, 10000), seat(3, 10000, ['4h', '5c'])],
      actions: [act('preflop', 1, 'call'), act('preflop', 2, 'fold'), act('preflop', 3, 'check'), ...checks('flop'), ...checks('turn'), ...checks('river')],
    })

  it('HC6 底池 125（50 + 50 + 25）；q = 62、r = 1；多出的 1 元給座位 3（BB）：座位 3 collected 63、座位 1 collected 62；不出現 62.5', () => {
    const d = chopDetail(25, 50)
    const s = play(d)
    expect(totalPot(s.players)).toBe(125)
    const hand = buildHand({ detail: d, board })
    expect(hand.amountUnit).toBe('yuan')
    expect(hand.kind).toBe('complete')
    expect(hand.detail!.collected).toEqual([
      { seatNo: 1, potIndex: 0, amount: 62 },
      { seatNo: 3, potIndex: 0, amount: 63 },
    ])
    for (const c of hand.detail!.collected) expect(Number.isInteger(c.amount)).toBe(true)
  })

  it('HC6 同樣行動、錦標賽（籌碼）結果數字相同', () => {
    const hand = buildHand({ detail: chopDetail(25, 50), board, gameType: 'tournament' })
    expect(hand.amountUnit).toBe('chip')
    expect(hand.detail!.collected).toEqual([
      { seatNo: 1, potIndex: 0, amount: 62 },
      { seatNo: 3, potIndex: 0, amount: 63 },
    ])
  })

  it('HC6 能整除的對照：sb 50 / bb 100 時底池 250，兩人各 125', () => {
    const hand = buildHand({ detail: chopDetail(50, 100), board })
    expect(totalPot(play(hand.detail!).players)).toBe(250)
    expect(hand.detail!.collected).toEqual([
      { seatNo: 1, potIndex: 0, amount: 125 },
      { seatNo: 3, potIndex: 0, amount: 125 },
    ])
  })
})

describe('HC7 2 人桌（按鈕座位 1、大盲座位 2）', () => {
  const d = detail({ tableSize: 2, buttonSeat: 1, heroSeat: 1, seats: [seat(1, 20000), seat(2, 20000)] })

  it('HC7 按鈕放小盲、翻前先行動；翻牌起座位 2 先行動；位置為 BTN、BB', () => {
    const s = startHand(d)
    expect(stackOf(s, 1)).toMatchObject({ street: 100, stack: 19900 })
    expect(stackOf(s, 2)).toMatchObject({ street: 200, stack: 19800 })
    expect(s.toAct).toBe(1)
    const flop = play({ ...d, actions: [act('preflop', 1, 'call'), act('preflop', 2, 'check')] })
    expect(flop.street).toBe('flop')
    expect(flop.toAct).toBe(2)
    expect(Object.fromEntries(positionsBySeat([1, 2], 1))).toEqual({ 1: 'BTN', 2: 'BB' })
    // 匯出摘要 `(button) (small blind)` 屬 H3
  })

  it('2 人桌：大盲在小盲只跟注時仍有選擇權（過牌或加注）', () => {
    const s = play({ ...d, actions: [act('preflop', 1, 'call')] })
    expect(legalActions(s)).toMatchObject({ seatNo: 2, canCheck: true, canRaise: true, toCall: 0 })
  })

  it('2 人桌按鈕在座位號較大者：大盲 = 另一位，翻後大盲先行動', () => {
    const d2 = detail({ tableSize: 6, buttonSeat: 5, heroSeat: 5, seats: [seat(2, 20000), seat(5, 20000)] })
    const s = play({ ...d2, actions: [act('preflop', 5, 'call'), act('preflop', 2, 'check')] })
    expect(stackOf(startHand(d2), 5).street).toBe(100)
    expect(s.toAct).toBe(2)
  })
})

describe('HC8 straddle（6 人、sb 100 / bb 200、straddle 400，座位 UTG）', () => {
  // 按鈕 1：2 SB、3 BB、4 UTG（straddle）
  const d = detail({
    tableSize: 6,
    buttonSeat: 1,
    heroSeat: 1,
    straddle: 400,
    seats: [1, 2, 3, 4, 5, 6].map((n) => seat(n, 20000)),
  })

  it('HC8 翻前 B = 400、L = 400，第一位行動者為 UTG 順時針下一位；最小加注到 800', () => {
    const s = startHand(d)
    expect(s.currentBet).toBe(400)
    expect(s.minRaise).toBe(400)
    expect(stackOf(s, 4)).toMatchObject({ street: 400, stack: 19600 })
    expect(s.toAct).toBe(5)
    expect(legalActions(s)).toMatchObject({ seatNo: 5, toCall: 400, minTo: 800 })
    expect(applyAction(s, act('preflop', 5, 'raise', 700))).toEqual({ ok: false, code: 'raiseTooSmall' })
    expect(positionsBySeat([1, 2, 3, 4, 5, 6], 1).get(4)).toBe('UTG')
  })

  it('HC8 若所有人跟注 400，straddle 玩家仍可過牌或加注', () => {
    const s = play({ ...d, actions: [5, 6, 1, 2, 3].map((n) => act('preflop', n, 'call')) })
    expect(s.street).toBe('preflop')
    expect(legalActions(s)).toMatchObject({ seatNo: 4, canCheck: true, canRaise: true, toCall: 0, minTo: 800 })
    const checked = applyAction(s, act('preflop', 4, 'check'))
    expect(checked.ok && checked.state.street).toBe('flop')
    // 翻後第一位行動者仍為按鈕順時針下一位（小盲）
    expect(checked.ok && checked.state.toAct).toBe(2)
    // 匯出 `posts straddle $400` 屬 H3
  })

  it('3 人桌 straddle 玩家為按鈕；翻前第一位行動者為小盲', () => {
    const d3 = detail({ tableSize: 3, buttonSeat: 1, heroSeat: 1, straddle: 400, seats: [seat(1, 5000), seat(2, 5000), seat(3, 5000)] })
    const s = startHand(d3)
    expect(stackOf(s, 1).street).toBe(400)
    expect(s.toAct).toBe(2)
  })
})

describe('HC9 錦標賽前注（8 人、sb 100 / bb 200 / ante 25，籌碼）', () => {
  // 按鈕 1：2 SB、3 BB
  const d = detail({ tableSize: 8, buttonSeat: 1, heroSeat: 1, ante: 25, seats: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => seat(n, 10000)) })

  it('HC9 發牌前底池 8 × 25 + 100 + 200 = 500；前注不計入該街投入', () => {
    const s = startHand(d)
    expect(s.potAtStart.preflop).toBe(500)
    expect(totalPot(s.players)).toBe(500)
    expect(stackOf(s, 3)).toMatchObject({ street: 200, total: 225, stack: 9775 })
    expect(stackOf(s, 5)).toMatchObject({ street: 0, total: 25, stack: 9975 })
  })

  it('HC9 翻前其他人都只跟注大盲時，大盲的 toCall 為 0，可過牌', () => {
    const s = play({ ...d, actions: [4, 5, 6, 7, 8, 1, 2].map((n) => act('preflop', n, 'call')) })
    expect(legalActions(s)).toMatchObject({ seatNo: 3, toCall: 0, canCheck: true })
  })

  it('HC9 amountUnit chip；rake 必須為 0', () => {
    const ok = buildHand({ detail: d, gameType: 'tournament' })
    expect(ok.amountUnit).toBe('chip')
    // rake 驗證見 hands-schema.test.ts（tournament rake > 0 被 Zod 拒絕）；匯出格式屬 H3
  })
})

describe('HC10 抽水扣除順序（HC5 加 rake 3500）', () => {
  const board = ['2c', '7d', '9h', 'Js', '4c']
  const d = detail({
    tableSize: 3,
    buttonSeat: 1,
    heroSeat: 1,
    rake: 3500,
    seats: [seat(1, 1000, ['Ah', 'Ad']), seat(2, 3000, ['Kh', 'Kd']), seat(3, 5000, ['Qh', 'Qd'])],
    actions: [act('preflop', 1, 'raise', 1000), act('preflop', 2, 'raise', 3000), act('preflop', 3, 'call')],
  })

  it('HC10 主池 3000 全扣為 0、邊池扣 500 為 3500；主池為 0 時不產生該池的 collected', () => {
    expect(potsAfterRake(buildPots(play(d).players), 3500)).toEqual([0, 3500])
    const hand = buildHand({ detail: d, board })
    expect(hand.kind).toBe('complete')
    expect(hand.detail!.collected).toEqual([{ seatNo: 2, potIndex: 1, amount: 3500 }])
    expect(hand.heroNet).toBe(-1000)
  })
})

describe('HC32–HC34 TDA Rule 47 例 1：多次不完整全下累計（盲注 50 / 100，翻牌）', () => {
  // 5 人、按鈕座位 5：1 小盲（A）、2 大盲（B）、3（C）、4（D）、5 按鈕（E）；翻前全部平跟、大盲過牌，翻牌順序 A–E
  // B 籌碼 225（翻前 100 + 翻牌 125）、D 籌碼 300（翻前 100 + 翻牌 200），其餘足夠
  const d = detail({
    tableSize: 5,
    buttonSeat: 5,
    heroSeat: 5,
    sb: 50,
    bb: 100,
    seats: [seat(1, 10000), seat(2, 225), seat(3, 10000), seat(4, 300), seat(5, 10000)],
  })
  const preflop = [act('preflop', 3, 'call'), act('preflop', 4, 'call'), act('preflop', 5, 'call'), act('preflop', 1, 'call'), act('preflop', 2, 'check')]
  const flop = [
    act('flop', 1, 'bet', 100),
    act('flop', 2, 'raise', 125), // 全下，增量 25 < 100（不完整）
    act('flop', 3, 'call'),
    act('flop', 4, 'raise', 200), // 全下，增量 75 < 100（不完整）
    act('flop', 5, 'call'),
  ]
  const base = [...preflop, ...flop]

  it('HC32 輪回 A：面對 200 − 100 = 100 ≥ L 100（累計達一次完整加注）→ 可加注，最小加注到 300', () => {
    const s = play({ ...d, actions: base })
    expect(s.currentBet).toBe(200)
    expect(s.minRaise).toBe(100)
    expect(stackOf(s, 2).stack).toBe(0)
    expect(stackOf(s, 4).stack).toBe(0)
    expect(legalActions(s)).toMatchObject({ seatNo: 1, canRaise: true, toCall: 100, minTo: 300 })
    expect(applyAction(s, act('flop', 1, 'raise', 250))).toEqual({ ok: false, code: 'raiseTooSmall' })
    expect(applyAction(s, act('flop', 1, 'raise', 300)).ok).toBe(true)
  })

  it('HC33 A 只跟注到 200；輪到 C：已跟 125、面對 75 < 100 → 不可加注，只能跟注 75 或棄牌；引擎拒絕 C 的 raise', () => {
    const s = play({ ...d, actions: [...base, act('flop', 1, 'call')] })
    expect(legalActions(s)).toMatchObject({ seatNo: 3, canRaise: false, canCall: true, canFold: true, canCheck: false, toCall: 75, callAmount: 75 })
    expect(applyAction(s, act('flop', 3, 'raise', 400))).toEqual({ ok: false, code: 'raiseNotReopened' })
    const called = applyAction(s, act('flop', 3, 'call'))
    expect(called.ok && called.state.street).toBe('turn')
  })

  it('HC34 A 加注到 300（最小加注）；輪到 C：面對 300 − 125 = 175 ≥ 100 → 可加注', () => {
    const s = play({ ...d, actions: [...base, act('flop', 1, 'raise', 300)] })
    expect(s.minRaise).toBe(100)
    expect(legalActions(s)).toMatchObject({ seatNo: 3, canRaise: true, toCall: 175, minTo: 400 })
    expect(applyAction(s, act('flop', 3, 'raise', 400)).ok).toBe(true)
  })
})

describe('HC35 TDA Rule 47 例 2：最小加注不累計（盲注 50 / 100，翻牌）', () => {
  // 6 人、按鈕座位 6：1 小盲（A）、2 大盲（B）、3（C）、4（D）、5（E）、6 按鈕（F）；翻前全部平跟、大盲過牌
  // B、C、D 籌碼依序 600、750、900（翻前 100 + 翻牌全下 500、650、800），其餘足夠
  const d = detail({
    tableSize: 6,
    buttonSeat: 6,
    heroSeat: 6,
    sb: 50,
    bb: 100,
    seats: [seat(1, 10000), seat(2, 600), seat(3, 750), seat(4, 900), seat(5, 10000), seat(6, 10000)],
  })
  const actions = [
    ...[3, 4, 5, 6, 1].map((n) => act('preflop', n, 'call')),
    act('preflop', 2, 'check'),
    act('flop', 1, 'bet', 300),
    act('flop', 2, 'raise', 500), // 全下，增量 200 < 300
    act('flop', 3, 'raise', 650), // 全下，增量 150 < 300
    act('flop', 4, 'raise', 800), // 全下，增量 150 < 300
    act('flop', 5, 'call'),
  ]

  it('HC35 輪到 F（未行動）：最小加注到 1100（800 + 最後一次完整下注 300），加注到 1000 被拒', () => {
    const s = play({ ...d, actions })
    expect(s.currentBet).toBe(800)
    expect(s.minRaise).toBe(300)
    expect(legalActions(s)).toMatchObject({ seatNo: 6, canRaise: true, toCall: 800, minTo: 1100 })
    expect(applyAction(s, act('flop', 6, 'raise', 1000))).toEqual({ ok: false, code: 'raiseTooSmall' })
    expect(applyAction(s, act('flop', 6, 'raise', 1100)).ok).toBe(true)
    // F 只跟注時輪回 A：面對 800 − 300 = 500 ≥ 300 → 可加注，最小仍到 1100
    const called = play({ ...d, actions: [...actions, act('flop', 6, 'call')] })
    expect(legalActions(called)).toMatchObject({ seatNo: 1, canRaise: true, toCall: 500, minTo: 1100 })
  })
})

describe('引擎邊界：合法行動與輪位', () => {
  const six = detail({ tableSize: 6, buttonSeat: 4, heroSeat: 4, seats: [1, 2, 3, 4, 5, 6].map((n) => seat(n, 20000)) })

  it('toCall > 0 不能過牌、toCall = 0 不能跟注；翻前不能 bet；不是輪到的座位被拒', () => {
    const s = startHand(six)
    expect(s.toAct).toBe(1)
    expect(applyAction(s, act('preflop', 1, 'check'))).toEqual({ ok: false, code: 'cannotCheck' })
    expect(applyAction(s, act('preflop', 1, 'bet', 400))).toEqual({ ok: false, code: 'cannotBet' })
    expect(applyAction(s, act('preflop', 2, 'fold'))).toEqual({ ok: false, code: 'notYourTurn' })
    expect(applyAction(s, act('flop', 1, 'fold'))).toEqual({ ok: false, code: 'wrongStreet' })
    const flop = play({ ...six, actions: [1, 2, 3, 4, 5].map((n) => act('preflop', n, n === 5 ? 'call' : 'fold')).concat([act('preflop', 6, 'check')]) })
    expect(flop.street).toBe('flop')
    expect(flop.toAct).toBe(5)
    expect(applyAction(flop, act('flop', 5, 'call'))).toEqual({ ok: false, code: 'cannotCall' })
    expect(applyAction(flop, act('flop', 5, 'raise', 400))).toEqual({ ok: false, code: 'cannotRaise' })
    // 引擎接受 toCall = 0 時棄牌（供匯入使用，4.3）
    expect(applyAction(flop, act('flop', 5, 'fold')).ok).toBe(true)
  })

  it('bet：最少 bb，籌碼不足 bb 時只能全下；超過籌碼被拒；下注後 L = max(to, bb)', () => {
    const flop = play({ ...six, actions: [act('preflop', 1, 'call'), act('preflop', 2, 'fold'), act('preflop', 3, 'fold'), act('preflop', 4, 'fold'), act('preflop', 5, 'fold'), act('preflop', 6, 'check')] })
    expect(flop.toAct).toBe(6)
    expect(applyAction(flop, act('flop', 6, 'bet', 150))).toEqual({ ok: false, code: 'betTooSmall' })
    expect(applyAction(flop, act('flop', 6, 'bet', 19801))).toEqual({ ok: false, code: 'exceedsStack' })
    const r = applyAction(flop, act('flop', 6, 'bet', 300))
    expect(r.ok && [r.state.currentBet, r.state.minRaise]).toEqual([300, 300])
    // 籌碼不足 bb：只能全下
    const short = detail({ tableSize: 2, buttonSeat: 1, heroSeat: 1, seats: [seat(1, 350), seat(2, 20000)] })
    const sf = play({ ...short, actions: [act('preflop', 1, 'call'), act('preflop', 2, 'check')] })
    expect(sf.toAct).toBe(2)
    const s2 = play({ ...short, actions: [act('preflop', 1, 'call'), act('preflop', 2, 'check'), act('flop', 2, 'check')] })
    expect(legalActions(s2)).toMatchObject({ seatNo: 1, canBet: true, minTo: 150, maxTo: 150 })
    expect(applyAction(s2, act('flop', 1, 'bet', 100))).toEqual({ ok: false, code: 'betTooSmall' })
    const allIn = applyAction(s2, act('flop', 1, 'bet', 150))
    expect(allIn.ok && [allIn.state.currentBet, allIn.state.minRaise]).toEqual([150, 200])
    // 不足 bb 的全下下注為不完整下注：已過牌的座位 2 面對 150 < L 200，不重新開放（4.3，TDA Rule 47 A）
    expect(allIn.ok && legalActions(allIn.state)).toMatchObject({ seatNo: 2, canRaise: false, canCall: true, toCall: 150 })
  })

  it('跟注金額不足時全下（投入 min(toCall, S)）', () => {
    const d = detail({ tableSize: 3, buttonSeat: 1, heroSeat: 1, seats: [seat(1, 20000), seat(2, 600), seat(3, 20000)] })
    const s = play({ ...d, actions: [act('preflop', 1, 'raise', 2000), act('preflop', 2, 'call')] })
    expect(stackOf(s, 2)).toMatchObject({ stack: 0, street: 600, total: 600 })
  })

  it('翻後跳過已棄牌與全下的玩家', () => {
    const d = detail({ tableSize: 4, buttonSeat: 1, heroSeat: 1, seats: [seat(1, 20000), seat(2, 20000), seat(3, 1000), seat(4, 20000)] })
    // 4 人：2 SB、3 BB、4 CO 先行動
    const s = play({
      ...d,
      actions: [act('preflop', 4, 'raise', 1000), act('preflop', 1, 'call'), act('preflop', 2, 'fold'), act('preflop', 3, 'call')],
    })
    expect(stackOf(s, 3).stack).toBe(0)
    expect(s.street).toBe('flop')
    // 按鈕順時針下一位：2 已棄牌、3 全下 → 4
    expect(s.toAct).toBe(4)
  })

  it('所有人全下自動發完：翻前 4 人全下 → runout，之後任何行動被拒', () => {
    const d = detail({ tableSize: 4, buttonSeat: 1, heroSeat: 1, seats: [seat(1, 1000), seat(2, 2000), seat(3, 3000), seat(4, 4000)] })
    const s = play({
      ...d,
      actions: [act('preflop', 4, 'raise', 4000), act('preflop', 1, 'call'), act('preflop', 2, 'call'), act('preflop', 3, 'call')],
    })
    expect(s.status).toBe('showdown')
    expect(s.runout).toBe(true)
    expect(s.completedStreets).toEqual(['preflop'])
    // 座位 4 的 4000 只有自己 → 退回 1000
    expect(s.refunds).toEqual([{ street: 'preflop', seatNo: 4, amount: 1000 }])
    expect(applyAction(s, act('flop', 2, 'check'))).toEqual({ ok: false, code: 'handEnded' })
  })

  it('多人全下多層邊池：4 層，含已棄牌者的投入', () => {
    // 5 人：座位 5 投入 1500 後棄牌
    const d = detail({
      tableSize: 5,
      buttonSeat: 1,
      heroSeat: 1,
      seats: [seat(1, 1000), seat(2, 2000), seat(3, 3000), seat(4, 4000), seat(5, 20000)],
    })
    // 2 SB、3 BB、4 HJ、5 CO、1 BTN
    const actions = [
      act('preflop', 4, 'raise', 1500),
      act('preflop', 5, 'call'),
      act('preflop', 1, 'call'),
      // 2、3 各自全下，增量 500、1000 都小於 L 1300 → 不完整加注
      act('preflop', 2, 'raise', 2000),
      act('preflop', 3, 'raise', 3000),
    ]
    const facing = play({ ...d, actions })
    expect(facing.minRaise).toBe(1300)
    const s = play({ ...d, actions: [...actions, act('preflop', 4, 'call'), act('preflop', 5, 'fold')] })
    expect(s.status).toBe('showdown')
    expect(s.runout).toBe(true)
    expect(s.refunds).toEqual([])
    expect(buildPots(s.players)).toEqual([
      { amount: 5000, eligible: [1, 2, 3, 4] },
      { amount: 3500, eligible: [2, 3, 4] },
      { amount: 2000, eligible: [3, 4] },
    ])
    expect(totalPot(s.players)).toBe(10500)
  })

  it('analyzeDetail：籌碼必須大於要放的前注 + 盲注', () => {
    const d = detail({ tableSize: 3, buttonSeat: 1, heroSeat: 1, ante: 50, seats: [seat(1, 20000), seat(2, 150), seat(3, 20000)] })
    expect(analyzeDetail(d, [])).toEqual({ ok: false, issue: { code: 'stackTooSmall', seatNo: 2 } })
    expect(analyzeDetail({ ...d, seats: [seat(1, 20000), seat(2, 151), seat(3, 20000)] }, []).ok).toBe(true)
  })

  it('classifyHand：簡易備忘（detail null）為 simple', () => {
    expect(classifyHand({ detail: null, board: [], source: 'manual' })).toBe('simple')
  })
})
