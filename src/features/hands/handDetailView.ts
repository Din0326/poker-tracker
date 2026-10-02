// SPEC-v2-hands 6.2 手牌詳情的顯示資料（純函式，不含 React 與 DB）。
// 底池、邊池、退回、贏家、淨輸贏、有效籌碼、牌型一律由 domain/hands 推導（0.1），這裡只負責組合畫面文字。
import { STREETS } from '../../domain/hands/types'
import {
  analyzeDetail,
  boardCountFor,
  describeActions,
  describeHandValueText,
  determineWinners,
  effectiveStack,
  evaluateHand,
  forcedSeats,
  formatHandAmount,
  formatHandBb,
  formatSignedHandAmount,
  formatStackBb,
  netResults,
  positionText,
  type ActionType,
  type AmountUnit,
  type Card,
  type Hand,
  type HandDetail,
  type Position,
  type Street,
} from '../../domain/hands'
import { strings } from '../../strings'
import { handBlindsText } from './handListModel'

const t = strings.hands
const d = t.detail

/** 行動的動作文字「加注到 $500」「跟注 $300」「加注到 $15,900 全下」（5.3 行動紀錄與 6.2 共用寫法） */
export function actionPhrase(type: ActionType, amount: number | null, allIn: boolean, unit: AmountUnit): string {
  const money = amount === null ? '' : formatHandAmount(amount, unit)
  const base =
    type === 'fold' ? t.log.fold : type === 'check' ? t.log.check : type === 'call' ? t.log.call(money) : type === 'bet' ? t.log.bet(money) : t.log.raise(money)
  return allIn ? `${base} ${t.log.allIn}` : base
}

/** 行動者「UTG（1）」；Hero 為「你 BTN（4）」 */
export function detailActorLabeler(detail: Pick<HandDetail, 'seats' | 'buttonSeat' | 'heroSeat'>, positions: ReadonlyMap<number, Position>) {
  return (seatNo: number): string => {
    const pos = positions.get(seatNo)
    const name = pos ? positionText(pos) : strings.format.empty
    return seatNo === detail.heroSeat ? t.log.heroActor(t.log.you, name, seatNo) : t.log.actor(name, seatNo)
  }
}

export interface SeatView {
  seatNo: number
  /** 「座位 4」 */
  label: string
  /** 位置名稱；straddle 玩家另加「Straddle」標示（3.7） */
  position: string
  isHero: boolean
  /** 起始籌碼「$20,000 · 100.0 bb」 */
  stack: string
  /** 攤牌亮牌者（與 Hero）的手牌 */
  cards: Card[]
}

export interface StreetView {
  street: Street
  /** 「翻前」「翻牌」… */
  name: string
  /** 該街公牌（翻牌 3 張、轉牌與河牌各 1 張） */
  cards: Card[]
  /** 該街開始時的底池「底池 $1,100」；推導不出時為 null */
  pot: string | null
  /** 自動發完的街（標題後註明「（全下，自動發牌）」） */
  runout: boolean
  lines: string[]
}

export interface ShowdownView {
  who: string
  cards: Card[]
  /** 中文牌型「一對 K」或「蓋牌」 */
  text: string
}

export interface PotView {
  /** 「主池 $34,300 → 你」 */
  line: string
}

export interface NetView {
  who: string
  value: number
  text: string
}

export interface ResultSectionView {
  showdown: ShowdownView[]
  pots: PotView[]
  /** 現金桌的抽水「抽水 $400」；錦標賽為 null（rake 固定 0） */
  rake: string | null
  nets: NetView[]
}

export interface HandDetailView {
  seats: SeatView[]
  streets: StreetView[]
  /** 手牌已結束（完整手牌）時的結果區；未完成時為 null */
  result: ResultSectionView | null
  /** 未完成的完整紀錄（simple 且有 detail）：最後加一行「（尚未完成）」 */
  unfinished: boolean
}

/** 「主池」「邊池 1」 */
function potName(index: number): string {
  return index === 0 ? t.result.mainPot : t.result.sidePot(index)
}

/**
 * 6.2 逐街文字呈現：座位、各街（標題底池、前注與盲注、行動、退回）、結果區。
 * detail 為 null 或未通過結構驗證（不應發生，儲存時已驗證）時回傳 null。
 */
export function buildHandDetailView(hand: Pick<Hand, 'detail' | 'board' | 'amountUnit' | 'gameType' | 'kind'>): HandDetailView | null {
  const detail = hand.detail
  if (!detail) return null
  const analyzed = analyzeDetail(detail, hand.board)
  if (!analyzed.ok) return null
  const { state, positions } = analyzed.analysis
  const unit = hand.amountUnit
  const money = (v: number) => formatHandAmount(v, unit)
  const actor = detailActorLabeler(detail, positions)
  const who = (seatNo: number) => (seatNo === detail.heroSeat ? t.log.you : actor(seatNo))
  const forced = forcedSeats(
    detail.seats.map((s) => s.seatNo),
    detail.buttonSeat,
    detail.straddle > 0,
  )

  // ---- 座位 ----
  const seats: SeatView[] = detail.seats.map((s) => {
    const pos = positions.get(s.seatNo)
    const name = pos ? positionText(pos) : strings.format.empty
    return {
      seatNo: s.seatNo,
      label: d.seatNo(s.seatNo),
      position: s.seatNo === forced.straddleSeat ? t.list.join(name, t.seat.straddleBadge) : name,
      isHero: s.seatNo === detail.heroSeat,
      stack: d.stack(money(s.stack), formatStackBb(s.stack, detail.bb)),
      cards: [...s.cards],
    }
  })

  // ---- 各街 ----
  const entries = describeActions(detail, detail.actions)
  const board = hand.board
  const streets: StreetView[] = []
  for (const street of STREETS) {
    const lines: string[] = []
    if (street === 'preflop') {
      // 前注與盲注列在翻前區最上方：前注（依座位號）→ 小盲 → 大盲 → straddle
      if (detail.ante > 0) for (const s of detail.seats) lines.push(d.post(actor(s.seatNo), d.postKinds.ante, money(detail.ante)))
      lines.push(d.post(actor(forced.sbSeat), d.postKinds.sb, money(detail.sb)))
      lines.push(d.post(actor(forced.bbSeat), d.postKinds.bb, money(detail.bb)))
      if (forced.straddleSeat !== null) lines.push(d.post(actor(forced.straddleSeat), d.postKinds.straddle, money(detail.straddle)))
    }
    const streetEntries = entries.filter((e) => e.action.street === street)
    for (const e of streetEntries) lines.push(t.log.line(actor(e.action.seatNo), actionPhrase(e.action.type, e.amount, e.allIn, unit)))
    // 未跟注退回：緊接在該街最後一筆行動之後
    for (const r of state.refunds.filter((x) => x.street === street)) lines.push(d.refund(money(r.amount), who(r.seatNo)))

    const count = boardCountFor(street)
    const reached = street === 'preflop' || streetEntries.length > 0 || board.length >= count
    if (!reached) continue
    const cards = street === 'preflop' ? [] : street === 'flop' ? board.slice(0, 3) : board.slice(count - 1, count)
    const pot = state.potAtStart[street]
    streets.push({
      street,
      name: t.streets[street],
      cards,
      pot: pot === undefined ? null : d.streetPot(money(pot)),
      runout: state.runout && street !== 'preflop' && !state.completedStreets.includes(street),
      lines,
    })
  }

  // ---- 結果（手牌已結束的完整手牌） ----
  let result: ResultSectionView | null = null
  if (hand.kind === 'complete' && state.status !== 'betting') {
    const analysis = analyzed.analysis
    const showdown: ShowdownView[] = analysis.showdownSeats.map((seatNo) => {
      const s = detail.seats.find((x) => x.seatNo === seatNo)!
      const text = s.mucked || s.cards.length !== 2 ? d.mucked : describeHandValueText(evaluateHand(s.cards, board))
      return { who: who(seatNo), cards: s.mucked ? [] : [...s.cards], text }
    })
    const winners = determineWinners(detail, board, analysis)
    const pots: PotView[] = analysis.pots.map((p, i) => {
      const w = winners?.[i] ?? null
      const names = w === null ? strings.format.empty : w.map(who).join(t.result.winnerSeparator)
      return { line: t.result.potLine(potName(i), money(p.amount), names) }
    })
    const nets = netResults(detail, board)
    result = {
      showdown,
      pots,
      rake: hand.gameType === 'cash' ? d.rake(money(detail.rake)) : null,
      nets: detail.seats.map((s) => {
        const value = nets?.get(s.seatNo) ?? 0
        return { who: who(s.seatNo), value, text: formatSignedHandAmount(value, unit) }
      }),
    }
  }

  return { seats, streets, result, unfinished: hand.kind === 'simple' }
}

/** 6.2 牌局摘要「現金桌 · 6-max · $100/$200 · 有效 100.0 bb」；有前注、straddle 時加註。備忘手牌只有牌局類型 */
export function handSummaryText(hand: Pick<Hand, 'detail' | 'gameType' | 'amountUnit'>): string {
  const parts: string[] = [t.gameTypes[hand.gameType]]
  const detail = hand.detail
  if (detail) {
    const money = (v: number) => formatHandAmount(v, hand.amountUnit)
    parts.push(d.tableMax(detail.tableSize))
    parts.push(handBlindsText({ sb: detail.sb, bb: detail.bb, hasDetail: true, amountUnit: hand.amountUnit })!)
    if (detail.ante > 0) parts.push(d.ante(money(detail.ante)))
    if (detail.straddle > 0) parts.push(d.straddle(money(detail.straddle)))
    parts.push(d.effective(formatStackBb(effectiveStack(detail), detail.bb)))
  }
  return parts.reduce((a, b) => t.list.join(a, b))
}

/** 4.12 詳情頂部的結果：有 bb 時主要顯示 bb、金額為次要；沒有 bb 時只顯示金額；heroNet 為 null 時顯示 `—` */
export function handHeadlineResult(hand: Pick<Hand, 'heroNet' | 'bb' | 'amountUnit'>): { main: string; secondary: string | null } {
  if (hand.heroNet === null) return { main: strings.format.empty, secondary: null }
  const amount = formatSignedHandAmount(hand.heroNet, hand.amountUnit)
  if (hand.bb === null) return { main: amount, secondary: null }
  return { main: formatHandBb(hand.heroNet, hand.bb), secondary: amount }
}

/** 時間 `2026/09/30 21:15`（同新增手牌頁的顯示格式） */
export function playedAtText(hand: Pick<Hand, 'playedAt'>): string {
  const p = hand.playedAt
  return t.timeDisplay(p.slice(0, 4), p.slice(5, 7), p.slice(8, 10), p.slice(11, 13), p.slice(14, 16))
}
