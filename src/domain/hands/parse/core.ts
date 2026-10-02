// SPEC-v2-hands 第 9 節：PokerStars 與 GG 解析器共用的核心（拆手、牌面解析、以 4.2–4.8 重播驗證）。
// 方言（parse/pokerstars.ts、H4 的 parse/gg.ts）負責以白名單逐行比對各自的寫法，把每一行轉成本檔的 RawHand；
// 本檔不認得任何方言的文字格式，只驗證 RawHand 的內容與 4.2–4.8 的重播結果完全一致，任何不一致即拒絕，不得猜測。
import { CARD_RE, findDuplicateCard } from '../cards'
import { applyAction, boardCountFor, legalActions, startHand, type EngineState } from '../engine'
import { forcedSeats } from '../positions'
import { potsAfterRake } from '../pots'
import { SEAT_NAME_RE, VILLAIN_NAME_RE, handDetailSchema } from '../schemas'
import { analyzeDetail, classifyHand, summarizeHand } from '../summary'
import type {
  Action,
  ActionType,
  AmountUnit,
  Card,
  Collected,
  HandDetail,
  HandGameType,
  HandSource,
  Position,
  Seat,
  Street,
} from '../types'

// ---------------------------------------------------------------------------
// 錯誤
// ---------------------------------------------------------------------------

/**
 * 解析失敗的原因（畫面文字由呼叫端依代碼對應字串檔；H4 匯入頁使用 8.5 的文字）：
 * - unrecognizedLine：白名單不符（「無法辨識的內容：第 N 行」）
 * - illegalAction：重播不合法、跟注 / 加注金額或全下標記與重播不符（「行動不合法：第 N 行」）
 * - unknownPlayer / duplicatePlayer：名稱不在座位行 / 座位行名稱重複
 * - noHero：無法判定你的座位（帶牌的發牌行不是恰好 1 行）
 * - blindMismatch：前注、盲注、straddle 與 4.1 推導的座位或標頭金額不符
 * - refundMismatch：未跟注退回與 4.5 計算不符
 * - potMismatch：底池總額、各池金額或收回合計與 4.6、4.8 計算不符（「底池金額對不上」）
 * - collectedMismatch：收回的池別或資格不符
 * - boardMismatch：公牌與各街、摘要不一致，或出現不應出現的街
 * - cardMismatch：亮牌與發牌不一致、同一位玩家重複亮牌或蓋牌
 * - duplicateCard：同一張牌重複出現
 * - incomplete：手牌內容不完整（未結束、缺少攤牌資料等，3.9）
 * - invalidDetail：3.2–3.5 的欄位規則不符（人數、座位號、金額上限等）
 * - unsupportedTableSize：不支援的牌桌人數
 * - amountFormatMismatch：同一手金額格式不一致（PokerStars 方言的金額單位還原，第 9 節）
 * - contentMismatch：與依解析結果重算的文字不一致（PokerStars 方言的最終檢查）
 */
export type ParseErrorCode =
  | 'unrecognizedLine'
  | 'illegalAction'
  | 'unknownPlayer'
  | 'duplicatePlayer'
  | 'noHero'
  | 'blindMismatch'
  | 'refundMismatch'
  | 'potMismatch'
  | 'collectedMismatch'
  | 'boardMismatch'
  | 'cardMismatch'
  | 'duplicateCard'
  | 'incomplete'
  | 'invalidDetail'
  | 'unsupportedTableSize'
  | 'amountFormatMismatch'
  | 'contentMismatch'

export interface ParseIssue {
  code: ParseErrorCode
  /** 該手內的行號（1 起算）；與特定行無關時為 null */
  line: number | null
}

export type ParseStep<T> = { ok: true; value: T } | { ok: false; error: ParseIssue }

export const parseFail = (code: ParseErrorCode, line: number | null): { ok: false; error: ParseIssue } => ({
  ok: false,
  error: { code, line },
})

// ---------------------------------------------------------------------------
// 文字前處理與拆手
// ---------------------------------------------------------------------------

/** 8.1：去除開頭 BOM；換行 `\r\n`、`\r` 一律正規化為 `\n` */
export function normalizeText(text: string): string {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n')
}

export interface HandChunk {
  /** 這手第一行在檔案中的行號（1 起算） */
  startLine: number
  /** 這手的各行（已去除尾端空行） */
  lines: string[]
}

export interface SplitResult {
  /** 第一手之前的非空白行（行號、內容）；方言決定忽略或報錯 */
  leading: { line: number; text: string }[]
  hands: HandChunk[]
}

/** 以 isStart 判斷每手的開頭行，到下一手開頭或檔案結尾為止；去除每手前後的空行 */
export function splitHands(text: string, isStart: (line: string) => boolean): SplitResult {
  const lines = normalizeText(text).split('\n')
  const leading: SplitResult['leading'] = []
  const hands: HandChunk[] = []
  let current: HandChunk | null = null
  lines.forEach((line, i) => {
    if (isStart(line)) {
      current = { startLine: i + 1, lines: [line] }
      hands.push(current)
    } else if (current) current.lines.push(line)
    else if (line.trim() !== '') leading.push({ line: i + 1, text: line })
  })
  for (const h of hands) while (h.lines.length > 1 && h.lines[h.lines.length - 1]!.trim() === '') h.lines.pop()
  return { leading, hands }
}

/** 牌面清單（以單一空格分隔），任何一張不符合 3.6 編碼即回傳 null（HQ29：只接受 `T`） */
export function parseCards(text: string): Card[] | null {
  const cards = text.split(' ')
  return cards.every((c) => CARD_RE.test(c)) ? cards : null
}

/** 7.5 的反向：`YYYY/MM/DD HH:mm:ss` → `YYYY-MM-DDTHH:mm:ss`，不換算時區 */
export function playedAtFromHeader(date: string, time: string): string {
  return `${date.replaceAll('/', '-')}T${time}`
}

/** 7.3 Seat.name 寫入條件：Hero 一律 null；符合 `^[A-Za-z0-9_]{1,20}$` 且不是 Villain 加數字時存原名，否則 null */
export function seatNameFor(name: string, isHero: boolean): string | null {
  if (isHero) return null
  return SEAT_NAME_RE.test(name) && !VILLAIN_NAME_RE.test(name) ? name : null
}

// ---------------------------------------------------------------------------
// 方言無關的中間結構
// ---------------------------------------------------------------------------

export interface RawSeat {
  seatNo: number
  name: string
  stack: number
  line: number
}

export interface RawPost {
  name: string
  amount: number
  line: number
}

export type RawEvent =
  | {
      kind: 'action'
      name: string
      type: ActionType
      /** calls X 的 X；raises X to Y 的 X（增量）；其餘為 null */
      amount: number | null
      /** bets X 的 X；raises X to Y 的 Y；其餘為 null */
      to: number | null
      allIn: boolean
      line: number
    }
  | {
      kind: 'street'
      street: Exclude<Street, 'preflop'>
      /** 到這條街為止的全部公牌（行內前段 + 新發的牌） */
      cards: Card[]
      line: number
    }
  | { kind: 'uncalled'; name: string; amount: number; line: number }

/** 收回的池別：單一池 pot、主池 main、只有 1 個邊池時 side、2 個以上邊池時的第 n 個邊池（1 起算） */
export type RawPotLabel = 'pot' | 'main' | 'side' | number

export interface RawCollect {
  name: string
  amount: number
  pot: RawPotLabel
  line: number
}

export interface RawHand {
  gameType: HandGameType
  playedAt: string
  /** 標頭的盲注 */
  sb: number
  bb: number
  tableSize: number
  buttonSeat: number
  /** 標頭行號（盲注與標頭不符時回報） */
  headerLine: number
  /** 牌桌行行號 */
  tableLine: number
  seats: RawSeat[]
  antes: RawPost[]
  smallBlind: RawPost | null
  bigBlind: RawPost | null
  straddle: RawPost | null
  hero: { name: string; cards: Card[]; line: number } | null
  events: RawEvent[]
  /** 攤牌標記的行號；沒有時為 null */
  showdownLine: number | null
  shows: { name: string; cards: Card[]; line: number }[]
  mucks: { name: string; line: number }[]
  collects: RawCollect[]
  /** 摘要的底池行：pots 為多池寫法中各池（扣抽水後）的金額，單一池寫法為 null */
  summary: { totalPot: number; rake: number; pots: number[] | null; line: number } | null
  boardSummary: { cards: Card[]; line: number } | null
  /** 最後一行之後的行號（缺少內容時回報） */
  endLine: number
}

export interface AssembleOptions {
  source: HandSource
  amountUnit: AmountUnit
  /** strict：有攤牌時必須有攤牌標記、沒有攤牌時不得有；optional：可有可無（GG，8.3 需驗證） */
  showdownMarker: 'strict' | 'optional'
}

/** 解析成功的一手（與往返測試比對的欄位，第 9 節） */
export interface AssembledHand {
  source: HandSource
  gameType: HandGameType
  amountUnit: AmountUnit
  playedAt: string
  bb: number
  detail: HandDetail
  board: Card[]
  heroCards: Card[]
  heroPosition: Position | null
  heroNet: number | null
  /** 原文中 Hero 的名稱 */
  heroName: string
}

// ---------------------------------------------------------------------------
// 組合與重播驗證（4.2–4.8）
// ---------------------------------------------------------------------------

/**
 * 把方言解析出的 RawHand 組成 HandDetail，並以 4.2–4.8 重播驗證每一個主張（跟注金額、加注增量、全下標記、
 * 未跟注退回、各街公牌、底池、收回、抽水）；任何不一致即拒絕並回報行號。
 */
export function assembleHand(raw: RawHand, options: AssembleOptions): ParseStep<AssembledHand> {
  const fail = parseFail

  // ---- 牌桌與座位 ----
  if (raw.tableSize < 2 || raw.tableSize > 10) return fail('unsupportedTableSize', raw.tableLine)
  if (raw.seats.length < 2 || raw.seats.length > raw.tableSize) return fail('unsupportedTableSize', raw.tableLine)
  const seatByName = new Map<string, number>()
  const lowerNames = new Set<string>()
  let prevSeatNo = 0
  for (const s of raw.seats) {
    if (s.seatNo <= prevSeatNo || s.seatNo > raw.tableSize) return fail('invalidDetail', s.line)
    prevSeatNo = s.seatNo
    if (lowerNames.has(s.name.toLowerCase())) return fail('duplicatePlayer', s.line)
    lowerNames.add(s.name.toLowerCase())
    seatByName.set(s.name, s.seatNo)
  }
  const seatNos = raw.seats.map((s) => s.seatNo)
  if (!seatNos.includes(raw.buttonSeat)) return fail('invalidDetail', raw.tableLine)
  const seatOf = (name: string, line: number): ParseStep<number> => {
    const n = seatByName.get(name)
    return n === undefined ? fail('unknownPlayer', line) : { ok: true, value: n }
  }

  // ---- Hero ----
  if (!raw.hero) return fail('noHero', raw.endLine)
  const heroSeatR = seatOf(raw.hero.name, raw.hero.line)
  if (!heroSeatR.ok) return heroSeatR
  const heroSeat = heroSeatR.value

  // ---- 前注、盲注、straddle（4.1、4.2） ----
  const forced = forcedSeats(seatNos, raw.buttonSeat, raw.straddle !== null)
  const checkPost = (post: RawPost | null, seat: number | null, amount: number): ParseIssue | null => {
    if (!post) return { code: 'blindMismatch', line: raw.endLine }
    const r = seatOf(post.name, post.line)
    if (!r.ok) return r.error
    if (r.value !== seat || post.amount !== amount) return { code: 'blindMismatch', line: post.line }
    return null
  }
  const sbIssue = checkPost(raw.smallBlind, forced.sbSeat, raw.sb)
  if (sbIssue) return { ok: false, error: sbIssue }
  const bbIssue = checkPost(raw.bigBlind, forced.bbSeat, raw.bb)
  if (bbIssue) return { ok: false, error: bbIssue }
  let straddle = 0
  if (raw.straddle) {
    const issue = checkPost(raw.straddle, forced.straddleSeat, 2 * raw.bb)
    if (issue) return { ok: false, error: issue }
    straddle = raw.straddle.amount
  }
  let ante = 0
  if (raw.antes.length > 0) {
    ante = raw.antes[0]!.amount
    const posted = new Set<number>()
    for (const a of raw.antes) {
      const r = seatOf(a.name, a.line)
      if (!r.ok) return r
      if (a.amount !== ante || ante <= 0 || posted.has(r.value)) return fail('blindMismatch', a.line)
      posted.add(r.value)
    }
    if (posted.size !== seatNos.length) return fail('blindMismatch', raw.antes[raw.antes.length - 1]!.line)
  }

  // ---- 攤牌亮牌與蓋牌 ----
  const cardsBySeat = new Map<number, Card[]>([[heroSeat, raw.hero.cards]])
  const mucked = new Set<number>()
  const revealed = new Set<number>()
  for (const s of raw.shows) {
    const r = seatOf(s.name, s.line)
    if (!r.ok) return r
    if (revealed.has(r.value)) return fail('cardMismatch', s.line)
    revealed.add(r.value)
    if (r.value === heroSeat) {
      if (s.cards.join(' ') !== raw.hero.cards.join(' ')) return fail('cardMismatch', s.line)
    } else cardsBySeat.set(r.value, s.cards)
  }
  for (const m of raw.mucks) {
    const r = seatOf(m.name, m.line)
    if (!r.ok) return r
    if (revealed.has(r.value) || r.value === heroSeat) return fail('cardMismatch', m.line)
    revealed.add(r.value)
    mucked.add(r.value)
  }

  const seats: Seat[] = raw.seats.map((s) => ({
    seatNo: s.seatNo,
    stack: s.stack,
    cards: [...(cardsBySeat.get(s.seatNo) ?? [])],
    mucked: mucked.has(s.seatNo),
    name: seatNameFor(s.name, s.seatNo === heroSeat),
  }))

  // 4.3 籌碼限制：stack 必須大於發牌前要放的前注 + 盲注（或 straddle）
  for (const s of raw.seats) {
    const blind = s.seatNo === forced.sbSeat ? raw.sb : s.seatNo === forced.bbSeat ? raw.bb : s.seatNo === forced.straddleSeat ? straddle : 0
    if (s.stack <= ante + blind) return fail('blindMismatch', s.line)
  }

  // ---- 行動重播（4.2–4.5） ----
  const actions: Action[] = []
  let state: EngineState = startHand({ seats, buttonSeat: raw.buttonSeat, sb: raw.sb, bb: raw.bb, ante, straddle })
  let printedStreet: Street = 'preflop'
  let board: Card[] = []
  let pendingRefunds: { seatNo: number; amount: number }[] = []
  for (const ev of raw.events) {
    if (pendingRefunds.length > 0 && ev.kind !== 'uncalled') return fail('refundMismatch', ev.line)
    if (ev.kind === 'uncalled') {
      const expected = pendingRefunds.shift()
      const r = seatOf(ev.name, ev.line)
      if (!r.ok) return r
      if (!expected || expected.seatNo !== r.value || expected.amount !== ev.amount) return fail('refundMismatch', ev.line)
      continue
    }
    if (ev.kind === 'street') {
      const order: Street[] = ['preflop', 'flop', 'turn', 'river']
      if (order.indexOf(ev.street) !== order.indexOf(printedStreet) + 1) return fail('boardMismatch', ev.line)
      const reachable = state.status === 'betting' ? state.street === ev.street : state.status === 'showdown' && state.runout
      if (!reachable) return fail('boardMismatch', ev.line)
      if (ev.cards.length !== boardCountFor(ev.street) || board.some((c, i) => ev.cards[i] !== c)) return fail('boardMismatch', ev.line)
      board = [...ev.cards]
      printedStreet = ev.street
      continue
    }
    // 行動：必須輪到該座位、街與目前公牌相符，金額與全下標記與重播一致
    const seatR = seatOf(ev.name, ev.line)
    if (!seatR.ok) return seatR
    const legal = legalActions(state)
    if (!legal || state.street !== printedStreet || legal.seatNo !== seatR.value) return fail('illegalAction', ev.line)
    if (ev.type === 'call' && ev.amount !== legal.callAmount) return fail('illegalAction', ev.line)
    if (ev.type === 'raise' && (ev.to === null || ev.amount !== ev.to - state.currentBet)) return fail('illegalAction', ev.line)
    const action: Action = { street: state.street, seatNo: seatR.value, type: ev.type, to: ev.type === 'bet' || ev.type === 'raise' ? ev.to : null }
    const r = applyAction(state, action)
    if (!r.ok) return fail('illegalAction', ev.line)
    const newRefunds = r.state.refunds.slice(state.refunds.length)
    if (ev.type !== 'fold' && ev.type !== 'check') {
      const after = r.state.players.find((p) => p.seatNo === action.seatNo)!
      const refunded = newRefunds.filter((x) => x.seatNo === action.seatNo).reduce((s, x) => s + x.amount, 0)
      if ((after.stack - refunded === 0) !== ev.allIn) return fail('illegalAction', ev.line)
    } else if (ev.allIn) return fail('illegalAction', ev.line)
    pendingRefunds = newRefunds.map((x) => ({ seatNo: x.seatNo, amount: x.amount }))
    actions.push(action)
    state = r.state
  }
  if (pendingRefunds.length > 0) return fail('refundMismatch', raw.collects[0]?.line ?? raw.showdownLine ?? raw.summary?.line ?? raw.endLine)
  if (state.status === 'betting') return fail('incomplete', raw.endLine)
  const isShowdown = state.status === 'showdown'
  if (isShowdown && printedStreet !== 'river') return fail('boardMismatch', raw.showdownLine ?? raw.endLine)
  if (options.showdownMarker === 'strict' && isShowdown !== (raw.showdownLine !== null)) {
    return fail(isShowdown ? 'incomplete' : 'unrecognizedLine', raw.showdownLine ?? raw.endLine)
  }

  // ---- 牌不重複（3.6） ----
  if (findDuplicateCard([...raw.hero.cards, ...board, ...seats.filter((s) => s.seatNo !== heroSeat).flatMap((s) => s.cards)]) !== null) {
    return fail('duplicateCard', raw.hero.line)
  }

  // ---- 底池與收回（4.6–4.8） ----
  if (!raw.summary) return fail('incomplete', raw.endLine)
  const rake = raw.summary.rake
  if (options.amountUnit === 'chip' && rake !== 0) return fail('invalidDetail', raw.summary.line)
  const base: HandDetail = {
    tableSize: raw.tableSize,
    buttonSeat: raw.buttonSeat,
    heroSeat,
    sb: raw.sb,
    bb: raw.bb,
    ante,
    straddle,
    seats,
    actions,
    rake: 0,
    collected: [],
  }
  const pre = analyzeDetail(base, board)
  if (!pre.ok) return fail(pre.issue.code === 'illegalAction' ? 'illegalAction' : 'invalidDetail', null)
  const { pots, totalPot } = pre.analysis
  if (raw.summary.totalPot !== totalPot) return fail('potMismatch', raw.summary.line)
  if (rake > totalPot) return fail('potMismatch', raw.summary.line)
  const afterRake = potsAfterRake(pots, rake)
  if (raw.summary.pots === null ? pots.length !== 1 : raw.summary.pots.length !== pots.length || raw.summary.pots.some((p, i) => p !== afterRake[i])) {
    return fail('potMismatch', raw.summary.line)
  }

  const collected: Collected[] = []
  for (const c of raw.collects) {
    const r = seatOf(c.name, c.line)
    if (!r.ok) return r
    let potIndex: number
    if (c.pot === 'pot') potIndex = pots.length === 1 ? 0 : -1
    else if (c.pot === 'main') potIndex = pots.length > 1 ? 0 : -1
    else if (c.pot === 'side') potIndex = pots.length === 2 ? 1 : -1
    else potIndex = pots.length > 2 && c.pot >= 1 && c.pot < pots.length ? c.pot : -1
    if (potIndex < 0) return fail('collectedMismatch', c.line)
    if (collected.some((x) => x.seatNo === r.value && x.potIndex === potIndex)) return fail('collectedMismatch', c.line)
    if (c.amount <= 0) return fail('collectedMismatch', c.line)
    collected.push({ seatNo: r.value, potIndex, amount: c.amount })
  }
  collected.sort((a, b) => a.potIndex - b.potIndex || a.seatNo - b.seatNo)
  const sum = collected.reduce((s, c) => s + c.amount, 0)
  if (sum + rake !== totalPot) return fail('potMismatch', raw.summary.line)

  const detail: HandDetail = { ...base, rake, collected }
  const full = analyzeDetail(detail, board)
  if (!full.ok) {
    const code = full.issue.code
    return fail(code.startsWith('collected') ? 'collectedMismatch' : 'invalidDetail', null)
  }

  // ---- 公牌摘要 ----
  if (board.length > 0 ? raw.boardSummary?.cards.join(' ') !== board.join(' ') : raw.boardSummary !== null) {
    return fail('boardMismatch', raw.boardSummary?.line ?? raw.summary.line)
  }

  // ---- 3.2–3.5 欄位規則、3.9 完整判定、摘要推導 ----
  if (!handDetailSchema.safeParse(detail).success) return fail('invalidDetail', null)
  const hand = { source: options.source, board, detail }
  if (classifyHand(hand) !== 'complete') return fail('incomplete', null)
  const summary = summarizeHand(hand)
  return {
    ok: true,
    value: {
      source: options.source,
      gameType: raw.gameType,
      amountUnit: options.amountUnit,
      playedAt: raw.playedAt,
      bb: raw.bb,
      detail,
      board,
      heroCards: summary.heroCards,
      heroPosition: summary.heroPosition,
      heroNet: summary.heroNet,
      heroName: raw.hero.name,
    },
  }
}
