// SPEC-v2-hands 3.1–3.6 的 Zod schema、3.8 金額單位推導、3.9 結構驗證與 kind 判定、3.1 摘要推導
// 12.3 H0「3.1–3.5 的 Zod schema 與 3.9 的結構驗證、kind 判定、摘要推導、amountUnit 推導有單元測試；HC11、HC12、HC30、HC31 通過」
import { describe, expect, it } from 'vitest'
import {
  analyzeDetail,
  buildPots,
  classifyHand,
  deriveAmountUnit,
  finalizeHandContent,
  handSchema,
  netResults,
  replay,
  summarizeHand,
  totalPot,
  verifyHand,
  type Hand,
  type HandDetail,
} from '../../src/domain/hands'
import { completeCaseHands, hc5Detail, runoutBoard } from './helpers/handCases'
import { EXAMPLE_79_BOARD, act, buildHand, detail, example79Detail, example79Hand, handUuid, seat } from './helpers/hands'

/** 未進入攤牌的手牌：對手不可有手牌（3.3），移除 7.9 範例中座位 6 的牌 */
const noVillainCards = (d: HandDetail): HandDetail => ({
  ...d,
  seats: d.seats.map((s) => (s.seatNo === d.heroSeat ? s : { ...s, cards: [] })),
})

/** Zod 失敗時回傳第一個問題的訊息代碼；成功回傳 null */
const zodIssue = (value: unknown): string | null => {
  const r = handSchema.safeParse(value)
  return r.success ? null : r.error.issues[0]!.message
}

describe('7.9 範例的資料通過 Zod 與 3.9 驗證', () => {
  it('7.9 規格 JSON（加上省略的 id、tags、note、時間戳）通過 handSchema 與 verifyHand，kind complete', () => {
    const h = example79Hand()
    expect(handSchema.safeParse(h).success).toBe(true)
    expect(verifyHand(h)).toEqual({ ok: true, kind: 'complete' })
    expect(classifyHand(h)).toBe('complete')
  })

  it('finalizeHandContent 由 detail 推導出與規格 JSON 完全相同的系統欄位（amountUnit、kind、摘要、collected）', () => {
    const spec = example79Hand()
    const { id: _id, exportSeq: _seq, createdAt: _c, updatedAt: _u, kind: _k, amountUnit: _a, ...content } = spec
    void [_id, _seq, _c, _u, _k, _a]
    const finalized = finalizeHandContent({
      ...content,
      bb: null,
      heroCards: [],
      heroPosition: null,
      heroNet: null,
      detail: { ...spec.detail!, collected: [] },
    })
    expect(finalized).toEqual({ ...content, kind: 'complete', amountUnit: 'yuan' })
  })
})

describe('HC11 恆等式（本表所有完整手牌）', () => {
  for (const { name, hand } of completeCaseHands()) {
    it(`HC11 ${name}：Σ 所有玩家 net = −rake；Σ collected = 底池總額 − rake`, () => {
      expect(hand.kind).toBe('complete')
      expect(verifyHand(hand)).toEqual({ ok: true, kind: 'complete' })
      const d = hand.detail!
      const net = netResults(d, hand.board)!
      expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0 - d.rake)
      const r = replay(d)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const pot = totalPot(r.state.players)
      expect(d.collected.reduce((s, c) => s + c.amount, 0)).toBe(pot - d.rake)
      // 邊池合計 = 底池總額
      expect(buildPots(r.state.players).reduce((s, p) => s + p.amount, 0)).toBe(pot)
    })
  }
})

describe('HC12 牌重複', () => {
  it('HC12 heroCards 與 board 有同一張牌：Zod 失敗', () => {
    const memo = buildHand({ detail: null, heroCards: ['As', 'Ks'], board: ['As', '7d', '2c'] })
    expect(zodIssue(memo)).toBe('duplicate_card')
    const full = example79Hand({ board: ['Kh', '7d', '2c', '9s', 'As'] })
    expect(zodIssue(full)).toBe('duplicate_card')
  })

  it('HC12 兩位攤牌者有同一張牌：Zod 失敗', () => {
    const d = example79Detail()
    const bad = example79Hand({ detail: { ...d, seats: d.seats.map((s) => (s.seatNo === 6 ? { ...s, cards: ['As', 'Qs'] } : s)) } })
    expect(zodIssue(bad)).toBe('duplicate_card')
    const villains = buildHand({ detail: hc5Detail(0), board: runoutBoard })
    const vd = villains.detail!
    const dup = { ...villains, detail: { ...vd, seats: vd.seats.map((s) => (s.seatNo === 3 ? { ...s, cards: ['Kh', 'Qd'] } : s)) } }
    expect(zodIssue(dup)).toBe('duplicate_card')
    // 選牌器的 disabled 屬 H1 UI
  })

  it('牌面編碼區分大小寫：`as`、`10h`、`AS` 不合法', () => {
    for (const c of ['as', '10h', 'AS', 'Ax', '1s']) {
      expect(zodIssue(buildHand({ detail: null, heroCards: [c, 'Kd'] }))).not.toBeNull()
    }
  })
})

describe('HC30 kind 判定', () => {
  it('HC30 只有牌局設定與翻前 2 筆行動的 detail → simple、heroNet null', () => {
    const d = noVillainCards(example79Detail())
    const partial = buildHand({ detail: { ...d, actions: d.actions.slice(0, 2), rake: 0, collected: [] }, board: [] })
    expect(partial.kind).toBe('simple')
    expect(partial.heroNet).toBeNull()
    expect(partial.detail!.collected).toEqual([])
    // 摘要欄位仍由 detail 推導
    expect(partial).toMatchObject({ bb: 200, heroCards: ['As', 'Ks'], heroPosition: 'BTN' })
    expect(verifyHand(partial)).toEqual({ ok: true, kind: 'simple' })
  })

  it('HC30 結束但攤牌對手未選牌也未蓋牌 → simple', () => {
    const d = example79Detail()
    const noCards = buildHand({
      detail: { ...d, seats: d.seats.map((s) => (s.seatNo === 6 ? { ...s, cards: [] } : s)), collected: [] },
      board: EXAMPLE_79_BOARD,
    })
    expect(noCards.kind).toBe('simple')
    expect(noCards.heroNet).toBeNull()
    expect(noCards.detail!.collected).toEqual([])
    expect(verifyHand(noCards).ok).toBe(true)
  })

  it('HC30 7.9 範例 → complete', () => {
    expect(classifyHand(example79Hand())).toBe('complete')
  })

  it('HC30 kind 被竄改為 complete 的未完成手牌：verifyHand 拒絕（備份匯入的拒絕見 hands-backup.test.ts）', () => {
    const d = noVillainCards(example79Detail())
    const partial = buildHand({ detail: { ...d, actions: d.actions.slice(0, 2), rake: 0, collected: [] } })
    expect(verifyHand({ ...partial, kind: 'complete' })).toEqual({ ok: false, error: { code: 'kindMismatch', expected: 'simple' } })
    // 反向：完整手牌被改為 simple 也拒絕
    expect(verifyHand({ ...example79Hand(), kind: 'simple' })).toEqual({
      ok: false,
      error: { code: 'kindMismatch', expected: 'complete' },
    })
  })

  it('3.9 第 2 點：Hero 沒有 2 張手牌 → simple', () => {
    const d = example79Detail()
    const h = buildHand({ detail: { ...d, seats: d.seats.map((s) => (s.seatNo === 4 ? { ...s, cards: [] } : s)) }, board: EXAMPLE_79_BOARD })
    expect(h.kind).toBe('simple')
    expect(h.heroCards).toEqual([])
  })

  it('3.9 第 4 點：公牌張數必須符合實際進行到的街（自動發完時必須 5 張；翻前結束為 0 張）', () => {
    const d = example79Detail()
    expect(buildHand({ detail: d, board: EXAMPLE_79_BOARD.slice(0, 4) }).kind).toBe('simple')
    // HC2 型：翻前結束，公牌必須 0 張；有 3 張（「已進行到的街加一條」的上限內）時為 simple
    const walk = detail({ ...noVillainCards(d), actions: [1, 2, 3, 4, 5].map((n) => act('preflop', n, 'fold')), rake: 0 })
    expect(buildHand({ detail: walk }).kind).toBe('complete')
    expect(buildHand({ detail: walk, board: ['Kh', '7d', '2c'] }).kind).toBe('simple')
  })

  it('3.9 第 6 點：手動手牌的 collected 必須等於 4.8 計算值；不符時判定為 simple，kind complete 被拒', () => {
    const h = example79Hand()
    const wrong: Hand = { ...h, detail: { ...h.detail!, collected: [{ seatNo: 4, potIndex: 0, amount: 33800 }] } }
    // 合計不符屬結構驗證失敗
    expect(verifyHand(wrong)).toMatchObject({ ok: false, error: { code: 'invalidDetail', issue: { code: 'collectedSumMismatch' } } })
    // 合計相符但分配錯誤（給了 BB）
    const misassigned: Hand = { ...h, detail: { ...h.detail!, collected: [{ seatNo: 6, potIndex: 0, amount: 33900 }] } }
    expect(classifyHand(misassigned)).toBe('simple')
    expect(verifyHand(misassigned)).toMatchObject({ ok: false, error: { code: 'kindMismatch' } })
  })

  it('3.9：簡易手牌（未完成）的 collected 必須為 []', () => {
    const d = example79Detail()
    const noCards = { ...d, seats: d.seats.map((s) => (s.seatNo === 6 ? { ...s, cards: [] } : s)) }
    const h = buildHand({ detail: { ...noCards, collected: [] }, board: EXAMPLE_79_BOARD })
    expect(verifyHand({ ...h, detail: { ...h.detail!, collected: [{ seatNo: 4, potIndex: 0, amount: 33900 }] } })).toEqual({
      ok: false,
      error: { code: 'collectedMustBeEmpty' },
    })
  })

  it('3.1 摘要欄位與推導不一致時拒絕（bb、heroCards、heroPosition、heroNet）', () => {
    const h = example79Hand()
    expect(verifyHand({ ...h, bb: 100 })).toEqual({ ok: false, error: { code: 'summaryMismatch', field: 'bb' } })
    expect(verifyHand({ ...h, heroCards: ['Ks', 'As'] })).toEqual({ ok: false, error: { code: 'summaryMismatch', field: 'heroCards' } })
    expect(verifyHand({ ...h, heroPosition: 'CO' })).toEqual({ ok: false, error: { code: 'summaryMismatch', field: 'heroPosition' } })
    expect(verifyHand({ ...h, heroNet: 16900 })).toEqual({ ok: false, error: { code: 'summaryMismatch', field: 'heroNet' } })
    expect(summarizeHand({ ...h, detail: h.detail! })).toEqual({ bb: 200, heroCards: ['As', 'Ks'], heroPosition: 'BTN', heroNet: 16800 })
  })

  it('純備忘（detail null）：kind 必須為 simple；摘要欄位為使用者輸入的備忘值', () => {
    const memo = buildHand({ detail: null, heroCards: ['Ah', 'Kd'], heroPosition: 'CO', bb: 200, heroNet: -1250, tags: ['3bet'] })
    expect(memo).toMatchObject({ kind: 'simple', heroNet: -1250, heroPosition: 'CO', bb: 200 })
    expect(handSchema.safeParse(memo).success).toBe(true)
    expect(verifyHand(memo)).toEqual({ ok: true, kind: 'simple' })
    expect(verifyHand({ ...memo, kind: 'complete' })).toEqual({ ok: false, error: { code: 'kindMismatch', expected: 'simple' } })
  })
})

describe('HC31 金額單位推導與驗證', () => {
  it('HC31 manual + cash → yuan、gg + cash → cent、tournament → chip', () => {
    expect(deriveAmountUnit('manual', 'cash')).toBe('yuan')
    expect(deriveAmountUnit('gg', 'cash')).toBe('cent')
    expect(deriveAmountUnit('manual', 'tournament')).toBe('chip')
    expect(deriveAmountUnit('gg', 'tournament')).toBe('chip')
  })

  it('HC31 amountUnit 與推導不符的手牌被 Zod 拒絕（儲存與備份匯入共用；見 hands-repo、hands-backup 測試）', () => {
    expect(zodIssue(example79Hand({ amountUnit: 'cent' }))).toBe('amount_unit_mismatch')
    expect(zodIssue(example79Hand({ amountUnit: 'chip' }))).toBe('amount_unit_mismatch')
    expect(zodIssue(buildHand({ detail: null, gameType: 'tournament', heroCards: ['Ah', 'Kd'] }))).toBeNull()
    expect(zodIssue({ ...buildHand({ detail: null, gameType: 'tournament', heroCards: ['Ah', 'Kd'] }), amountUnit: 'yuan' })).toBe(
      'amount_unit_mismatch',
    )
  })

  it('3.8 單一金額上限依單位：元 99,999,999、分 9,999,999,900、籌碼 99,999,999', () => {
    const memo = (bb: number, extra: Partial<Hand> = {}) => ({ ...buildHand({ detail: null, heroCards: ['Ah', 'Kd'] }), bb, ...extra })
    expect(zodIssue(memo(99_999_999))).toBeNull()
    expect(zodIssue(memo(100_000_000))).toBe('amount_exceeds_unit_max')
    const gg = buildHand({ detail: null, source: 'gg', heroCards: ['Ah', 'Kd'] })
    expect(zodIssue({ ...gg, bb: 9_999_999_900 })).toBeNull()
    expect(zodIssue({ ...gg, bb: 9_999_999_901 })).not.toBeNull()
    expect(zodIssue(memo(1.5))).not.toBeNull()
    expect(zodIssue(memo(200, { heroNet: -99_999_999 }))).toBeNull()
    expect(zodIssue(memo(200, { heroNet: -100_000_000 }))).toBe('amount_exceeds_unit_max')
    const d = example79Detail()
    expect(zodIssue(example79Hand({ detail: { ...d, seats: d.seats.map((s) => (s.seatNo === 1 ? { ...s, stack: 100_000_000 } : s)) } }))).toBe(
      'amount_exceeds_unit_max',
    )
  })

  it('3.2：錦標賽 rake 必須為 0', () => {
    const t = buildHand({ detail: { ...example79Detail(), rake: 0, collected: [] }, board: EXAMPLE_79_BOARD, gameType: 'tournament' })
    expect(t.amountUnit).toBe('chip')
    expect(zodIssue(t)).toBeNull()
    expect(zodIssue({ ...t, detail: { ...t.detail!, rake: 400 } })).toBe('tournament_rake_not_zero')
  })
})

describe('3.1 欄位規則（Zod）', () => {
  const memo = () => buildHand({ detail: null, heroCards: ['Ah', 'Kd'] })

  it('所有欄位都必須存在；未知欄位拒絕', () => {
    const { note: _n, ...missing } = memo()
    void _n
    expect(handSchema.safeParse(missing).success).toBe(false)
    expect(handSchema.safeParse({ ...memo(), extra: 1 }).success).toBe(false)
  })

  it('playedAt：`YYYY-MM-DDTHH:mm:ss` 合法日期；手動紀錄秒數固定 00；GG 可有秒數', () => {
    expect(zodIssue({ ...memo(), playedAt: '2026-09-30T21:15' })).toBe('invalid_played_at')
    expect(zodIssue({ ...memo(), playedAt: '2026-02-30T21:15:00' })).toBe('invalid_played_at')
    expect(zodIssue({ ...memo(), playedAt: '2026-09-30T21:15:13' })).toBe('manual_seconds_not_zero')
    expect(zodIssue({ ...buildHand({ detail: null, source: 'gg', heroCards: ['Ah', 'Kd'] }), playedAt: '2026-09-20T22:05:13' })).toBeNull()
  })

  it('exportSeq：1–99,999,999,999,999 的整數', () => {
    expect(zodIssue({ ...memo(), exportSeq: 0 })).not.toBeNull()
    expect(zodIssue({ ...memo(), exportSeq: 99_999_999_999_999 })).toBeNull()
    expect(zodIssue({ ...memo(), exportSeq: 100_000_000_000_000 })).not.toBeNull()
  })

  it('heroCards 0 或 2 張；board 0、3、4、5 張', () => {
    expect(zodIssue({ ...memo(), heroCards: ['Ah'] })).toBe('invalid_card_count')
    for (const n of [1, 2]) expect(zodIssue({ ...memo(), board: ['2c', '3c'].slice(0, n) })).toBe('invalid_board_count')
    expect(zodIssue({ ...memo(), board: ['2c', '3c', '4c', '5c', '6c', '7c'] })).toBe('invalid_board_count')
  })

  it('tags：0–10 個、去除前後空白後 1–20 字、不分大小寫不可重複、不得為 null', () => {
    expect(zodIssue({ ...memo(), tags: Array.from({ length: 10 }, (_, i) => `t${i}`) })).toBeNull()
    expect(zodIssue({ ...memo(), tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).not.toBeNull()
    expect(zodIssue({ ...memo(), tags: [' 3bet'] })).toBe('not_trimmed')
    expect(zodIssue({ ...memo(), tags: [''] })).toBe('empty_text')
    expect(zodIssue({ ...memo(), tags: ['一二三四五六七八九十一二三四五六七八九十'] })).toBeNull()
    expect(zodIssue({ ...memo(), tags: ['一二三四五六七八九十一二三四五六七八九十一'] })).toBe('text_too_long')
    expect(zodIssue({ ...memo(), tags: ['3Bet', '3bet'] })).toBe('duplicate_tag')
    expect(zodIssue({ ...memo(), tags: null })).not.toBeNull()
  })

  it('note：null 或 1–1,000 字', () => {
    expect(zodIssue({ ...memo(), note: '' })).toBe('empty_text')
    expect(zodIssue({ ...memo(), note: 'a'.repeat(1000) })).toBeNull()
    expect(zodIssue({ ...memo(), note: 'a'.repeat(1001) })).toBe('text_too_long')
  })

  it('source 為 gg 時 sourceHandId（1–40 英數字）、rawText、parserVersion 必填；manual 時必須為 null', () => {
    expect(zodIssue({ ...memo(), sourceHandId: 'RC1' })).toBe('source_field_not_allowed')
    expect(zodIssue({ ...memo(), rawText: 'x' })).toBe('source_field_not_allowed')
    expect(zodIssue({ ...memo(), parserVersion: 1 })).toBe('source_field_not_allowed')
    const gg = buildHand({ detail: null, source: 'gg', heroCards: ['Ah', 'Kd'] })
    expect(zodIssue(gg)).toBeNull()
    expect(zodIssue({ ...gg, sourceHandId: null })).toBe('source_field_required')
    expect(zodIssue({ ...gg, sourceHandId: 'RC-1' })).toBe('invalid_source_hand_id')
    expect(zodIssue({ ...gg, sourceHandId: 'A'.repeat(41) })).toBe('invalid_source_hand_id')
    expect(zodIssue({ ...gg, rawText: null })).toBe('source_field_required')
    expect(zodIssue({ ...gg, rawText: 'x'.repeat(20001) })).toBe('text_too_long')
    expect(zodIssue({ ...gg, parserVersion: null })).toBe('source_field_required')
  })

  it('id 必須為 UUID；createdAt、updatedAt 含時區', () => {
    expect(zodIssue({ ...memo(), id: 'abc' })).not.toBeNull()
    expect(zodIssue({ ...memo(), createdAt: '2026-10-01T21:05:00' })).not.toBeNull()
    expect(zodIssue({ ...memo(), id: handUuid() })).toBeNull()
  })
})

describe('3.2–3.5 detail 欄位規則', () => {
  const ok = () => example79Hand()
  const withDetail = (patch: Partial<HandDetail>) => example79Hand({ detail: { ...example79Detail(), ...patch } })

  it('tableSize 2–10；seats 2–tableSize 筆、依 seatNo 排列不重複、seatNo ≤ tableSize', () => {
    expect(zodIssue(ok())).toBeNull()
    expect(zodIssue(withDetail({ tableSize: 11 }))).not.toBeNull()
    expect(zodIssue(withDetail({ tableSize: 5 }))).toBe('too_many_seats')
    const seats = example79Detail().seats
    expect(zodIssue(withDetail({ seats: [seats[1]!, seats[0]!, ...seats.slice(2)] }))).toBe('seats_not_sorted')
    expect(zodIssue(withDetail({ seats: [seats[0]!, seats[0]!, ...seats.slice(2)] }))).toBe('seats_not_sorted')
    expect(zodIssue(withDetail({ seats: [seats[0]!] }))).not.toBeNull()
  })

  it('buttonSeat、heroSeat 必須是 seats 中的座位；bb ≥ sb；straddle 0 或 2 × bb 且 3 人以上', () => {
    expect(zodIssue(withDetail({ buttonSeat: 7 }))).not.toBeNull()
    expect(zodIssue(withDetail({ heroSeat: 9 }))).not.toBeNull()
    expect(zodIssue(withDetail({ sb: 300 }))).toBe('bb_less_than_sb')
    expect(zodIssue(withDetail({ straddle: 300 }))).toBe('invalid_straddle')
    const hu = detail({ tableSize: 2, buttonSeat: 1, heroSeat: 1, straddle: 400, seats: [seat(1, 20000), seat(2, 20000)] })
    expect(zodIssue(buildHand({ detail: hu }))).toBe('straddle_needs_three_players')
  })

  it('Action.to：bet、raise 必填；fold、check、call 必須為 null；actions 最多 200 筆', () => {
    const actions = example79Detail().actions
    expect(zodIssue(withDetail({ actions: actions.map((a, i) => (i === 3 ? { ...a, to: null } : a)) }))).toBe('action_to_required')
    expect(zodIssue(withDetail({ actions: actions.map((a, i) => (i === 0 ? { ...a, to: 100 } : a)) }))).toBe('action_to_not_allowed')
    expect(handSchema.safeParse(withDetail({ actions: Array.from({ length: 201 }, () => actions[0]!) })).success).toBe(false)
  })

  it('Collected：amount ≥ 1；依 potIndex、seatNo 排序且組合不重複', () => {
    const c = { seatNo: 4, potIndex: 0, amount: 33900 }
    expect(zodIssue(withDetail({ collected: [{ ...c, amount: 0 }] }))).not.toBeNull()
    expect(zodIssue(withDetail({ collected: [c, c] }))).toBe('collected_not_sorted')
  })

  it('Seat.name：手動紀錄必須為 null；GG 須符合 7.3 寫入條件', () => {
    const d = example79Detail()
    const named = { ...d, seats: d.seats.map((s) => (s.seatNo === 1 ? { ...s, name: 'abc123' } : s)) }
    expect(zodIssue(example79Hand({ detail: named }))).toBe('seat_name_not_allowed')
    const gg = buildHand({ detail: null, source: 'gg', heroCards: ['Ah', 'Kd'] })
    const ggWith = (name: string) => ({ ...gg, detail: { ...named, seats: named.seats.map((s) => (s.seatNo === 1 ? { ...s, name } : s)) } })
    expect(zodIssue(ggWith('Villain3'))).toBe('invalid_seat_name')
    expect(zodIssue(ggWith('a:b'))).toBe('invalid_seat_name')
  })
})

describe('3.9 結構驗證（需重播的規則）', () => {
  const d79 = example79Detail()

  it('行動不合法：回報第幾個行動與原因', () => {
    const bad = { ...d79, actions: d79.actions.map((a, i) => (i === 4 ? { ...a, type: 'check' as const } : a)) }
    expect(analyzeDetail(bad, [])).toEqual({ ok: false, issue: { code: 'illegalAction', actionIndex: 4, actionError: 'cannotCheck' } })
    const skipped = { ...d79, actions: [d79.actions[1]!] }
    expect(analyzeDetail(skipped, [])).toEqual({ ok: false, issue: { code: 'illegalAction', actionIndex: 0, actionError: 'notYourTurn' } })
    // 街不可倒退 / 跳過
    const early = { ...d79, actions: [...d79.actions.slice(0, 5), { ...d79.actions[5]!, street: 'flop' as const }] }
    expect(analyzeDetail(early, [])).toMatchObject({ ok: false, issue: { code: 'illegalAction', actionIndex: 5, actionError: 'wrongStreet' } })
  })

  it('公牌張數：翻前沒結束不能輸入翻牌；翻前下注結束時可先輸入翻牌；翻牌有行動時必須已有 3 張；自動發完後可直接到 5 張', () => {
    const open = noVillainCards(d79)
    const pre = { ...open, actions: d79.actions.slice(0, 5), collected: [] }
    expect(analyzeDetail(pre, ['Kh', '7d', '2c'])).toEqual({ ok: false, issue: { code: 'boardTooLong' } })
    const preDone = { ...open, actions: d79.actions.slice(0, 6), collected: [] }
    expect(analyzeDetail(preDone, []).ok).toBe(true)
    expect(analyzeDetail(preDone, ['Kh', '7d', '2c']).ok).toBe(true)
    expect(analyzeDetail(preDone, ['Kh', '7d', '2c', '9s'])).toEqual({ ok: false, issue: { code: 'boardTooLong' } })
    const flopAction = { ...open, actions: d79.actions.slice(0, 7), collected: [] }
    expect(analyzeDetail(flopAction, [])).toEqual({ ok: false, issue: { code: 'boardTooShort' } })
    expect(analyzeDetail(flopAction, ['Kh', '7d', '2c']).ok).toBe(true)
    // 轉牌全下自動發完 → 可直接到 5 張
    expect(analyzeDetail(d79, EXAMPLE_79_BOARD).ok).toBe(true)
    expect(analyzeDetail(d79, EXAMPLE_79_BOARD.slice(0, 4)).ok).toBe(true)
  })

  it('3.3：棄牌的玩家必須為 []；只有進入攤牌的對手可為 mucked；Hero 不可蓋牌', () => {
    const foldedCards = { ...d79, seats: d79.seats.map((s) => (s.seatNo === 5 ? { ...s, cards: ['2h', '2d'] } : s)) }
    expect(analyzeDetail(foldedCards, EXAMPLE_79_BOARD)).toEqual({ ok: false, issue: { code: 'cardsNotAllowed', seatNo: 5 } })
    const foldedMuck = { ...d79, seats: d79.seats.map((s) => (s.seatNo === 5 ? { ...s, mucked: true } : s)) }
    expect(analyzeDetail(foldedMuck, EXAMPLE_79_BOARD)).toEqual({ ok: false, issue: { code: 'muckNotAllowed', seatNo: 5 } })
    const heroMuck = { ...d79, seats: d79.seats.map((s) => (s.seatNo === 4 ? { ...s, cards: [], mucked: true } : s)) }
    expect(analyzeDetail(heroMuck, EXAMPLE_79_BOARD)).toEqual({ ok: false, issue: { code: 'muckNotAllowed', seatNo: 4 } })
    const muckWithCards = { ...d79, seats: d79.seats.map((s) => (s.seatNo === 6 ? { ...s, mucked: true } : s)) }
    expect(analyzeDetail(muckWithCards, EXAMPLE_79_BOARD)).toEqual({ ok: false, issue: { code: 'muckNotAllowed', seatNo: 6 } })
    // 未進入攤牌（進行中）的對手不可有手牌
    const inProgress = { ...d79, actions: d79.actions.slice(0, 7), collected: [] }
    expect(analyzeDetail(inProgress, ['Kh', '7d', '2c'])).toEqual({ ok: false, issue: { code: 'cardsNotAllowed', seatNo: 6 } })
  })

  it('3.2：rake ≤ 底池總額；手牌未結束時 collected 必須為 []', () => {
    expect(analyzeDetail({ ...d79, rake: 34301, collected: [] }, EXAMPLE_79_BOARD)).toEqual({ ok: false, issue: { code: 'rakeExceedsPot' } })
    const inProgress = { ...d79, seats: d79.seats.map((s) => ({ ...s, cards: s.seatNo === 4 ? s.cards : [] })), actions: d79.actions.slice(0, 7) }
    expect(analyzeDetail(inProgress, ['Kh', '7d', '2c'])).toEqual({ ok: false, issue: { code: 'collectedBeforeEnd' } })
  })

  it('3.5 / 4.8：potIndex 必須小於池數、seatNo 必須是資格者、每池合計 ≤ 扣抽水後金額、Σ = 底池 − rake', () => {
    const c = (seatNo: number, potIndex: number, amount: number) => ({ seatNo, potIndex, amount })
    expect(analyzeDetail({ ...d79, collected: [c(4, 1, 33900)] }, EXAMPLE_79_BOARD)).toMatchObject({ ok: false, issue: { code: 'collectedInvalidPot' } })
    expect(analyzeDetail({ ...d79, collected: [c(5, 0, 33900)] }, EXAMPLE_79_BOARD)).toMatchObject({ ok: false, issue: { code: 'collectedIneligible' } })
    expect(analyzeDetail({ ...d79, collected: [c(4, 0, 34000)] }, EXAMPLE_79_BOARD)).toMatchObject({ ok: false, issue: { code: 'collectedExceedsPot' } })
    expect(analyzeDetail({ ...d79, collected: [c(4, 0, 33000)] }, EXAMPLE_79_BOARD)).toMatchObject({ ok: false, issue: { code: 'collectedSumMismatch' } })
  })

  it('GG 手牌的 collected 以原文為準（不重算），但收回者集合必須等於 4.7 的贏家', () => {
    // 以 7.9 的行動當作 GG 手牌（分單位）；抽水 44 的分配由原文決定
    const d = { ...d79, rake: 44, collected: [{ seatNo: 4, potIndex: 0, amount: 34256 }] }
    const gg = buildHand({ detail: d, board: EXAMPLE_79_BOARD, source: 'gg' })
    expect(gg).toMatchObject({ kind: 'complete', amountUnit: 'cent', heroNet: 34256 - 17100 })
    const wrongWinner = { ...gg, detail: { ...gg.detail!, collected: [{ seatNo: 6, potIndex: 0, amount: 34256 }] } }
    expect(classifyHand(wrongWinner)).toBe('simple')
  })
})
