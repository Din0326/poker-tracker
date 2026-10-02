// SPEC-v2-hands 第 7 節：PokerStars 格式的純文字輸出（7.2 檔案、7.3 名稱、7.4 編號、7.5 時間、7.6 金額、7.7 逐行模板）。
// 純函式：輸入完整手牌與匯出名稱，輸出檔案文字。英文格式字串屬於檔案格式（第 2 節），集中在本檔的常數。
// 標「需驗證」的模板項目依規格目前寫法實作（14 節 HQ13），H5 才以 GTO Wizard 實際上傳驗證，不得自行改寫。
import { applyAction, startHand, type EngineState } from '../engine'
import { describeHandValue, evaluateHand } from '../evaluator'
import { clockwiseFrom, forcedSeats, orderAfterButton } from '../positions'
import { potsAfterRake } from '../pots'
import { DEFAULT_HERO_NAME, VILLAIN_NAME_RE, heroNameIssue } from '../schemas'
import { analyzeDetail, type DetailAnalysis } from '../summary'
import { STREETS, type AmountUnit, type Hand, type HandDetail, type Street } from '../types'

/** 7.1、14 節 HQ28：單次匯出上限 */
export const EXPORT_LIMIT = 10_000

/** 7.4：手牌編號前綴與補零位數（`77` + 14 位 = 16 位數字） */
const HAND_NUMBER_PREFIX = '77'
const HAND_NUMBER_DIGITS = 14

/** 7.7 第 2a 行：現金桌固定桌名（需驗證） */
const CASH_TABLE_NAME = 'PokerRoad'
/** 7.7 第 1b 行：錦標賽固定的買入與級別（需驗證，14 節 HQ11） */
const TOURNAMENT_BUY_IN = '$0+$0 USD'
const TOURNAMENT_LEVEL = 'Level I'

/** 7.7 第 17–19 行的街名 */
const STREET_MARKER: Record<Exclude<Street, 'preflop'>, string> = { flop: 'FLOP', turn: 'TURN', river: 'RIVER' }
/** 7.7 第 31 行「folded on the Flop / Turn / River」的街名 */
const STREET_TITLE: Record<Exclude<Street, 'preflop'>, string> = { flop: 'Flop', turn: 'Turn', river: 'River' }

/** 7.2：手牌之間空兩行（前一手最後一行之後再兩個空行），檔案以單一 `\n` 結尾（需驗證，HQ13） */
const HAND_SEPARATOR = '\n\n\n'

// ---------------------------------------------------------------------------
// 欄位格式（7.4–7.6）
// ---------------------------------------------------------------------------

/** 7.4：匯出的手牌編號 = `77` + exportSeq 補零到 14 位，共 16 位數字 */
export function formatHandNumber(exportSeq: number): string {
  return `${HAND_NUMBER_PREFIX}${String(exportSeq).padStart(HAND_NUMBER_DIGITS, '0')}`
}

/**
 * 7.5：playedAt 原值改寫為 `YYYY/MM/DD HH:mm:ss`（`-` 改 `/`、`T` 改一個空格），不換算時區、不加任何時區後綴。
 * 只做字串改寫，與裝置時區無關。
 */
export function formatExportTime(playedAt: string): string {
  const date = playedAt.slice(0, 10).replaceAll('-', '/')
  return `${date} ${playedAt.slice(11, 19)}`
}

/**
 * 7.6：匯出檔的金額格式（同一手內格式一致）：
 * - yuan：`$` + 整數（無千分位、無小數），例 `$16800`
 * - cent：`$` + 整數部分 + `.` + 2 位小數（以整數運算拆出，不經浮點數），例 `$12345.67`
 * - chip：籌碼整數，無 `$`，例 `1500`
 * 匯出檔不會出現負數。
 */
export function formatExportAmount(value: number, unit: AmountUnit): string {
  if (unit === 'chip') return String(value)
  if (unit === 'yuan') return `$${value}`
  const int = Math.floor(value / 100)
  const frac = String(value - int * 100).padStart(2, '0')
  return `$${int}.${frac}`
}

/** 7.3：匯出名稱不符合規則時（理論上設定頁已擋下）退回預設 `Hero` */
export function resolveHeroName(name: string | null | undefined): string {
  return name !== null && name !== undefined && heroNameIssue(name) === null ? name : DEFAULT_HERO_NAME
}

/**
 * 7.3 玩家名稱：Hero 用匯出名稱；對手預設 `Villain<座位號>`，Seat.name（GG 匯入）不為 null 時沿用。
 * 衝突處理：同一手內名稱相同（不分大小寫），或對手名稱與 Hero 名稱相同時，後者（座位號較大者；與 Hero 衝突時為對手）
 * 改用 `Villain<座位號>`。
 */
export function exportNames(detail: Pick<HandDetail, 'seats' | 'heroSeat'>, heroName: string): Map<number, string> {
  const names = new Map<number, string>()
  const used = new Set<string>([heroName.toLowerCase()])
  names.set(detail.heroSeat, heroName)
  for (const s of [...detail.seats].sort((a, b) => a.seatNo - b.seatNo)) {
    if (s.seatNo === detail.heroSeat) continue
    const fallback = `Villain${s.seatNo}`
    // Seat.name 依 7.3 寫入條件不會是 Villain 加數字；保守起見仍檢查
    const candidate = s.name !== null && !VILLAIN_NAME_RE.test(s.name) ? s.name : fallback
    const name = used.has(candidate.toLowerCase()) ? fallback : candidate
    used.add(name.toLowerCase())
    names.set(s.seatNo, name)
  }
  return names
}

/** 7.2：多手匯出的檔名 `poker-hands-YYYYMMDD-HHmm.txt`（本地時間） */
export function handsExportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `poker-hands-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.txt`
}

/** 7.2：單手匯出的檔名 `poker-hand-<匯出編號>.txt` */
export function singleHandExportFileName(exportSeq: number): string {
  return `poker-hand-${formatHandNumber(exportSeq)}.txt`
}

/** 7.2：MIME */
export const EXPORT_MIME = 'text/plain'

// ---------------------------------------------------------------------------
// 匯出範圍（7.1）
// ---------------------------------------------------------------------------

/** 7.1 匯出順序：依 playedAt 由舊到新，同時間依 exportSeq 由小到大 */
export function sortHandsForExport<T extends Pick<Hand, 'playedAt' | 'exportSeq'>>(hands: readonly T[]): T[] {
  return [...hands].sort((a, b) => (a.playedAt !== b.playedAt ? (a.playedAt < b.playedAt ? -1 : 1) : a.exportSeq - b.exportSeq))
}

/** 只有完整手牌可匯出（3.9、7.1）；簡易手牌一律略過、不報錯 */
export function isExportable(hand: Pick<Hand, 'kind' | 'detail'>): boolean {
  return hand.kind === 'complete' && hand.detail !== null
}

// ---------------------------------------------------------------------------
// 逐行模板（7.7）
// ---------------------------------------------------------------------------

export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

interface SeatTrack {
  /** 翻前是否有投入（盲注、straddle、跟注、下注、加注；前注不算），7.7 第 31 行 `(didn't bet)` 的判斷 */
  preflopPut: boolean
  /** 棄牌的街；未棄牌為 null */
  foldedOn: Street | null
}

/**
 * 一手完整手牌的 PokerStars 文字（不含結尾換行）。手牌不是完整手牌時丟出 ExportError（呼叫端應先以 isExportable 過濾）。
 * heroName 不符合 7.3 規則時退回 `Hero`。
 */
export function exportHandText(hand: Hand, heroName: string = DEFAULT_HERO_NAME): string {
  const detail = hand.detail
  if (!isExportable(hand) || detail === null) throw new ExportError(`hand ${hand.id} is not complete`)
  const analyzed = analyzeDetail(detail, hand.board)
  if (!analyzed.ok) throw new ExportError(`hand ${hand.id} has an invalid detail`)
  return buildLines(hand, detail, analyzed.analysis, resolveHeroName(heroName)).join('\n')
}

function buildLines(hand: Hand, detail: HandDetail, analysis: DetailAnalysis, heroName: string): string[] {
  const unit = hand.amountUnit
  const $ = (v: number) => formatExportAmount(v, unit)
  const names = exportNames(detail, heroName)
  const nameOf = (seatNo: number) => names.get(seatNo)!
  const seatNos = detail.seats.map((s) => s.seatNo)
  const forced = forcedSeats(seatNos, detail.buttonSeat, detail.straddle > 0)
  const id = formatHandNumber(hand.exportSeq)
  const time = formatExportTime(hand.playedAt)
  const board = hand.board
  const lines: string[] = []

  // ---- 標頭與牌桌（第 1–3 行） ----
  if (hand.gameType === 'tournament') {
    lines.push(`PokerStars Hand #${id}: Tournament #${id}, ${TOURNAMENT_BUY_IN} Hold'em No Limit - ${TOURNAMENT_LEVEL} (${$(detail.sb)}/${$(detail.bb)}) - ${time}`)
    lines.push(`Table '${id} 1' ${detail.tableSize}-max Seat #${detail.buttonSeat} is the button`)
  } else {
    lines.push(`PokerStars Hand #${id}:  Hold'em No Limit (${$(detail.sb)}/${$(detail.bb)}) - ${time}`)
    lines.push(`Table '${CASH_TABLE_NAME}' ${detail.tableSize}-max Seat #${detail.buttonSeat} is the button`)
  }
  for (const s of detail.seats) lines.push(`Seat ${s.seatNo}: ${nameOf(s.seatNo)} (${$(s.stack)} in chips)`)

  // ---- 前注、盲注、straddle（第 4–7 行；前注依座位號、在盲注之前） ----
  if (detail.ante > 0) for (const s of detail.seats) lines.push(`${nameOf(s.seatNo)}: posts the ante ${$(detail.ante)}`)
  lines.push(`${nameOf(forced.sbSeat)}: posts small blind ${$(detail.sb)}`)
  lines.push(`${nameOf(forced.bbSeat)}: posts big blind ${$(detail.bb)}`)
  if (forced.straddleSeat !== null) lines.push(`${nameOf(forced.straddleSeat)}: posts straddle ${$(detail.straddle)}`)

  // ---- 發牌與行動（第 8–19 行） ----
  const hero = detail.seats.find((s) => s.seatNo === detail.heroSeat)!
  lines.push('*** HOLE CARDS ***')
  lines.push(`Dealt to ${heroName} [${hero.cards.join(' ')}]`)

  const track = new Map<number, SeatTrack>(
    detail.seats.map((s) => [
      s.seatNo,
      { preflopPut: s.seatNo === forced.sbSeat || s.seatNo === forced.bbSeat || s.seatNo === forced.straddleSeat, foldedOn: null },
    ]),
  )
  let printedStreet: Street = 'preflop'
  const printStreetsUpTo = (target: Street) => {
    const from = STREETS.indexOf(printedStreet)
    const to = STREETS.indexOf(target)
    for (let i = from + 1; i <= to; i++) {
      const street = STREETS[i] as Exclude<Street, 'preflop'>
      lines.push(streetMarker(street, board))
      printedStreet = street
    }
  }

  // 最後一條有下注（bet / raise）的街的最後一位下注 / 加注者（7.7 第 23 行亮牌順序）
  // 行動依發生順序且街不倒退，所以最後一筆 bet / raise 即為所求
  let lastAggressor: number | null = null

  let state: EngineState = startHand(detail)
  for (const action of detail.actions) {
    printStreetsUpTo(action.street)
    const before = state.players.find((p) => p.seatNo === action.seatNo)!
    const betBefore = state.currentBet
    const r = applyAction(state, action)
    if (!r.ok) throw new ExportError(`illegal action ${r.code}`)
    const after = r.state.players.find((p) => p.seatNo === action.seatNo)!
    const newRefunds = r.state.refunds.slice(state.refunds.length)
    // 未跟注退回（4.5）在回合結束時加回籌碼：以退回前的剩餘籌碼判斷全下（7.7 第 15 行）
    const refundedToActor = newRefunds.filter((x) => x.seatNo === action.seatNo).reduce((s, x) => s + x.amount, 0)
    const allIn = after.stack - refundedToActor === 0 ? ' and is all-in' : ''
    const who = nameOf(action.seatNo)
    const t = track.get(action.seatNo)!
    switch (action.type) {
      case 'fold':
        lines.push(`${who}: folds`)
        t.foldedOn = action.street
        break
      case 'check':
        lines.push(`${who}: checks`)
        break
      case 'call':
        lines.push(`${who}: calls ${$(before.stack - (after.stack - refundedToActor))}${allIn}`)
        break
      case 'bet':
        lines.push(`${who}: bets ${$(action.to!)}${allIn}`)
        break
      case 'raise':
        lines.push(`${who}: raises ${$(action.to! - betBefore)} to ${$(action.to!)}${allIn}`)
        break
    }
    if (action.street === 'preflop' && action.type !== 'fold' && action.type !== 'check') t.preflopPut = true
    if (action.type === 'bet' || action.type === 'raise') lastAggressor = action.seatNo
    // 第 16 行：緊接在該街最後一筆行動之後
    for (const refund of newRefunds) lines.push(`Uncalled bet (${$(refund.amount)}) returned to ${nameOf(refund.seatNo)}`)
    state = r.state
  }

  const collectedBySeat = new Map<number, number>()
  for (const c of detail.collected) collectedBySeat.set(c.seatNo, (collectedBySeat.get(c.seatNo) ?? 0) + c.amount)
  const multiPot = analysis.pots.length > 1
  const potName = (potIndex: number) => {
    if (!multiPot) return 'pot'
    if (potIndex === 0) return 'main pot'
    return analysis.pots.length === 2 ? 'side pot' : `side pot-${potIndex}`
  }
  // 第 26、27 行：每筆 collected 一行；邊池先輸出（由最後的邊池到第 1 個邊池），主池最後；
  // 同一池內依座位順時針（從按鈕下一位起）
  const clockwise = orderAfterButton(seatNos, detail.buttonSeat)
  const collectedLines = () => {
    const potOrder = multiPot ? [...analysis.pots.keys()].slice(1).reverse().concat(0) : [0]
    for (const potIndex of potOrder) {
      const rows = detail.collected
        .filter((c) => c.potIndex === potIndex)
        .sort((a, b) => clockwise.indexOf(a.seatNo) - clockwise.indexOf(b.seatNo))
      for (const c of rows) lines.push(`${nameOf(c.seatNo)} collected ${$(c.amount)} from ${potName(potIndex)}`)
    }
  }

  const showdown = analysis.state.status === 'showdown'
  const showdownSeats = analysis.showdownSeats
  // 4.10 牌型英文描述：亮牌行與摘要行共用，每位攤牌者只評估一次
  const descriptions = new Map<number, string>()
  const describe = (seatNo: number, cards: readonly string[]) => {
    let desc = descriptions.get(seatNo)
    if (desc === undefined) {
      desc = describeHandValue(evaluateHand(cards, board))
      descriptions.set(seatNo, desc)
    }
    return desc
  }
  if (showdown) {
    // 自動發完（4.4）：剩餘的街照常輸出，街與街之間沒有行動行
    printStreetsUpTo('river')
    lines.push('*** SHOW DOWN ***')
    const start = lastAggressor !== null && showdownSeats.includes(lastAggressor) ? lastAggressor : orderAfterButton(seatNos, detail.buttonSeat).find((s) => showdownSeats.includes(s))!
    for (const seatNo of clockwiseFrom(seatNos, start).filter((s) => showdownSeats.includes(s))) {
      const s = detail.seats.find((x) => x.seatNo === seatNo)!
      if (s.mucked) lines.push(`${nameOf(seatNo)}: mucks hand`)
      else lines.push(`${nameOf(seatNo)}: shows [${s.cards.join(' ')}] (${describe(seatNo, s.cards)})`)
    }
  }
  collectedLines()

  // ---- 摘要（第 28–31 行） ----
  lines.push('*** SUMMARY ***')
  const rake = $(detail.rake)
  if (multiPot) {
    const after = potsAfterRake(analysis.pots, detail.rake)
    const sides = after
      .slice(1)
      .map((amount, i) => (after.length === 2 ? `Side pot ${$(amount)}.` : `Side pot-${i + 1} ${$(amount)}.`))
      .join(' ')
    lines.push(`Total pot ${$(analysis.totalPot)} Main pot ${$(after[0]!)}. ${sides} | Rake ${rake}`)
  } else {
    lines.push(`Total pot ${$(analysis.totalPot)} | Rake ${rake}`)
  }
  if (board.length > 0) lines.push(`Board [${board.join(' ')}]`)

  const headsUp = seatNos.length === 2
  for (const s of detail.seats) {
    let marker = ''
    if (headsUp && s.seatNo === detail.buttonSeat) marker = ' (button) (small blind)'
    else if (s.seatNo === detail.buttonSeat) marker = ' (button)'
    else if (s.seatNo === forced.sbSeat) marker = ' (small blind)'
    else if (s.seatNo === forced.bbSeat) marker = ' (big blind)'
    const t = track.get(s.seatNo)!
    const won = collectedBySeat.get(s.seatNo) ?? 0
    let result: string
    if (t.foldedOn === 'preflop') result = t.preflopPut ? 'folded before Flop' : "folded before Flop (didn't bet)"
    else if (t.foldedOn !== null) result = `folded on the ${STREET_TITLE[t.foldedOn]}`
    else if (!showdown) result = `collected (${$(won)})`
    else if (s.mucked) result = 'mucked'
    else {
      const desc = describe(s.seatNo, s.cards)
      result = won > 0 ? `showed [${s.cards.join(' ')}] and won (${$(won)}) with ${desc}` : `showed [${s.cards.join(' ')}] and lost with ${desc}`
    }
    lines.push(`Seat ${s.seatNo}: ${nameOf(s.seatNo)}${marker} ${result}`)
  }
  return lines
}

function streetMarker(street: Exclude<Street, 'preflop'>, board: readonly string[]): string {
  if (street === 'flop') return `*** ${STREET_MARKER.flop} *** [${board.slice(0, 3).join(' ')}]`
  if (street === 'turn') return `*** ${STREET_MARKER.turn} *** [${board.slice(0, 3).join(' ')}] [${board[3]}]`
  return `*** ${STREET_MARKER.river} *** [${board.slice(0, 4).join(' ')}] [${board[4]}]`
}

/**
 * 7.2 檔案內容：多手依 7.1 排序，手牌之間空兩行，最後一手之後以單一 `\n` 結尾；UTF-8 不加 BOM（內容只有 ASCII）。
 * 只接受完整手牌（呼叫端先以 isExportable 過濾）；0 手時回傳空字串。
 */
export function exportPokerStars(hands: readonly Hand[], heroName: string = DEFAULT_HERO_NAME): string {
  if (hands.length === 0) return ''
  const name = resolveHeroName(heroName)
  return `${sortHandsForExport(hands).map((h) => exportHandText(h, name)).join(HAND_SEPARATOR)}\n`
}
