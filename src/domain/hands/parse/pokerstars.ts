// SPEC-v2-hands 第 9 節：PokerStars 方言解析器。至少能解析本 App 第 7 節輸出的所有變化（現金桌、錦標賽、前注、straddle、
// 邊池、平分、全下自動發完、蓋牌、各種座位摘要）。不提供使用者匯入 PokerStars 手牌的畫面（14 節 HQ19），只用於往返測試與日後擴充。
//
// 解析原則（必須）：白名單逐行比對，任何一行不符合目前區段允許的格式即拒絕（第 N 行），不得猜測或略過；
// 內容交給 parse/core.ts 以 4.2–4.8 重播驗證；最後以解析結果重算 7.7 的文字，與原文逐行比對（摘要行的文字、亮牌順序、
// 牌型描述等也必須一致），確保解析結果與原文完全對應。
import { exportHandText, formatHandNumber } from '../export/pokerstars'
import { isValidPlayedAt } from '../schemas'
import type { ActionType, AmountUnit, Card, Hand, HandGameType } from '../types'
import {
  assembleHand,
  parseCards,
  parseFail,
  playedAtFromHeader,
  splitHands,
  type AssembledHand,
  type ParseIssue,
  type ParseStep,
  type RawCollect,
  type RawEvent,
  type RawHand,
  type RawPost,
} from './core'

// ---------------------------------------------------------------------------
// 白名單（7.7 各行的正規表示式）
// ---------------------------------------------------------------------------

/** 金額 token：現金桌 `$` + 整數（可帶小數），錦標賽為整數；單位在整手解析完後依第 9 節規則還原 */
const AMT = '(\\$?(?:0|[1-9]\\d*)(?:\\.\\d+)?)'
const CARD = '(\\S{2})'
const DATE_TIME = '(\\d{4}/\\d{2}/\\d{2}) (\\d{2}:\\d{2}:\\d{2})'
const re = (source: string) => new RegExp(`^${source}$`)

const HAND_START_RE = /^PokerStars Hand #/
const RULES = {
  headerCash: re(`PokerStars Hand #(\\d+): {2}Hold'em No Limit \\(${AMT}/${AMT}\\) - ${DATE_TIME}`),
  headerTournament: re(`PokerStars Hand #(\\d+): Tournament #(\\d+), \\$0\\+\\$0 USD Hold'em No Limit - Level I \\(${AMT}/${AMT}\\) - ${DATE_TIME}`),
  tableCash: re(`Table 'PokerRoad' (\\d+)-max Seat #(\\d+) is the button`),
  tableTournament: re(`Table '(\\d+) 1' (\\d+)-max Seat #(\\d+) is the button`),
  seat: re(`Seat (\\d+): (.+) \\(${AMT} in chips\\)`),
  ante: re(`(.+): posts the ante ${AMT}`),
  smallBlind: re(`(.+): posts small blind ${AMT}`),
  bigBlind: re(`(.+): posts big blind ${AMT}`),
  straddle: re(`(.+): posts straddle ${AMT}`),
  holeCards: re('\\*\\*\\* HOLE CARDS \\*\\*\\*'),
  dealt: re(`Dealt to (.+) \\[${CARD} ${CARD}\\]`),
  action: re(`(.+): (folds|checks|calls ${AMT}|bets ${AMT}|raises ${AMT} to ${AMT})( and is all-in)?`),
  uncalled: re(`Uncalled bet \\(${AMT}\\) returned to (.+)`),
  flop: re(`\\*\\*\\* FLOP \\*\\*\\* \\[${CARD} ${CARD} ${CARD}\\]`),
  turn: re(`\\*\\*\\* TURN \\*\\*\\* \\[${CARD} ${CARD} ${CARD}\\] \\[${CARD}\\]`),
  river: re(`\\*\\*\\* RIVER \\*\\*\\* \\[${CARD} ${CARD} ${CARD} ${CARD}\\] \\[${CARD}\\]`),
  showDown: re('\\*\\*\\* SHOW DOWN \\*\\*\\*'),
  shows: re(`(.+): shows \\[${CARD} ${CARD}\\] \\((.+)\\)`),
  mucks: re('(.+): mucks hand'),
  collected: re(`(.+) collected ${AMT} from (pot|main pot|side pot|side pot-([1-9]\\d*))`),
  summary: re('\\*\\*\\* SUMMARY \\*\\*\\*'),
  totalPot: re(`Total pot ${AMT} \\| Rake ${AMT}`),
  totalPotMulti: re(`Total pot ${AMT} Main pot ${AMT}\\.((?: Side pot(?:-[1-9]\\d*)? ${AMT}\\.)+) \\| Rake ${AMT}`),
  sidePot: /Side pot(?:-([1-9]\d*))? (\$?(?:0|[1-9]\d*)(?:\.\d+)?)\./g,
  board: re('Board \\[(\\S{2}(?: \\S{2}){0,4})\\]'),
  seatSummary: re('Seat (\\d+): (.+)'),
}

/** 7.4：本 App 的手牌編號固定 16 位、`77` 開頭 */
const HAND_NUMBER_RE = /^77(\d{14})$/

// ---------------------------------------------------------------------------
// 結果型別
// ---------------------------------------------------------------------------

export interface ParsedPokerStarsHand extends AssembledHand {
  /** 16 位手牌編號（7.4） */
  handNumber: string
  /** 由手牌編號還原的 exportSeq */
  exportSeq: number
}

export type PokerStarsHandResult =
  | { ok: true; hand: ParsedPokerStarsHand; startLine: number }
  | { ok: false; error: ParseIssue; startLine: number }

export interface PokerStarsParseResult {
  hands: PokerStarsHandResult[]
}

// ---------------------------------------------------------------------------
// 金額單位還原（第 9 節，PokerStars 方言）
// ---------------------------------------------------------------------------

/** 一個金額 token；value 在整手的單位確定後才填入 */
interface AmountRef {
  raw: string
  line: number
  value: number
}

type Format = 'chip' | 'int' | 'dec2' | 'bad'

function formatOf(raw: string): Format {
  if (!raw.startsWith('$')) return /^\d+$/.test(raw) ? 'chip' : 'bad'
  const dot = raw.indexOf('.')
  if (dot < 0) return 'int'
  return raw.length - dot - 1 === 2 ? 'dec2' : 'bad'
}

/**
 * 錦標賽標頭 → chip（金額不得帶 `$`）；現金桌一手內所有金額都沒有小數 → yuan；都恰為 2 位小數 → cent；
 * 混用或小數位數不是 2 → 拒絕（同一手金額格式不一致）。金額以字串運算轉成整數，不經浮點數。
 */
function resolveAmounts(refs: readonly AmountRef[], gameType: HandGameType): ParseStep<AmountUnit> {
  if (gameType === 'tournament') {
    const bad = refs.find((r) => formatOf(r.raw) !== 'chip')
    if (bad) return parseFail('amountFormatMismatch', bad.line)
    for (const r of refs) r.value = Number(r.raw)
    return { ok: true, value: 'chip' }
  }
  const first = refs[0]
  const firstFormat = first ? formatOf(first.raw) : 'int'
  if (firstFormat !== 'int' && firstFormat !== 'dec2') return parseFail('amountFormatMismatch', first!.line)
  const bad = refs.find((r) => formatOf(r.raw) !== firstFormat)
  if (bad) return parseFail('amountFormatMismatch', bad.line)
  for (const r of refs) {
    const digits = r.raw.slice(1)
    if (firstFormat === 'int') r.value = Number(digits)
    else {
      const [int, frac] = digits.split('.') as [string, string]
      r.value = Number(int) * 100 + Number(frac)
    }
    if (!Number.isSafeInteger(r.value)) return parseFail('amountFormatMismatch', r.line)
  }
  return { ok: true, value: firstFormat === 'int' ? 'yuan' : 'cent' }
}

// ---------------------------------------------------------------------------
// 逐行解析
// ---------------------------------------------------------------------------

type Section = 'seats' | 'posts' | 'dealt' | 'actions' | 'showdown' | 'summaryPot' | 'summaryRest' | 'seatSummary'

/** 解析一手（lines 為該手的各行，行號 1 起算） */
function parseHand(lines: readonly string[]): ParseStep<ParsedPokerStarsHand> {
  const refs: AmountRef[] = []
  const amt = (raw: string, line: number): AmountRef => {
    const r = { raw, line, value: Number.NaN }
    refs.push(r)
    return r
  }
  const cardsOrFail = (list: string[]): Card[] | null => parseCards(list.join(' '))

  // ---- 第 1 行：標頭 ----
  const header = lines[0] ?? ''
  let gameType: HandGameType
  let handNumber: string
  let sbRef: AmountRef
  let bbRef: AmountRef
  let date: string
  let time: string
  let m = RULES.headerCash.exec(header)
  if (m) {
    gameType = 'cash'
    handNumber = m[1]!
    sbRef = amt(m[2]!, 1)
    bbRef = amt(m[3]!, 1)
    date = m[4]!
    time = m[5]!
  } else if ((m = RULES.headerTournament.exec(header))) {
    if (m[1] !== m[2]) return parseFail('unrecognizedLine', 1)
    gameType = 'tournament'
    handNumber = m[1]!
    sbRef = amt(m[3]!, 1)
    bbRef = amt(m[4]!, 1)
    date = m[5]!
    time = m[6]!
  } else return parseFail('unrecognizedLine', 1)
  const numberMatch = HAND_NUMBER_RE.exec(handNumber)
  const exportSeq = numberMatch ? Number(numberMatch[1]) : 0
  if (exportSeq < 1) return parseFail('unrecognizedLine', 1)
  const playedAt = playedAtFromHeader(date, time)
  if (!isValidPlayedAt(playedAt)) return parseFail('unrecognizedLine', 1)

  // ---- 第 2 行：牌桌 ----
  const tableLine = lines[1] ?? ''
  let tableSize: number
  let buttonSeat: number
  if (gameType === 'cash') {
    const t = RULES.tableCash.exec(tableLine)
    if (!t) return parseFail('unrecognizedLine', 2)
    tableSize = Number(t[1])
    buttonSeat = Number(t[2])
  } else {
    const t = RULES.tableTournament.exec(tableLine)
    if (!t || t[1] !== handNumber) return parseFail('unrecognizedLine', 2)
    tableSize = Number(t[2])
    buttonSeat = Number(t[3])
  }

  // ---- 第 3 行起：依區段比對白名單 ----
  type Seat = { seatNo: number; name: string; stack: AmountRef; line: number }
  type Post = { name: string; amount: AmountRef; line: number }
  type Event =
    | { kind: 'action'; name: string; type: ActionType; amount: AmountRef | null; to: AmountRef | null; allIn: boolean; line: number }
    | Extract<RawEvent, { kind: 'street' }>
    | { kind: 'uncalled'; name: string; amount: AmountRef; line: number }
  const seats: Seat[] = []
  const antes: Post[] = []
  let smallBlind: Post | null = null
  let bigBlind: Post | null = null
  let straddle: Post | null = null
  let hero: RawHand['hero'] = null
  const events: Event[] = []
  let showdownLine: number | null = null
  const shows: RawHand['shows'] = []
  const mucks: RawHand['mucks'] = []
  const collects: (Omit<RawCollect, 'amount'> & { amount: AmountRef })[] = []
  let summary: { totalPot: AmountRef; rake: AmountRef; pots: AmountRef[] | null; line: number } | null = null
  let boardSummary: RawHand['boardSummary'] = null
  let section: Section = 'seats'

  const collectedLine = (text: string, line: number): boolean => {
    const c = RULES.collected.exec(text)
    if (!c) return false
    const label = c[3]!
    const pot: RawCollect['pot'] = label === 'pot' ? 'pot' : label === 'main pot' ? 'main' : label === 'side pot' ? 'side' : Number(c[4])
    collects.push({ name: c[1]!, amount: amt(c[2]!, line), pot, line })
    return true
  }

  // 區段轉換時以 continue dispatch 用同一行重新比對下一個區段；比對成功以 continue nextLine 前往下一行
  nextLine: for (let i = 2; i < lines.length; i++) {
    const text = lines[i]!
    const line = i + 1
    let r: RegExpExecArray | null
    dispatch: for (;;) {
      switch (section) {
        case 'seats':
          if ((r = RULES.seat.exec(text))) {
            seats.push({ seatNo: Number(r[1]), name: r[2]!, stack: amt(r[3]!, line), line })
            continue nextLine
          }
          if (seats.length === 0) return parseFail('unrecognizedLine', line)
          section = 'posts'
          continue dispatch
        case 'posts':
          if ((r = RULES.ante.exec(text))) {
            if (smallBlind || bigBlind || straddle) return parseFail('unrecognizedLine', line)
            antes.push({ name: r[1]!, amount: amt(r[2]!, line), line })
            continue nextLine
          }
          if ((r = RULES.smallBlind.exec(text))) {
            if (smallBlind || bigBlind || straddle) return parseFail('unrecognizedLine', line)
            smallBlind = { name: r[1]!, amount: amt(r[2]!, line), line }
            continue nextLine
          }
          if ((r = RULES.bigBlind.exec(text))) {
            if (!smallBlind || bigBlind) return parseFail('unrecognizedLine', line)
            bigBlind = { name: r[1]!, amount: amt(r[2]!, line), line }
            continue nextLine
          }
          if ((r = RULES.straddle.exec(text))) {
            if (!bigBlind || straddle) return parseFail('unrecognizedLine', line)
            straddle = { name: r[1]!, amount: amt(r[2]!, line), line }
            continue nextLine
          }
          if (RULES.holeCards.test(text)) {
            section = 'dealt'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        case 'dealt': {
          r = RULES.dealt.exec(text)
          const cards = r ? cardsOrFail([r[2]!, r[3]!]) : null
          if (!r || !cards) return parseFail('unrecognizedLine', line)
          hero = { name: r[1]!, cards, line }
          section = 'actions'
          continue nextLine
        }
        case 'actions':
          if ((r = RULES.action.exec(text))) {
            const verb = r[2]!
            const allIn = r[7] !== undefined
            if (verb === 'folds' || verb === 'checks') {
              events.push({ kind: 'action', name: r[1]!, type: verb === 'folds' ? 'fold' : 'check', amount: null, to: null, allIn, line })
            } else if (r[3] !== undefined) {
              events.push({ kind: 'action', name: r[1]!, type: 'call', amount: amt(r[3], line), to: null, allIn, line })
            } else if (r[4] !== undefined) {
              events.push({ kind: 'action', name: r[1]!, type: 'bet', amount: null, to: amt(r[4], line), allIn, line })
            } else {
              events.push({ kind: 'action', name: r[1]!, type: 'raise', amount: amt(r[5]!, line), to: amt(r[6]!, line), allIn, line })
            }
            continue nextLine
          }
          if ((r = RULES.uncalled.exec(text))) {
            events.push({ kind: 'uncalled', name: r[2]!, amount: amt(r[1]!, line), line })
            continue nextLine
          }
          if ((r = RULES.flop.exec(text) ?? RULES.turn.exec(text) ?? RULES.river.exec(text))) {
            const cards = cardsOrFail(r.slice(1).filter((x): x is string => x !== undefined))
            if (!cards) return parseFail('unrecognizedLine', line)
            const street = cards.length === 3 ? 'flop' : cards.length === 4 ? 'turn' : 'river'
            events.push({ kind: 'street', street, cards, line })
            continue nextLine
          }
          if (collectedLine(text, line)) continue nextLine
          if (RULES.showDown.test(text)) {
            if (collects.length > 0) return parseFail('unrecognizedLine', line)
            showdownLine = line
            section = 'showdown'
            continue nextLine
          }
          if (RULES.summary.test(text)) {
            section = 'summaryPot'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        case 'showdown':
          if ((r = RULES.shows.exec(text))) {
            const cards = cardsOrFail([r[2]!, r[3]!])
            if (!cards || collects.length > 0) return parseFail('unrecognizedLine', line)
            shows.push({ name: r[1]!, cards, line })
            continue nextLine
          }
          if ((r = RULES.mucks.exec(text))) {
            if (collects.length > 0) return parseFail('unrecognizedLine', line)
            mucks.push({ name: r[1]!, line })
            continue nextLine
          }
          if (collectedLine(text, line)) continue nextLine
          if (RULES.summary.test(text)) {
            section = 'summaryPot'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        case 'summaryPot':
          if ((r = RULES.totalPot.exec(text))) {
            summary = { totalPot: amt(r[1]!, line), rake: amt(r[2]!, line), pots: null, line }
            section = 'summaryRest'
            continue nextLine
          }
          if ((r = RULES.totalPotMulti.exec(text))) {
            const total = amt(r[1]!, line)
            const pots = [amt(r[2]!, line)]
            const sides = [...r[3]!.matchAll(RULES.sidePot)]
            // 邊池只有 1 個時寫 `Side pot`，2 個以上時依序 `Side pot-1`、`Side pot-2`…
            const labelsOk = sides.length === 1 ? sides[0]![1] === undefined : sides.every((s, k) => s[1] === String(k + 1))
            if (!labelsOk) return parseFail('unrecognizedLine', line)
            for (const s of sides) pots.push(amt(s[2]!, line))
            summary = { totalPot: total, rake: amt(r[5]!, line), pots, line }
            section = 'summaryRest'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        case 'summaryRest':
          if ((r = RULES.board.exec(text))) {
            const cards = parseCards(r[1]!)
            if (!cards) return parseFail('unrecognizedLine', line)
            boardSummary = { cards, line }
            section = 'seatSummary'
            continue nextLine
          }
          section = 'seatSummary'
          continue dispatch
        case 'seatSummary':
          // 座位摘要只辨識格式；內容由最後的重算比對檢查
          if (RULES.seatSummary.test(text)) continue nextLine
          return parseFail('unrecognizedLine', line)
      }
    }
  }
  const endLine = lines.length + 1
  if (section !== 'seatSummary' || summary === null) return parseFail('incomplete', endLine)

  // ---- 金額單位還原 ----
  const unit = resolveAmounts(refs, gameType)
  if (!unit.ok) return unit
  const v = (r: AmountRef) => r.value
  const post = (p: Post | null): RawPost | null => (p ? { name: p.name, amount: v(p.amount), line: p.line } : null)
  const s = summary as { totalPot: AmountRef; rake: AmountRef; pots: AmountRef[] | null; line: number }
  const raw: RawHand = {
    gameType,
    playedAt,
    sb: v(sbRef),
    bb: v(bbRef),
    tableSize,
    buttonSeat,
    headerLine: 1,
    tableLine: 2,
    seats: seats.map((x) => ({ seatNo: x.seatNo, name: x.name, stack: v(x.stack), line: x.line })),
    antes: antes.map((a) => post(a)!),
    smallBlind: post(smallBlind),
    bigBlind: post(bigBlind),
    straddle: post(straddle),
    hero,
    events: events.map((e): RawEvent => {
      if (e.kind === 'street') return e
      if (e.kind === 'uncalled') return { kind: 'uncalled', name: e.name, amount: v(e.amount), line: e.line }
      return { ...e, amount: e.amount ? v(e.amount) : null, to: e.to ? v(e.to) : null }
    }),
    showdownLine,
    shows,
    mucks,
    collects: collects.map((c) => ({ ...c, amount: v(c.amount) })),
    summary: { totalPot: v(s.totalPot), rake: v(s.rake), pots: s.pots ? s.pots.map(v) : null, line: s.line },
    boardSummary,
    endLine,
  }

  const assembled = assembleHand(raw, {
    // 分單位只來自 GG 匯入（3.8）：還原為 cent 時以 gg 來源判定 collected（4.8 以原文金額為準）
    source: unit.value === 'cent' ? 'gg' : 'manual',
    amountUnit: unit.value,
    showdownMarker: 'strict',
  })
  if (!assembled.ok) return assembled
  const parsed: ParsedPokerStarsHand = { ...assembled.value, handNumber, exportSeq }

  // ---- 最終檢查：以解析結果重算 7.7 的文字，必須與原文逐行相同 ----
  const regenerated = exportHandText(toHand(parsed), parsed.heroName).split('\n')
  const total = Math.max(regenerated.length, lines.length)
  for (let i = 0; i < total; i++) {
    if (regenerated[i] !== lines[i]) return parseFail('contentMismatch', i + 1)
  }
  return { ok: true, value: parsed }
}

/** 解析結果轉成 exportHandText 需要的 Hand（只用於重算比對；與匯出無關的欄位為空值） */
function toHand(p: ParsedPokerStarsHand): Hand {
  return {
    id: formatHandNumber(p.exportSeq),
    exportSeq: p.exportSeq,
    kind: 'complete',
    source: p.source,
    gameType: p.gameType,
    amountUnit: p.amountUnit,
    sessionId: null,
    playedAt: p.playedAt,
    bb: p.bb,
    heroCards: p.heroCards,
    heroPosition: p.heroPosition,
    board: p.board,
    heroNet: p.heroNet,
    detail: p.detail,
    tags: [],
    note: null,
    sourceHandId: null,
    rawText: null,
    parserVersion: null,
    createdAt: '',
    updatedAt: '',
  }
}

/**
 * 解析 PokerStars 格式文字（可含多手，手牌之間以空行分隔）。每手各自回傳成功或失敗（第 N 行為該手內的行號）；
 * 第一手之前出現非空白內容時，以一筆失敗結果回報（白名單不符）。
 */
export function parsePokerStars(text: string): PokerStarsParseResult {
  const split = splitHands(text, (line) => HAND_START_RE.test(line))
  const hands: PokerStarsHandResult[] = []
  const firstLeading = split.leading[0]
  if (firstLeading) hands.push({ ok: false, error: { code: 'unrecognizedLine', line: firstLeading.line }, startLine: 1 })
  for (const chunk of split.hands) {
    const r = parseHand(chunk.lines)
    hands.push(r.ok ? { ok: true, hand: r.value, startLine: chunk.startLine } : { ok: false, error: r.error, startLine: chunk.startLine })
  }
  return { hands }
}
