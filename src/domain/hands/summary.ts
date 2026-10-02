// 3.8 金額單位推導、3.9 結構驗證與完整 / 簡易判定、3.1 摘要欄位推導、4.7–4.9 結算。
// 規格寫法為 summarizeHand(detail, gameType)，但公牌（board）存在 Hand 而非 HandDetail，
// 且完整判定（heroNet 是否有值）需要公牌與來源，所以本檔的函式以 Hand 的相關欄位為輸入。
import { evaluateHand } from './evaluator'
import { boardCountFor, nextStreet, replay, type ActionErrorCode, type EngineState } from './engine'
import { forcedSeats, positionsBySeat } from './positions'
import { buildPots, distributePots, netBySeat, potWinners, potsAfterRake, totalPot, type Pot } from './pots'
import type { AmountUnit, Card, Collected, Hand, HandDetail, HandGameType, HandKind, HandSource, HandSummary, Position } from './types'

/** 3.8：amountUnit 由 source 與 gameType 推導（寫入與驗證都使用此函式） */
export function deriveAmountUnit(source: HandSource, gameType: HandGameType): AmountUnit {
  if (gameType === 'tournament') return 'chip'
  return source === 'gg' ? 'cent' : 'yuan'
}

/** 3.9 結構驗證失敗的原因 */
export type HandDetailIssueCode =
  /** 行動重播不合法（附 actionIndex 與引擎的錯誤代碼） */
  | 'illegalAction'
  /** 3.3 / 4.3：籌碼必須大於要放的前注 + 盲注（或 straddle） */
  | 'stackTooSmall'
  /** 公牌張數超過已進行到的街加一條 */
  | 'boardTooLong'
  /** 某街有行動但公牌不足 */
  | 'boardTooShort'
  /** 3.3：只有進入攤牌且亮牌的對手可有手牌 */
  | 'cardsNotAllowed'
  /** 3.3：只有進入攤牌、沒有亮牌的對手可為 mucked；Hero 不可 */
  | 'muckNotAllowed'
  /** 3.2：rake ≤ 底池總額 */
  | 'rakeExceedsPot'
  /** 3.2：手牌未結束時 collected 必須為 [] */
  | 'collectedBeforeEnd'
  /** 4.8：potIndex 必須小於切出的池數 */
  | 'collectedInvalidPot'
  /** 3.5 / 4.8：seatNo 必須是該池的資格者 */
  | 'collectedIneligible'
  /** 4.8：同一池的 collected 合計不得超過該池扣除抽水後的金額 */
  | 'collectedExceedsPot'
  /** 3.5：Σ amount = 底池總額 − rake */
  | 'collectedSumMismatch'

export interface HandDetailIssue {
  code: HandDetailIssueCode
  /** illegalAction：第幾個行動（0 起算） */
  actionIndex?: number
  actionError?: ActionErrorCode
  /** 有問題的座位（stackTooSmall、cardsNotAllowed、muckNotAllowed、collected*） */
  seatNo?: number
}

/** 重播並通過結構驗證後的分析結果 */
export interface DetailAnalysis {
  state: EngineState
  pots: Pot[]
  totalPot: number
  /** 進入攤牌的座位（未棄牌者）；未進入攤牌時為 [] */
  showdownSeats: number[]
  positions: Map<number, Position>
}

export type AnalyzeResult = { ok: true; analysis: DetailAnalysis } | { ok: false; issue: HandDetailIssue }

/**
 * 公牌張數的允許範圍（3.9）：
 * - 下限：最後一筆行動所在街的張數（翻牌有行動時必須已有 3 張，轉牌、河牌同理）
 * - 上限：已結束回合的最後一條街「加一條」（翻前下注結束時可先輸入翻牌）；自動發完時可直接到 5 張
 */
export function boardLimits(detail: Pick<HandDetail, 'actions'>, state: EngineState): { min: number; max: number } {
  const last = detail.actions[detail.actions.length - 1]
  const min = last ? boardCountFor(last.street) : 0
  if (state.runout) return { min, max: 5 }
  const lastDone = state.completedStreets[state.completedStreets.length - 1]
  if (lastDone === undefined) return { min, max: 0 }
  const next = nextStreet(lastDone)
  return { min, max: next === null ? 5 : boardCountFor(next) }
}

/** 3.9 結構驗證：3.2–3.5 需重播才能判斷的規則、行動依 4.2–4.4 重播合法、公牌張數（欄位規則由 handSchema 檢查） */
export function analyzeDetail(detail: HandDetail, board: readonly Card[]): AnalyzeResult {
  const fail = (issue: HandDetailIssue): AnalyzeResult => ({ ok: false, issue })
  const seatNos = detail.seats.map((s) => s.seatNo)

  // 3.3 / 4.3 籌碼限制：stack 必須大於發牌前要放的前注 + 盲注（或 straddle）
  const forced = forcedSeats(seatNos, detail.buttonSeat, detail.straddle > 0)
  for (const s of detail.seats) {
    const blind =
      s.seatNo === forced.sbSeat ? detail.sb : s.seatNo === forced.bbSeat ? detail.bb : s.seatNo === forced.straddleSeat ? detail.straddle : 0
    if (s.stack <= detail.ante + blind) return fail({ code: 'stackTooSmall', seatNo: s.seatNo })
  }

  const r = replay(detail)
  if (!r.ok) return fail({ code: 'illegalAction', actionIndex: r.actionIndex, actionError: r.code })
  const state = r.state

  const { min, max } = boardLimits(detail, state)
  if (board.length > max) return fail({ code: 'boardTooLong' })
  if (board.length < min) return fail({ code: 'boardTooShort' })

  const showdownSeats = state.status === 'showdown' ? state.players.filter((p) => !p.folded).map((p) => p.seatNo) : []
  for (const s of detail.seats) {
    const isHero = s.seatNo === detail.heroSeat
    const inShowdown = showdownSeats.includes(s.seatNo)
    if (s.mucked && (isHero || !inShowdown || s.cards.length > 0)) return fail({ code: 'muckNotAllowed', seatNo: s.seatNo })
    if (!isHero && s.cards.length > 0 && !inShowdown) return fail({ code: 'cardsNotAllowed', seatNo: s.seatNo })
  }

  const pot = totalPot(state.players)
  if (detail.rake > pot) return fail({ code: 'rakeExceedsPot' })
  const pots = buildPots(state.players)

  if (detail.collected.length > 0) {
    if (state.status === 'betting') return fail({ code: 'collectedBeforeEnd' })
    const after = potsAfterRake(pots, detail.rake)
    const perPot = new Map<number, number>()
    for (const c of detail.collected) {
      const p = pots[c.potIndex]
      if (!p) return fail({ code: 'collectedInvalidPot', seatNo: c.seatNo })
      if (!p.eligible.includes(c.seatNo)) return fail({ code: 'collectedIneligible', seatNo: c.seatNo })
      perPot.set(c.potIndex, (perPot.get(c.potIndex) ?? 0) + c.amount)
    }
    for (const [i, sum] of perPot) if (sum > after[i]!) return fail({ code: 'collectedExceedsPot' })
    const sum = detail.collected.reduce((s, c) => s + c.amount, 0)
    if (sum !== pot - detail.rake) return fail({ code: 'collectedSumMismatch' })
  }

  return { ok: true, analysis: { state, pots, totalPot: pot, showdownSeats, positions: positionsBySeat(seatNos, detail.buttonSeat) } }
}

/**
 * 4.7 每個池的贏家。手牌因棄牌結束時，唯一的池給剩下的那位玩家。
 * 攤牌時：亮牌者與 Hero 依 4.10 牌力比較；蓋牌或沒有手牌者不參與；公牌不足 5 張時無法判定（回傳 null）。
 * 某個池的資格者都沒有手牌時，該池為 null。
 */
export function determineWinners(detail: HandDetail, board: readonly Card[], analysis: DetailAnalysis): (number[] | null)[] | null {
  const { state, pots } = analysis
  if (state.status === 'betting') return null
  if (state.status === 'foldEnded') return pots.map((p) => [...p.eligible])
  if (board.length !== 5) return null
  const strength = new Map<number, number>()
  for (const s of detail.seats) {
    if (!analysis.showdownSeats.includes(s.seatNo) || s.mucked || s.cards.length !== 2) continue
    strength.set(s.seatNo, evaluateHand(s.cards, board).score)
  }
  return potWinners(pots, (seat) => strength.get(seat) ?? null)
}

/** 4.7 攤牌資料是否齊全：每位攤牌對手亮牌（2 張）或蓋牌、Hero 有手牌、公牌 5 張、每個池至少一位有資格者有手牌 */
export function isShowdownComplete(detail: HandDetail, board: readonly Card[], analysis: DetailAnalysis): boolean {
  if (analysis.state.status !== 'showdown') return true
  if (board.length !== 5) return false
  for (const seat of analysis.showdownSeats) {
    const s = detail.seats.find((x) => x.seatNo === seat)!
    if (seat === detail.heroSeat ? s.cards.length !== 2 : s.cards.length !== 2 && !s.mucked) return false
  }
  const winners = determineWinners(detail, board, analysis)
  return winners !== null && winners.every((w) => w !== null)
}

/**
 * 4.7、4.8：手動紀錄的 collected（依牌力分配、抽水從主池扣、平分餘數依按鈕順時針下一位起）。
 * 手牌未結束、或攤牌資料不齊全時回傳 null。
 */
export function computeCollected(detail: HandDetail, board: readonly Card[], analysis?: DetailAnalysis): Collected[] | null {
  const a = analysis ?? analyzeOrNull({ ...detail, collected: [] }, board)
  if (!a || a.state.status === 'betting' || !isShowdownComplete(detail, board, a)) return null
  const winners = determineWinners(detail, board, a)
  if (!winners || winners.some((w) => w === null)) return null
  return distributePots(a.pots, detail.rake, winners as number[][], detail.seats.map((s) => s.seatNo), detail.buttonSeat)
}

function analyzeOrNull(detail: HandDetail, board: readonly Card[]): DetailAnalysis | null {
  const r = analyzeDetail(detail, board)
  return r.ok ? r.analysis : null
}

const sameCollected = (a: readonly Collected[], b: readonly Collected[]) =>
  a.length === b.length && a.every((x, i) => x.seatNo === b[i]!.seatNo && x.potIndex === b[i]!.potIndex && x.amount === b[i]!.amount)

/**
 * 3.9 第 6 點「collected 符合 3.5 與 4.8」：
 * - 手動紀錄：必須等於 4.7、4.8 的計算結果
 * - GG 匯入：以原文金額為準不重算（4.8），但每個扣除抽水後金額 > 0 的池，收回者集合必須等於 4.7 的贏家集合
 *   （3.5 的資格、合計等規則已在結構驗證檢查）
 */
function collectedValid(hand: Pick<Hand, 'source' | 'board'>, detail: HandDetail, analysis: DetailAnalysis): boolean {
  if (hand.source === 'manual') {
    const expected = computeCollected(detail, hand.board, analysis)
    return expected !== null && sameCollected(detail.collected, expected)
  }
  const winners = determineWinners(detail, hand.board, analysis)
  if (!winners) return false
  const sum = detail.collected.reduce((s, c) => s + c.amount, 0)
  if (sum !== analysis.totalPot - detail.rake) return false
  const after = potsAfterRake(analysis.pots, detail.rake)
  return after.every((amount, i) => {
    const seats = detail.collected.filter((c) => c.potIndex === i).map((c) => c.seatNo).sort((x, y) => x - y)
    if (amount === 0) return seats.length === 0
    const w = winners[i]
    return w !== null && w !== undefined && [...w].sort((x, y) => x - y).join(',') === seats.join(',')
  })
}

type ClassifyInput = Pick<Hand, 'detail' | 'board' | 'source'>

/** 3.9 是否符合完整手牌的 2–6 點（detail 已通過結構驗證） */
function isComplete(hand: ClassifyInput, detail: HandDetail, analysis: DetailAnalysis): boolean {
  const hero = detail.seats.find((s) => s.seatNo === detail.heroSeat)!
  if (hero.cards.length !== 2) return false
  const { state } = analysis
  if (state.status === 'betting') return false
  const expectedBoard = state.status === 'foldEnded' ? boardCountFor(state.street) : 5
  if (hand.board.length !== expectedBoard) return false
  if (!isShowdownComplete(detail, hand.board, analysis)) return false
  return collectedValid(hand, detail, analysis)
}

/** 3.9 classifyHand：完整或簡易。detail 未通過結構驗證時為 simple（儲存與匯入時另以 verifyHand 拒絕） */
export function classifyHand(hand: ClassifyInput): HandKind {
  if (hand.detail === null) return 'simple'
  const r = analyzeDetail(hand.detail, hand.board)
  if (!r.ok) return 'simple'
  return isComplete(hand, hand.detail, r.analysis) ? 'complete' : 'simple'
}

/** 4.9 有效籌碼 = min(Hero 起始籌碼, 其他玩家起始籌碼的最大值) */
export function effectiveStack(detail: Pick<HandDetail, 'seats' | 'heroSeat'>): number {
  const hero = detail.seats.find((s) => s.seatNo === detail.heroSeat)!
  const others = detail.seats.filter((s) => s.seatNo !== detail.heroSeat).map((s) => s.stack)
  return Math.min(hero.stack, Math.max(...others))
}

/** 4.9 每位玩家的淨輸贏（座位 → net）；detail 未通過結構驗證時回傳 null */
export function netResults(detail: HandDetail, board: readonly Card[]): Map<number, number> | null {
  const r = analyzeDetail(detail, board)
  return r.ok ? netBySeat(r.analysis.state.players, detail.collected) : null
}

/**
 * 3.1 摘要欄位推導（detail 不為 null 時）：bb = detail.bb、heroCards = Hero 座位的牌、heroPosition 依 3.7 計算、
 * heroNet 只有完整手牌才有值（4.9），否則為 null。detail 未通過結構驗證時 heroNet 為 null。
 */
export function summarizeHand(hand: Pick<Hand, 'source' | 'board'> & { detail: HandDetail }): HandSummary {
  const { detail } = hand
  const hero = detail.seats.find((s) => s.seatNo === detail.heroSeat)
  const seatNos = detail.seats.map((s) => s.seatNo)
  const heroPosition = positionsBySeat(seatNos, detail.buttonSeat).get(detail.heroSeat) ?? null
  const r = analyzeDetail(detail, hand.board)
  let heroNet: number | null = null
  if (r.ok && isComplete(hand, detail, r.analysis)) {
    heroNet = netBySeat(r.analysis.state.players, detail.collected).get(detail.heroSeat) ?? null
  }
  return { bb: detail.bb, heroCards: [...(hero?.cards ?? [])], heroPosition, heroNet }
}

/** 由使用者輸入（或匯入）組成手牌時的內容；kind、amountUnit 與（有 detail 時）摘要欄位由系統推導 */
export type HandContent = Omit<Hand, 'id' | 'exportSeq' | 'kind' | 'amountUnit' | 'createdAt' | 'updatedAt'>
export type FinalizedHandContent = Omit<Hand, 'id' | 'exportSeq' | 'createdAt' | 'updatedAt'>

/**
 * 寫入前推導系統欄位：amountUnit（3.8）、手動紀錄的 collected（4.7、4.8；未完成時為 []）、
 * kind（3.9）與摘要欄位（3.1）。結果仍需以 handSchema 與 verifyHand 驗證。
 */
export function finalizeHandContent(content: HandContent): FinalizedHandContent {
  const amountUnit = deriveAmountUnit(content.source, content.gameType)
  if (content.detail === null) return { ...content, amountUnit, kind: 'simple' }
  let detail = content.detail
  if (content.source === 'manual') {
    detail = { ...detail, collected: computeCollected({ ...detail, collected: [] }, content.board) ?? [] }
  }
  const kind = classifyHand({ ...content, detail })
  if (kind === 'simple') detail = { ...detail, collected: [] }
  const summary = summarizeHand({ ...content, detail })
  return { ...content, ...summary, detail, amountUnit, kind }
}

/** verifyHand 的失敗原因（handSchema 通過之後的檢查） */
export type HandVerifyError =
  | { code: 'invalidDetail'; issue: HandDetailIssue }
  | { code: 'kindMismatch'; expected: HandKind }
  | { code: 'summaryMismatch'; field: keyof HandSummary }
  /** 3.9：簡易手牌（未完成的完整紀錄）的 collected 必須為 [] */
  | { code: 'collectedMustBeEmpty' }

export type HandVerifyResult = { ok: true; kind: HandKind } | { ok: false; error: HandVerifyError }

const sameCards = (a: readonly Card[], b: readonly Card[]) => a.length === b.length && a.every((c, i) => c === b[i])

/**
 * 儲存與匯入時的完整檢查（10.2 第 2 步）：detail 通過 3.9 結構驗證、kind 與 3.9 判定一致、
 * 摘要欄位與推導一致、簡易手牌的 collected 為 []。呼叫前必須已通過 handSchema。
 */
export function verifyHand(hand: Hand): HandVerifyResult {
  const fail = (error: HandVerifyError): HandVerifyResult => ({ ok: false, error })
  const detail = hand.detail
  if (detail === null) {
    return hand.kind === 'simple' ? { ok: true, kind: 'simple' } : fail({ code: 'kindMismatch', expected: 'simple' })
  }
  const r = analyzeDetail(detail, hand.board)
  if (!r.ok) return fail({ code: 'invalidDetail', issue: r.issue })
  const kind: HandKind = isComplete(hand, detail, r.analysis) ? 'complete' : 'simple'
  if (hand.kind !== kind) return fail({ code: 'kindMismatch', expected: kind })
  if (kind === 'simple' && detail.collected.length > 0) return fail({ code: 'collectedMustBeEmpty' })
  const s = summarizeHand({ ...hand, detail })
  if (hand.bb !== s.bb) return fail({ code: 'summaryMismatch', field: 'bb' })
  if (!sameCards(hand.heroCards, s.heroCards)) return fail({ code: 'summaryMismatch', field: 'heroCards' })
  if (hand.heroPosition !== s.heroPosition) return fail({ code: 'summaryMismatch', field: 'heroPosition' })
  if (hand.heroNet !== s.heroNet) return fail({ code: 'summaryMismatch', field: 'heroNet' })
  return { ok: true, kind }
}
