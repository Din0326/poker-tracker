// SPEC-v2-hands 第 8 節：GG（GGPoker / Natural8，GGNetwork）方言解析器（實驗功能）。
//
// 【需驗證】本檔的所有格式描述都依公開資料撰寫，撰寫時沒有真實 GG 匯出檔（14 節 HQ15）；
// 取得真實 PokerCraft 匯出檔後必須補驗證與 fixture，規則有變更時 GG_PARSER_VERSION 遞增。
//
// 解析流程（每一手，8.3、8.5）：
//   1. 原文超過 20,000 字元 → 手牌內容過長
//   2. 8.5 關鍵字檢查（不分大小寫，依表格由上到下取第一個符合者）
//   3. 金額有 3 位以上小數 → 金額超過 2 位小數（在白名單檢查之前）
//   4. 白名單逐行比對（8.3 表格），任何一行不符合即拒絕（無法辨識的內容：第 N 行），不得猜測或略過
//   5. 交給 parse/core.ts 以 4.2–4.8 重播驗證（與 PokerStars 方言共用，不另寫重播或驗證）
import { isValidPlayedAt } from '../schemas'
import type { ActionType, Card } from '../types'
import {
  assembleHand,
  normalizeText,
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

/** 3.1 parserVersion：v2.0 為 1 */
export const GG_PARSER_VERSION = 1
/** 3.1 rawText 上限；超過的手拒絕（8.3「手牌內容過長」） */
export const GG_RAW_TEXT_MAX = 20_000

// ---------------------------------------------------------------------------
// 白名單（8.3 表格；需驗證）
// ---------------------------------------------------------------------------

/** 金額 `<$>`：`$` + 整數（可有千分位逗號）+ 0–2 位小數；換算成分（8.3）。千分位逗號是否出現需驗證 */
const AMT = '\\$((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)'
const CARD = '(\\S{2})'
const re = (source: string) => new RegExp(`^${source}$`)

const HAND_START_RE = /^Poker Hand #/
const RULES = {
  header: re(`Poker Hand #([A-Z]{2})(\\d+): Hold'em No Limit \\(${AMT}/${AMT}\\) - (\\d{4}/\\d{2}/\\d{2}) (\\d{2}:\\d{2}:\\d{2})`),
  table: re(`Table '([^']*)' (\\d+)-max Seat #(\\d+) is the button`),
  seat: re(`Seat (\\d+): (.+) \\(${AMT} in chips\\)`),
  ante: re(`(.+): posts the ante ${AMT}`),
  smallBlind: re(`(.+): posts small blind ${AMT}`),
  bigBlind: re(`(.+): posts big blind ${AMT}`),
  holeCards: re('\\*\\*\\* HOLE CARDS \\*\\*\\*'),
  // 8.3：每位玩家都有 `Dealt to`，只有 Hero 帶牌；行尾可能有空白（8.8 範例行尾一個空格）
  dealt: re(`Dealt to (.+?)(?: \\[${CARD} ${CARD}\\])?\\s*`),
  action: re(`(.+): (folds|checks|calls ${AMT}|bets ${AMT}|raises ${AMT} to ${AMT})( and is all-in)?`),
  uncalled: re(`Uncalled bet \\(${AMT}\\) returned to (.+)`),
  flop: re(`\\*\\*\\* FLOP \\*\\*\\* \\[${CARD} ${CARD} ${CARD}\\]`),
  turn: re(`\\*\\*\\* TURN \\*\\*\\* \\[${CARD} ${CARD} ${CARD}\\] \\[${CARD}\\]`),
  river: re(`\\*\\*\\* RIVER \\*\\*\\* \\[${CARD} ${CARD} ${CARD} ${CARD}\\] \\[${CARD}\\]`),
  // 8.4：GG 寫 `*** SHOWDOWN ***`，也接受 `*** SHOW DOWN ***`；可有可無（需驗證：沒有攤牌時是否也輸出）
  showDown: re('\\*\\*\\* (?:SHOWDOWN|SHOW DOWN) \\*\\*\\*'),
  // 括號內的牌型描述忽略
  shows: re(`(.+): shows \\[${CARD} ${CARD}\\](?: \\(.*\\))?`),
  mucks: re('(.+): mucks hand'),
  collected: re(`(.+) collected ${AMT} from pot`),
  summary: re('\\*\\*\\* SUMMARY \\*\\*\\*'),
  // rake = Rake + 所有附加費用（Jackpot、Bingo、Fortune、Tax）合計
  totalPot: re(`Total pot ${AMT} \\| Rake ${AMT}((?: \\| (?:Jackpot|Bingo|Fortune|Tax) ${AMT})*)`),
  fee: /\| (?:Jackpot|Bingo|Fortune|Tax) \$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/g,
  board: re('Board \\[(.+)\\]'),
  // 只辨識，不取值
  seatSummary: re('Seat \\d+: .+'),
}

/** 8.3：金額有 3 位以上小數時，在白名單檢查之前就拒絕 */
const TOO_MANY_DECIMALS_RE = /\$[\d,]+\.\d{3,}/
/** 拒絕時用來顯示原站手牌編號（取不到時以「第 N 個檔案第 M 手」顯示） */
const LOOSE_HAND_ID_RE = /^Poker Hand #([A-Za-z0-9]{1,40}):/
const PREFIX_RE = /^Poker Hand #([A-Za-z]+)/
/** 8.4：已知前綴 RC = Rush & Cash、HD = 現金桌（待確認） */
const SUPPORTED_PREFIXES = new Set(['RC', 'HD'])
/** 3.1 sourceHandId：1–40 字元，僅英數字 */
const SOURCE_HAND_ID_MAX = 40

// ---------------------------------------------------------------------------
// 拒絕原因
// ---------------------------------------------------------------------------

/**
 * 8.5 不支援的情況與 8.3 的拒絕原因（畫面文字由 UI 依代碼對應字串檔，文字照 8.5 / 第 8 節）。
 * 有 line 的原因為該手內的行號（1 起算）；與特定行無關時為 null。
 */
export type GgRejectReason =
  | { code: 'tooLong' }
  | { code: 'omaha' }
  | { code: 'shortDeck' }
  | { code: 'notNlh' }
  | { code: 'tournament' }
  | { code: 'unknownPrefix'; prefix: string }
  | { code: 'runItTwice' }
  | { code: 'evCashout' }
  | { code: 'insurance' }
  | { code: 'bombPot' }
  | { code: 'straddle' }
  | { code: 'missedBlind' }
  | { code: 'tooManyDecimals' }
  | { code: 'stackTooSmall' }
  | { code: 'sidePot' }
  | { code: 'tableSize' }
  | { code: 'unrecognizedLine'; line: number | null }
  | { code: 'illegalAction'; line: number | null }
  | { code: 'potMismatch' }
  | { code: 'duplicateCard' }
  | { code: 'incomplete' }
  | { code: 'noHero' }
  | { code: 'winnerMismatch' }

export type GgRejectCode = GgRejectReason['code']

const NLH_RE = new RegExp("hold'em no limit", 'i')

/** 8.5 關鍵字表的前三列（只檢查標頭行，不分大小寫；依表格由上到下） */
const HEADER_RULES: { code: Extract<GgRejectCode, 'omaha' | 'shortDeck' | 'notNlh'>; test: (header: string) => boolean }[] = [
  { code: 'omaha', test: (h) => /omaha|plo/i.test(h) },
  { code: 'shortDeck', test: (h) => /short deck|6\+/i.test(h) },
  { code: 'notNlh', test: (h) => !NLH_RE.test(h) },
]

/** 8.5 其餘關鍵字（檢查整手原文，不分大小寫；依表格由上到下） */
const BODY_KEYWORDS: { code: Extract<GgRejectCode, 'runItTwice' | 'evCashout' | 'insurance' | 'bombPot' | 'straddle' | 'missedBlind'>; re: RegExp }[] = [
  { code: 'runItTwice', re: /first flop|first turn|first river|second flop|second turn|second river|run it|two times/i },
  { code: 'evCashout', re: /cashout|cash out/i },
  { code: 'insurance', re: /insurance/i },
  { code: 'bombPot', re: /bomb pot|bombpot/i },
  { code: 'straddle', re: /straddle/i },
  { code: 'missedBlind', re: /missed blind|dead blind|small & big blind/i },
]

/** 8.5 關鍵字檢查（白名單解析之前），依表格順序取第一個符合者；都不符合時為 null */
export function detectUnsupported(rawText: string): GgRejectReason | null {
  const header = rawText.split('\n', 1)[0] ?? ''
  for (const rule of HEADER_RULES) if (rule.test(header)) return { code: rule.code }
  const prefix = PREFIX_RE.exec(header)?.[1] ?? ''
  if (prefix.toUpperCase() === 'TM' || /tournament/i.test(header)) return { code: 'tournament' }
  if (prefix !== '' && !SUPPORTED_PREFIXES.has(prefix)) return { code: 'unknownPrefix', prefix }
  for (const k of BODY_KEYWORDS) if (k.re.test(rawText)) return { code: k.code }
  return null
}

/** parse/core.ts 的錯誤代碼對應到 8.5「其他」與 8.3 的拒絕原因 */
export function ggReasonFromIssue(issue: ParseIssue): GgRejectReason {
  switch (issue.code) {
    case 'illegalAction':
    case 'blindMismatch': // 規格疑義：8.3 只寫「必須與 4.1 推導的座位一致」，未定義文字；以「行動不合法」回報
    case 'refundMismatch':
      return { code: 'illegalAction', line: issue.line }
    case 'potMismatch':
    case 'collectedMismatch':
      return { code: 'potMismatch' }
    case 'duplicateCard':
      return { code: 'duplicateCard' }
    case 'incomplete':
      return { code: 'incomplete' }
    case 'noHero':
      return { code: 'noHero' }
    case 'unsupportedTableSize':
      return { code: 'tableSize' }
    case 'stackTooSmall':
      return { code: 'stackTooSmall' }
    case 'sidePot':
      return { code: 'sidePot' }
    case 'winnerMismatch':
      return { code: 'winnerMismatch' }
    default:
      // unrecognizedLine、unknownPlayer、duplicatePlayer、cardMismatch、boardMismatch、invalidDetail 等：白名單 / 內容不符
      return { code: 'unrecognizedLine', line: issue.line }
  }
}

// ---------------------------------------------------------------------------
// 結果型別
// ---------------------------------------------------------------------------

export interface ParsedGgHand extends AssembledHand {
  /** 原站手牌編號含前綴，例 `RC1000000001` */
  sourceHandId: string
  /** 該手原文（已正規化換行為 `\n`、去除 BOM 與前後空白行，3.1） */
  rawText: string
}

export type GgHandResult =
  | { ok: true; hand: ParsedGgHand }
  | { ok: false; reason: GgRejectReason; /** 取得到的原站手牌編號；取不到時為 null */ sourceHandId: string | null }

export interface GgHandChunk {
  /** 這手在檔案中的序號（1 起算；8.2「第 3 個檔案第 18 手」） */
  index: number
  rawText: string
}

// ---------------------------------------------------------------------------
// 拆手與單手解析
// ---------------------------------------------------------------------------

/** 8.3 拆手：以行首 `Poker Hand #` 為每手開頭；去除每手前後空行；第一手之前的內容忽略 */
export function splitGgHands(text: string): GgHandChunk[] {
  return splitHands(normalizeText(text), (line) => HAND_START_RE.test(line)).hands.map((h, i) => ({
    index: i + 1,
    rawText: h.lines.join('\n'),
  }))
}

/** 金額字串（不含 `$`）換算成分：`0.1` → 10、`25` → 2500、`1,000.5` → 100050；以字串運算，不經浮點數 */
export function ggAmountToCents(text: string): number {
  const [int, frac = ''] = text.replaceAll(',', '').split('.') as [string, string?]
  return Number(int) * 100 + Number(frac.padEnd(2, '0'))
}

type Section = 'seats' | 'posts' | 'dealt' | 'actions' | 'showdown' | 'summaryPot' | 'summaryRest' | 'seatSummary'

/** 白名單逐行解析一手，組成 RawHand（只檢查格式；內容的一致性交給 core 重播驗證） */
function readHand(lines: readonly string[]): ParseStep<{ raw: RawHand; sourceHandId: string }> {
  const cents = (s: string) => ggAmountToCents(s)

  // ---- 第 1 行：標頭 ----
  const h = RULES.header.exec(lines[0] ?? '')
  if (!h) return parseFail('unrecognizedLine', 1)
  const sourceHandId = `${h[1]!}${h[2]!}`
  const playedAt = playedAtFromHeader(h[5]!, h[6]!)
  if (sourceHandId.length > SOURCE_HAND_ID_MAX || !isValidPlayedAt(playedAt)) return parseFail('unrecognizedLine', 1)

  // ---- 第 2 行：牌桌 ----
  const t = RULES.table.exec(lines[1] ?? '')
  if (!t) return parseFail('unrecognizedLine', 2)

  const seats: RawHand['seats'] = []
  const antes: RawPost[] = []
  let smallBlind: RawPost | null = null
  let bigBlind: RawPost | null = null
  const heroes: NonNullable<RawHand['hero']>[] = []
  const dealtNames = new Set<string>()
  const events: RawEvent[] = []
  let showdownLine: number | null = null
  const shows: RawHand['shows'] = []
  const mucks: RawHand['mucks'] = []
  const collects: RawCollect[] = []
  let summary: RawHand['summary'] = null
  let boardSummary: RawHand['boardSummary'] = null
  let section: Section = 'seats'

  // 亮牌、蓋牌、收回：攤牌標記之前（例如全下後亮牌、因棄牌結束的收回）與之後都接受，位置不影響重播驗證
  const settleLine = (text: string, line: number): boolean | 'bad' => {
    let r: RegExpExecArray | null
    if ((r = RULES.shows.exec(text))) {
      const cards = parseCards(`${r[2]!} ${r[3]!}`)
      if (!cards) return 'bad'
      shows.push({ name: r[1]!, cards, line })
      return true
    }
    if ((r = RULES.mucks.exec(text))) {
      mucks.push({ name: r[1]!, line })
      return true
    }
    if ((r = RULES.collected.exec(text))) {
      collects.push({ name: r[1]!, amount: cents(r[2]!), pot: 'pot', line })
      return true
    }
    return false
  }

  nextLine: for (let i = 2; i < lines.length; i++) {
    const text = lines[i]!
    const line = i + 1
    let r: RegExpExecArray | null
    dispatch: for (;;) {
      switch (section) {
        case 'seats':
          // 座位行只在 `*** HOLE CARDS ***` 之前
          if ((r = RULES.seat.exec(text))) {
            seats.push({ seatNo: Number(r[1]), name: r[2]!, stack: cents(r[3]!), line })
            continue nextLine
          }
          if (seats.length === 0) return parseFail('unrecognizedLine', line)
          section = 'posts'
          continue dispatch
        case 'posts':
          if ((r = RULES.ante.exec(text))) {
            antes.push({ name: r[1]!, amount: cents(r[2]!), line })
            continue nextLine
          }
          if ((r = RULES.smallBlind.exec(text))) {
            if (smallBlind) return parseFail('unrecognizedLine', line)
            smallBlind = { name: r[1]!, amount: cents(r[2]!), line }
            continue nextLine
          }
          if ((r = RULES.bigBlind.exec(text))) {
            if (bigBlind) return parseFail('unrecognizedLine', line)
            bigBlind = { name: r[1]!, amount: cents(r[2]!), line }
            continue nextLine
          }
          if (RULES.holeCards.test(text)) {
            section = 'dealt'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        case 'dealt':
          if ((r = RULES.dealt.exec(text))) {
            const name = r[1]!
            // 同一位玩家重複的發牌行不在白名單內
            if (dealtNames.has(name)) return parseFail('unrecognizedLine', line)
            dealtNames.add(name)
            if (r[2] !== undefined) {
              const cards = parseCards(`${r[2]} ${r[3]!}`)
              if (!cards) return parseFail('unrecognizedLine', line)
              heroes.push({ name, cards, line })
            }
            continue nextLine
          }
          section = 'actions'
          continue dispatch
        case 'actions': {
          if ((r = RULES.action.exec(text))) {
            const verb = r[2]!
            const allIn = r[7] !== undefined
            const base = { kind: 'action' as const, name: r[1]!, allIn, line }
            let type: ActionType
            let amount: number | null = null
            let to: number | null = null
            if (verb === 'folds') type = 'fold'
            else if (verb === 'checks') type = 'check'
            else if (r[3] !== undefined) {
              type = 'call'
              amount = cents(r[3])
            } else if (r[4] !== undefined) {
              type = 'bet'
              to = cents(r[4])
            } else {
              type = 'raise'
              amount = cents(r[5]!)
              to = cents(r[6]!)
            }
            events.push({ ...base, type, amount, to })
            continue nextLine
          }
          if ((r = RULES.uncalled.exec(text))) {
            events.push({ kind: 'uncalled', name: r[2]!, amount: cents(r[1]!), line })
            continue nextLine
          }
          if ((r = RULES.flop.exec(text) ?? RULES.turn.exec(text) ?? RULES.river.exec(text))) {
            const cards: Card[] | null = parseCards(r.slice(1).filter((x): x is string => x !== undefined).join(' '))
            if (!cards) return parseFail('unrecognizedLine', line)
            const street = cards.length === 3 ? 'flop' : cards.length === 4 ? 'turn' : 'river'
            events.push({ kind: 'street', street, cards, line })
            continue nextLine
          }
          const settled = settleLine(text, line)
          if (settled === 'bad') return parseFail('unrecognizedLine', line)
          if (settled) continue nextLine
          if (RULES.showDown.test(text)) {
            showdownLine = line
            section = 'showdown'
            continue nextLine
          }
          if (RULES.summary.test(text)) {
            section = 'summaryPot'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        }
        case 'showdown': {
          const settled = settleLine(text, line)
          if (settled === 'bad') return parseFail('unrecognizedLine', line)
          if (settled) continue nextLine
          if (RULES.summary.test(text)) {
            section = 'summaryPot'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        }
        case 'summaryPot':
          if ((r = RULES.totalPot.exec(text))) {
            let rake = cents(r[2]!)
            for (const fee of r[3]!.matchAll(RULES.fee)) rake += cents(fee[1]!)
            summary = { totalPot: cents(r[1]!), rake, pots: null, line }
            section = 'summaryRest'
            continue nextLine
          }
          return parseFail('unrecognizedLine', line)
        case 'summaryRest':
          if ((r = RULES.board.exec(text))) {
            const cards = parseCards(r[1]!)
            if (!cards || cards.length > 5) return parseFail('unrecognizedLine', line)
            boardSummary = { cards, line }
            section = 'seatSummary'
            continue nextLine
          }
          section = 'seatSummary'
          continue dispatch
        case 'seatSummary':
          if (RULES.seatSummary.test(text)) continue nextLine
          return parseFail('unrecognizedLine', line)
      }
    }
  }
  const endLine = lines.length + 1
  if (summary === null) return parseFail('incomplete', endLine)
  // 8.3 Hero 判定：帶 2 張牌的 `Dealt to` 必須恰好 1 行
  if (heroes.length !== 1) return parseFail('noHero', heroes[1]?.line ?? endLine)

  return {
    ok: true,
    value: {
      sourceHandId,
      raw: {
        gameType: 'cash',
        playedAt,
        sb: cents(h[3]!),
        bb: cents(h[4]!),
        tableSize: Number(t[2]),
        buttonSeat: Number(t[3]),
        headerLine: 1,
        tableLine: 2,
        seats,
        antes,
        smallBlind,
        bigBlind,
        straddle: null,
        hero: heroes[0]!,
        events,
        showdownLine,
        shows,
        mucks,
        collects,
        summary,
        boardSummary,
        endLine,
      },
    },
  }
}

/** 解析一手 GG 原文（已由 splitGgHands 拆出並正規化） */
export function parseGgHand(rawText: string): GgHandResult {
  const sourceHandId = LOOSE_HAND_ID_RE.exec(rawText)?.[1] ?? null
  const reject = (reason: GgRejectReason): GgHandResult => ({ ok: false, reason, sourceHandId })
  if (rawText.length > GG_RAW_TEXT_MAX) return reject({ code: 'tooLong' })
  const unsupported = detectUnsupported(rawText)
  if (unsupported) return reject(unsupported)
  if (TOO_MANY_DECIMALS_RE.test(rawText)) return reject({ code: 'tooManyDecimals' })

  const read = readHand(rawText.split('\n'))
  if (!read.ok) return reject(ggReasonFromIssue(read.error))
  // 8.3：gameType cash、amountUnit cent（所有金額以分儲存）、straddle 0；收回以原文為準，不依 4.8 重算
  const assembled = assembleHand(read.value.raw, { source: 'gg', amountUnit: 'cent', showdownMarker: 'optional', rejectSidePots: true })
  if (!assembled.ok) return reject(ggReasonFromIssue(assembled.error))
  return { ok: true, hand: { ...assembled.value, sourceHandId: read.value.sourceHandId, rawText } }
}

/** 解析整個檔案（可含多手）；第一手之前的內容忽略（8.3） */
export function parseGgText(text: string): GgHandResult[] {
  return splitGgHands(text).map((c) => parseGgHand(c.rawText))
}
