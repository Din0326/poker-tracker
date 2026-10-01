// 新增 / 編輯手牌頁的純邏輯（SPEC-v2-hands 第 5 節）：表單值型別、預帶值（5.1）、5.5 驗證、完整模式的步驟推導、
// 行動與公牌的「復原上一步」、轉成 handRepo 的輸入、編輯與補齊（5.8）、草稿（5.7）。不含 React 與 DB，方便單元測試。
// 規則與計算一律呼叫 src/domain/hands（引擎、底池、牌力、摘要、結構驗證），這裡只負責「表單字串 ↔ 數值」與流程狀態。
import dayjs from 'dayjs'
import { z } from 'zod'
import type { HandInput } from '../../db'
import { charCount, roundDivHalfUp, type Session, type Stake } from '../../domain'
import {
  CARD_RE,
  HAND_GAME_TYPES,
  MAX_AMOUNT_BY_UNIT,
  MAX_HAND_NOTE_LENGTH,
  MAX_TABLE_SIZE,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  POSITIONS,
  actionSchema,
  analyzeDetail,
  boardCountFor,
  buttonSeatForPosition,
  computeCollected,
  determineWinners,
  forcedSeats,
  formatHandAmount,
  isValidPlayedAt,
  netBySeat,
  nextStreet,
  applyAction,
  startHand,
  tagKey,
  type Action,
  type Card,
  type DetailAnalysis,
  type EngineConfig,
  type EngineState,
  type AmountUnit,
  type LegalActions,
  type Hand,
  type HandDetail,
  type HandGameType,
  type HandSetup,
  type Position,
  type Street,
} from '../../domain/hands'
import { isSessionTypeCompatible } from '../../domain/backup'
import { strings } from '../../strings'

const e = strings.hands.errors

export type HandMode = 'simple' | 'complete'
export type CardSlot = Card | null
export type ResultChoice = '' | 'win' | 'loss' | 'even'

/** 座位圖的一列（5.3）：stack 為輸入框的原始字串；edited 表示使用者個別修改過（預設籌碼不再套用） */
export interface SeatValues {
  empty: boolean
  stack: string
  edited: boolean
}

/** 攤牌對手的選擇（5.3 步驟 6）：2 個牌位與「蓋牌」二擇一 */
export interface ShowdownValues {
  cards: CardSlot[]
  mucked: boolean
}

/**
 * 表單原始輸入值。金額欄位為使用者輸入的字串（已去除千分位逗號，可能含小數點，驗證時才轉為整數，3.8）。
 * 草稿（5.7）直接保存這份資料。
 */
export interface HandFormValues {
  mode: HandMode
  // ---- 共用欄位（簡易 / 完整切換時保留，5.1）----
  /** `YYYY-MM-DD` */
  date: string
  /** '0'–'23' */
  hour: string
  /** '0'–'55'，每 5 分鐘 */
  minute: string
  /** '' = 不指定 */
  sessionId: string
  gameType: HandGameType
  /** 2 個牌位 */
  heroCards: CardSlot[]
  /** 5 個牌位（翻牌 3、轉牌、河牌）；完整模式中尚未確認的街為暫存（5.8） */
  board: CardSlot[]
  tags: string[]
  /** 標籤輸入框尚未新增的文字 */
  tagInput: string
  note: string
  // ---- 簡易模式（5.2）----
  position: '' | Position
  bb: string
  result: ResultChoice
  resultAmount: string
  // ---- 完整模式：牌局設定（5.3 步驟 1）----
  tableSize: number
  sb: string
  setupBb: string
  ante: string
  straddle: boolean
  defaultStack: string
  /** 永遠 10 列（座位 1–10），只使用前 tableSize 列 */
  seats: SeatValues[]
  buttonSeat: number
  heroSeat: number | null
  /** 已按「開始翻前」且通過驗證 */
  setupDone: boolean
  // ---- 完整模式：行動、公牌、攤牌（5.3 步驟 2–6）----
  actions: Action[]
  /** 已確認的公牌張數（依確認順序），例 [3, 4, 5]；自動發完時一次確認剩餘，例 [3, 5] */
  boardSteps: number[]
  /** 座位號 → 攤牌選擇 */
  showdown: Record<string, ShowdownValues>
  rake: string
}

export type HandErrors = Partial<Record<string, string>>

/** 錯誤所在的欄位 key（畫面以 data-error-key 對應，捲動到第一個錯誤） */
export const ERROR_KEYS = {
  date: 'date',
  sessionId: 'sessionId',
  heroCards: 'heroCards',
  board: 'board',
  bb: 'bb',
  resultAmount: 'resultAmount',
  tags: 'tags',
  note: 'note',
  simpleEmpty: 'simpleEmpty',
  seats: 'seats',
  buttonSeat: 'buttonSeat',
  heroSeat: 'heroSeat',
  sb: 'sb',
  setupBb: 'setupBb',
  ante: 'ante',
  straddle: 'straddle',
  defaultStack: 'defaultStack',
  streetBoard: 'streetBoard',
  pots: 'pots',
  rake: 'rake',
} as const

export const seatErrorKey = (seatNo: number) => `seat-${seatNo}`
export const showdownErrorKey = (seatNo: number) => `showdown-${seatNo}`

export const HOURS = Array.from({ length: 24 }, (_, i) => i)
export const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)
/** 5.3 人數分段選擇器的固定選項；「其他」可選 3–10 */
export const TABLE_SIZE_PRESETS = [2, 6, 8, 9] as const
export const OTHER_TABLE_SIZES = [3, 4, 5, 6, 7, 8, 9, 10] as const
export const SEAT_ROWS = MAX_TABLE_SIZE
/** 5.6 標籤輸入、5.2 結果：選「平」時金額為 0 */
export const RESULT_CHOICES = ['win', 'loss', 'even'] as const

/** 5.1 首次使用的預設：現金桌、6 人桌、sb 100、bb 200、ante 0、straddle 0、預設籌碼 100 bb（20,000） */
export const FIRST_USE_SETUP: HandSetup = {
  gameType: 'cash',
  tableSize: 6,
  sb: 100,
  bb: 200,
  ante: 0,
  straddle: 0,
  defaultStack: 20000,
  heroSeat: 1,
}

// ---------------------------------------------------------------------------
// 金額輸入（3.8）：整數、可接受千分位逗號（輸入框已去除），字串轉整數不經浮點數
// ---------------------------------------------------------------------------

/** 3.8 單一金額上限（手動紀錄只有元與籌碼，兩者皆為 99,999,999） */
export const MAX_MANUAL_AMOUNT = MAX_AMOUNT_BY_UNIT.yuan

export type AmountParse = { ok: true; value: number } | { ok: false; reason: 'empty' | 'notInteger' | 'tooLarge' }

export function parseAmount(text: string): AmountParse {
  const t = text.replace(/,/g, '')
  if (t === '') return { ok: false, reason: 'empty' }
  if (!/^\d+$/.test(t)) return { ok: false, reason: 'notInteger' }
  const digits = t.replace(/^0+(?=\d)/, '')
  // 9 位以上必定超過上限；以長度先判斷，避免極長字串經 Number 轉換失真
  if (digits.length > 9 || Number(digits) > MAX_MANUAL_AMOUNT) return { ok: false, reason: 'tooLarge' }
  return { ok: true, value: Number(digits) }
}

/** 金額不是整數或超出上限時的錯誤訊息（5.5）；空白交由各欄位規則處理 */
function amountFormatError(r: AmountParse, gameType: HandGameType): string | undefined {
  if (r.ok || r.reason === 'empty') return undefined
  if (r.reason === 'tooLarge') return e.amountTooLarge
  return gameType === 'tournament' ? e.tournamentInteger : e.cashInteger
}

/** 只解析合法值；其餘為 null */
function amountOrNull(text: string): number | null {
  const r = parseAmount(text)
  return r.ok ? r.value : null
}

// ---------------------------------------------------------------------------
// 時間（5.2：日期 + 小時 + 分鐘；秒固定 00，3.1）
// ---------------------------------------------------------------------------

/** 預設現在，分鐘捨去到 5 的倍數（5.1） */
export function defaultTime(now: Date): Pick<HandFormValues, 'date' | 'hour' | 'minute'> {
  return {
    date: dayjs(now).format('YYYY-MM-DD'),
    hour: String(now.getHours()),
    minute: String(now.getMinutes() - (now.getMinutes() % 5)),
  }
}

export function buildPlayedAt(v: Pick<HandFormValues, 'date' | 'hour' | 'minute'>): string {
  return `${v.date}T${v.hour.padStart(2, '0')}:${v.minute.padStart(2, '0')}:00`
}

/** 顯示 `2026/09/30 21:15`；日期不合法時回傳 null */
export function formatPlayedAtText(v: Pick<HandFormValues, 'date' | 'hour' | 'minute'>): string | null {
  const playedAt = buildPlayedAt(v)
  if (!isValidPlayedAt(playedAt)) return null
  return strings.hands.timeDisplay(playedAt.slice(0, 4), playedAt.slice(5, 7), playedAt.slice(8, 10), playedAt.slice(11, 13), playedAt.slice(14, 16))
}

// ---------------------------------------------------------------------------
// 預帶值（5.1）
// ---------------------------------------------------------------------------

export interface EntryContext {
  now: Date
  lastHandSetup: HandSetup | undefined
  /** 帶 sessionId 進入時的場次（找不到時為 null） */
  session: Session | null
  /** 該場次的盲注（現金桌） */
  stake: Stake | null
}

export function gameTypeOfSession(session: Pick<Session, 'type'>): HandGameType {
  return session.type === 'cash' ? 'cash' : 'tournament'
}

function seatRows(defaultStack: string): SeatValues[] {
  return Array.from({ length: SEAT_ROWS }, () => ({ empty: false, stack: defaultStack, edited: false }))
}

/**
 * 5.1：牌局設定的預帶。lastHandSetup 的 gameType 與這次不同時，盲注以外的金額（前注、預設籌碼）不沿用，
 * 改用首次使用的預設（ante 0、預設籌碼 100 bb）。blinds 有值時（場次盲注、補齊時的大盲）取代 lastHandSetup 的盲注。
 */
export function setupDefaults(
  gameType: HandGameType,
  lastHandSetup: HandSetup | undefined,
  blinds: { sb: number; bb: number } | null,
): Pick<HandFormValues, 'tableSize' | 'sb' | 'setupBb' | 'ante' | 'straddle' | 'defaultStack' | 'seats' | 'buttonSeat' | 'heroSeat'> {
  const base = lastHandSetup ?? FIRST_USE_SETUP
  const sameType = lastHandSetup !== undefined && lastHandSetup.gameType === gameType
  const sb = blinds?.sb ?? base.sb
  const bb = blinds?.bb ?? base.bb
  const defaultStack = String(sameType ? base.defaultStack : 100 * bb)
  return {
    tableSize: base.tableSize,
    sb: String(sb),
    setupBb: String(bb),
    ante: String(sameType ? base.ante : 0),
    straddle: base.straddle > 0,
    defaultStack,
    seats: seatRows(defaultStack),
    buttonSeat: 1,
    heroSeat: base.heroSeat <= base.tableSize ? base.heroSeat : 1,
  }
}

/** 進入新增手牌頁時的初始值（5.1）；預設「簡易」模式 */
export function createEntryValues(ctx: EntryContext): HandFormValues {
  const gameType = ctx.session ? gameTypeOfSession(ctx.session) : (ctx.lastHandSetup?.gameType ?? 'cash')
  const blinds = ctx.session && gameType === 'cash' && ctx.stake ? { sb: ctx.stake.sb, bb: ctx.stake.bb } : null
  return {
    mode: 'simple',
    ...defaultTime(ctx.now),
    sessionId: ctx.session?.id ?? '',
    gameType,
    heroCards: [null, null],
    board: [null, null, null, null, null],
    tags: [],
    tagInput: '',
    note: '',
    position: '',
    bb: '',
    result: '',
    resultAmount: '',
    ...setupDefaults(gameType, ctx.lastHandSetup, blinds),
    setupDone: false,
    actions: [],
    boardSteps: [],
    showdown: {},
    rake: '0',
  }
}

export function valuesEqual(a: HandFormValues, b: HandFormValues): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---------------------------------------------------------------------------
// 牌（3.6）
// ---------------------------------------------------------------------------

const filled = (slots: readonly CardSlot[]): Card[] => slots.filter((c): c is Card => c !== null)

/** 這手牌中已使用的牌（選牌器停用，5.4）：Hero 手牌、公牌（含暫存）、攤牌牌 */
export function usedCards(v: HandFormValues): Set<Card> {
  const all = [...v.heroCards, ...v.board, ...Object.values(v.showdown).flatMap((s) => s.cards)]
  return new Set(filled(all))
}

/** 公牌牌位是否為合法的 0、3、4、5 張（依序選：已選的牌位必須連續從第 1 張開始） */
export function boardSlotsValid(board: readonly CardSlot[]): boolean {
  const n = filled(board).length
  const prefix = board.slice(0, n).every((c) => c !== null)
  return prefix && [0, 3, 4, 5].includes(n)
}

// ---------------------------------------------------------------------------
// 牌局設定（5.3 步驟 1）
// ---------------------------------------------------------------------------

/** 有玩家的座位號（1–tableSize 中非空位者） */
export function occupiedSeats(v: Pick<HandFormValues, 'seats' | 'tableSize'>): number[] {
  return v.seats
    .slice(0, v.tableSize)
    .map((s, i) => (s.empty ? null : i + 1))
    .filter((n): n is number => n !== null)
}

export interface ParsedSetup {
  config: EngineConfig
  tableSize: number
  heroSeat: number
}

/** 牌局設定轉成引擎設定；任何欄位不合法時回傳 null（先以 validateSetup 顯示錯誤） */
export function parseSetup(v: HandFormValues): ParsedSetup | null {
  if (Object.keys(validateSetup(v)).length > 0) return null
  const sb = amountOrNull(v.sb)!
  const bb = amountOrNull(v.setupBb)!
  const ante = amountOrNull(v.ante === '' ? '0' : v.ante)!
  const seats = occupiedSeats(v).map((seatNo) => ({ seatNo, stack: amountOrNull(v.seats[seatNo - 1]!.stack)! }))
  return {
    config: { seats, buttonSeat: v.buttonSeat, sb, bb, ante, straddle: v.straddle ? 2 * bb : 0 },
    tableSize: v.tableSize,
    heroSeat: v.heroSeat!,
  }
}

/** 5.5「完整模式：牌局設定」的規則（含金額格式）；不含時間、關聯場次 */
export function validateSetup(v: HandFormValues): HandErrors {
  const errors: HandErrors = {}
  const set = (key: string, message: string | undefined) => {
    if (message && errors[key] === undefined) errors[key] = message
  }
  const occupied = occupiedSeats(v)
  if (occupied.length < 2) set(ERROR_KEYS.seats, e.minPlayers)
  if (!occupied.includes(v.buttonSeat)) set(ERROR_KEYS.buttonSeat, e.buttonEmpty)
  if (v.heroSeat === null || !occupied.includes(v.heroSeat)) set(ERROR_KEYS.heroSeat, e.heroSeat)

  const sb = parseAmount(v.sb)
  const bb = parseAmount(v.setupBb)
  if (!sb.ok && sb.reason === 'empty') set(ERROR_KEYS.sb, e.blindsRequired)
  else if (sb.ok && sb.value === 0) set(ERROR_KEYS.sb, e.blindsRequired)
  else set(ERROR_KEYS.sb, amountFormatError(sb, v.gameType))
  if (!bb.ok && bb.reason === 'empty') set(ERROR_KEYS.setupBb, e.blindsRequired)
  else if (bb.ok && bb.value === 0) set(ERROR_KEYS.setupBb, e.blindsRequired)
  else set(ERROR_KEYS.setupBb, amountFormatError(bb, v.gameType))
  if (sb.ok && bb.ok && sb.value > 0 && bb.value > 0 && bb.value < sb.value) set(ERROR_KEYS.setupBb, e.bbLessThanSb)

  const ante = parseAmount(v.ante === '' ? '0' : v.ante)
  set(ERROR_KEYS.ante, amountFormatError(ante, v.gameType))
  set(ERROR_KEYS.defaultStack, amountFormatError(parseAmount(v.defaultStack), v.gameType))

  if (v.straddle) {
    if (occupied.length < 3) set(ERROR_KEYS.straddle, e.straddlePlayers)
    else if (bb.ok && 2 * bb.value > MAX_MANUAL_AMOUNT) set(ERROR_KEYS.straddle, e.amountTooLarge)
  }

  // 每個有玩家的座位：籌碼空白或為 0、格式、需大於要放的前注 + 盲注（或 straddle）
  const blindsOk = sb.ok && bb.ok && sb.value > 0 && bb.value >= sb.value && ante.ok
  const forced = occupied.length >= 2 && occupied.includes(v.buttonSeat) ? forcedSeats(occupied, v.buttonSeat, v.straddle) : null
  for (const seatNo of occupied) {
    const key = seatErrorKey(seatNo)
    const r = parseAmount(v.seats[seatNo - 1]!.stack)
    if ((!r.ok && r.reason === 'empty') || (r.ok && r.value === 0)) set(key, e.stackRequired)
    else if (!r.ok) set(key, amountFormatError(r, v.gameType))
    else if (blindsOk && forced) {
      const blind =
        seatNo === forced.sbSeat ? sb.value : seatNo === forced.bbSeat ? bb.value : seatNo === forced.straddleSeat ? 2 * bb.value : 0
      if (r.value <= ante.value + blind) set(key, e.stackTooSmall)
    }
  }

  if (filled(v.heroCards).length !== 2) set(ERROR_KEYS.heroCards, e.heroCardsRequired)
  return errors
}

/** 5.3 步驟 1 欄位中，修改後需要重新「開始翻前」、且已有行動時要先確認清除行動的欄位（5.8） */
export type SetupField = 'tableSize' | 'sb' | 'setupBb' | 'ante' | 'straddle' | 'defaultStack' | 'seats' | 'buttonSeat' | 'heroSeat' | 'gameType'

/** 改人數：超出新人數的按鈕回到座位 1、你的座位改為未選（5.5「請選擇你的座位」） */
export function changeTableSize(v: HandFormValues, tableSize: number): HandFormValues {
  return {
    ...v,
    tableSize,
    buttonSeat: v.buttonSeat > tableSize ? 1 : v.buttonSeat,
    heroSeat: v.heroSeat !== null && v.heroSeat > tableSize ? null : v.heroSeat,
  }
}

/** 改預設籌碼：套用到所有「未個別修改」的座位（5.3） */
export function changeDefaultStack(v: HandFormValues, defaultStack: string): HandFormValues {
  return { ...v, defaultStack, seats: v.seats.map((s) => (s.edited ? s : { ...s, stack: defaultStack })) }
}

export function changeSeatStack(v: HandFormValues, seatNo: number, stack: string): HandFormValues {
  return { ...v, seats: v.seats.map((s, i) => (i === seatNo - 1 ? { ...s, stack, edited: true } : s)) }
}

export function toggleSeatEmpty(v: HandFormValues, seatNo: number): HandFormValues {
  return { ...v, seats: v.seats.map((s, i) => (i === seatNo - 1 ? { ...s, empty: !s.empty } : s)) }
}

/** 5.8：已有行動時修改牌局設定，清除 actions、collected 與攤牌選擇，公牌保留（回到暫存狀態） */
export function clearActions(v: HandFormValues): HandFormValues {
  return { ...v, actions: [], boardSteps: [], showdown: {}, setupDone: false }
}

/** 5.3 Settings.lastHandSetup（儲存完整手牌時更新） */
export function toHandSetup(v: HandFormValues, setup: ParsedSetup): HandSetup {
  return {
    gameType: v.gameType,
    tableSize: setup.tableSize,
    sb: setup.config.sb,
    bb: setup.config.bb,
    ante: setup.config.ante,
    straddle: setup.config.straddle,
    defaultStack: amountOrNull(v.defaultStack) ?? setup.config.seats.find((s) => s.seatNo === setup.heroSeat)!.stack,
    heroSeat: setup.heroSeat,
  }
}

// ---------------------------------------------------------------------------
// 完整模式的步驟（5.3）
// ---------------------------------------------------------------------------

/** 由牌局設定重播行動（3.4）；全部合法才成功 */
export function replayActions(config: EngineConfig, actions: readonly Action[]): { ok: true; state: EngineState } | { ok: false } {
  let state = startHand(config)
  for (const a of actions) {
    const r = applyAction(state, a)
    if (!r.ok) return { ok: false }
    state = r.state
  }
  return { ok: true, state }
}

export type ProgressStep = 'setup' | Street | 'result'
export const PROGRESS_STEPS: readonly ProgressStep[] = ['setup', 'preflop', 'flop', 'turn', 'river', 'result']

export type CompleteStage =
  | { step: 'setup' }
  /** 街的步驟：phase 'board' 為先選公牌、'action' 為行動列；runout 為全下後一次選完剩餘公牌（4.4） */
  | { step: Street; phase: 'board' | 'action'; runout: boolean; setup: ParsedSetup; state: EngineState; boardNeeded: number }
  | { step: 'result'; setup: ParsedSetup; state: EngineState }

export function boardDone(v: Pick<HandFormValues, 'boardSteps'>): number {
  return v.boardSteps[v.boardSteps.length - 1] ?? 0
}

/** 由牌局設定、已輸入的行動與已確認的公牌推導目前步驟 */
export function deriveStage(v: HandFormValues): CompleteStage {
  if (!v.setupDone) return { step: 'setup' }
  const setup = parseSetup(v)
  if (!setup) return { step: 'setup' }
  const r = replayActions(setup.config, v.actions)
  if (!r.ok) return { step: 'setup' }
  const state = r.state
  const done = boardDone(v)
  if (state.status === 'betting') {
    const need = boardCountFor(state.street)
    return { step: state.street, phase: done < need ? 'board' : 'action', runout: false, setup, state, boardNeeded: need }
  }
  if (state.status === 'showdown' && state.runout && done < 5) {
    const last = state.completedStreets[state.completedStreets.length - 1]!
    return { step: nextStreet(last)!, phase: 'board', runout: true, setup, state, boardNeeded: 5 }
  }
  return { step: 'result', setup, state }
}

export type StepStatus = 'current' | 'done' | 'disabled'

/**
 * 進度列每個步驟的狀態：已完成的步驟可點擊回看；尚未到達或因手牌提早結束而不會到達的步驟停用（5.3）。
 * 自動發完的街（沒有行動）在公牌確認後視為已完成。
 */
export function stepStatuses(v: HandFormValues, stage: CompleteStage): Record<ProgressStep, StepStatus> {
  const result = {} as Record<ProgressStep, StepStatus>
  const currentIndex = PROGRESS_STEPS.indexOf(stage.step)
  const done = boardDone(v)
  for (const [i, step] of PROGRESS_STEPS.entries()) {
    if (i === currentIndex) result[step] = 'current'
    else if (i > currentIndex) result[step] = 'disabled'
    else if (step === 'setup') result[step] = 'done'
    else if (stage.step === 'setup') result[step] = 'disabled'
    else {
      const street = step as Street
      const played = stage.state.completedStreets.includes(street) || v.actions.some((a) => a.street === street)
      result[step] = played || (street !== 'preflop' && done >= boardCountFor(street)) ? 'done' : 'disabled'
    }
  }
  return result
}

/** 公牌步驟要選的牌位（索引） */
export function pendingBoardSlots(v: HandFormValues, stage: CompleteStage): number[] {
  if (stage.step === 'setup' || stage.step === 'result' || stage.phase !== 'board') return []
  return Array.from({ length: stage.boardNeeded - boardDone(v) }, (_, i) => boardDone(v) + i)
}

/** 公牌未選滿時的錯誤訊息（5.5）：以第一個空牌位所在的街決定 */
export function boardMissingError(v: HandFormValues, stage: CompleteStage): string | null {
  const missing = pendingBoardSlots(v, stage).find((i) => v.board[i] === null)
  if (missing === undefined) return null
  return missing < 3 ? e.boardFlop : missing === 3 ? e.boardTurn : e.boardRiver
}

/** 確認公牌（選滿才可開始該街行動，或自動發完後進入結果） */
export function confirmBoard(v: HandFormValues, stage: CompleteStage): HandFormValues {
  if (stage.step === 'setup' || stage.step === 'result' || stage.phase !== 'board') return v
  return { ...v, boardSteps: [...v.boardSteps, stage.boardNeeded] }
}

/** 加入一筆行動（引擎判斷合法；不合法時回傳 null） */
export function addAction(v: HandFormValues, stage: CompleteStage, action: Pick<Action, 'type' | 'to'>): HandFormValues | null {
  if (stage.step === 'setup' || stage.step === 'result' || stage.phase !== 'action' || stage.state.toAct === null) return null
  const next: Action = { street: stage.state.street, seatNo: stage.state.toAct, type: action.type, to: action.to }
  const r = replayActions(stage.setup.config, [...v.actions, next])
  return r.ok ? { ...v, actions: [...v.actions, next] } : null
}

export function canUndo(v: HandFormValues): boolean {
  return v.actions.length > 0 || v.boardSteps.length > 0
}

/**
 * 5.3「復原上一步」：移除最後一筆行動；若最後一步是選公牌，清除該街公牌並回到上一街結束狀態。
 * 可一路退回到步驟 1 之後（翻前、沒有任何行動）。
 */
export function undoStep(v: HandFormValues): HandFormValues {
  const lastStreet: Street = v.actions[v.actions.length - 1]?.street ?? 'preflop'
  const done = boardDone(v)
  if (v.boardSteps.length > 0 && done > boardCountFor(lastStreet)) {
    const steps = v.boardSteps.slice(0, -1)
    const from = steps[steps.length - 1] ?? 0
    return { ...v, boardSteps: steps, board: v.board.map((c, i) => (i >= from && i < done ? null : c)) }
  }
  if (v.actions.length === 0) return v
  return { ...v, actions: v.actions.slice(0, -1) }
}

/** 進入攤牌的對手座位（未棄牌、非 Hero） */
export function showdownOpponents(stage: CompleteStage): number[] {
  if (stage.step !== 'result' || stage.state.status !== 'showdown') return []
  return stage.state.players.filter((p) => !p.folded && p.seatNo !== stage.setup.heroSeat).map((p) => p.seatNo)
}

/**
 * 以目前狀態組成 detail（collected 一律為 []，儲存時由 finalizeHandContent 計算，3.5）。
 * 對手的牌與蓋牌只在進入攤牌時寫入（3.3）；抽水只在結果步驟、現金桌時寫入。
 */
export function buildDetail(v: HandFormValues, stage: Exclude<CompleteStage, { step: 'setup' }>): HandDetail {
  const { setup } = stage
  const opponents = showdownOpponents(stage)
  const rake = stage.step === 'result' && v.gameType === 'cash' ? (amountOrNull(v.rake === '' ? '0' : v.rake) ?? 0) : 0
  return {
    tableSize: setup.tableSize,
    buttonSeat: setup.config.buttonSeat,
    heroSeat: setup.heroSeat,
    sb: setup.config.sb,
    bb: setup.config.bb,
    ante: setup.config.ante,
    straddle: setup.config.straddle,
    seats: setup.config.seats.map(({ seatNo, stack }) => {
      if (seatNo === setup.heroSeat) {
        const hero = filled(v.heroCards)
        return { seatNo, stack, cards: hero.length === 2 ? hero : [], mucked: false, name: null }
      }
      const sd = opponents.includes(seatNo) ? v.showdown[String(seatNo)] : undefined
      const cards = sd && !sd.mucked ? filled(sd.cards) : []
      return { seatNo, stack, cards: cards.length === 2 ? cards : [], mucked: sd?.mucked ?? false, name: null }
    }),
    actions: [...v.actions],
    rake,
    collected: [],
  }
}

/** 已確認的公牌（完整模式寫入 Hand.board 的部分；暫存未確認的牌不寫入） */
export function confirmedBoard(v: HandFormValues): Card[] {
  return filled(v.board.slice(0, boardDone(v)))
}

export interface ResultView {
  totalPot: number
  pots: { amount: number; winners: number[] | null }[]
  /** 座位 → 淨輸贏；攤牌資料不齊全或抽水不合法時為 null */
  nets: Map<number, number> | null
  analysis: DetailAnalysis
}

/** 步驟 6 的即時顯示（4.6–4.9）：每個底池金額與贏家、每位玩家淨輸贏 */
export function computeResultView(v: HandFormValues, stage: Extract<CompleteStage, { step: 'result' }>): ResultView | null {
  const detail = buildDetail(v, stage)
  const board = confirmedBoard(v)
  const base = analyzeDetail({ ...detail, rake: 0 }, board)
  if (!base.ok) return null
  const winners = determineWinners(detail, board, base.analysis)
  const pots = base.analysis.pots.map((p, i) => ({ amount: p.amount, winners: winners?.[i] ?? null }))
  const rakeOk = parseAmount(v.rake === '' ? '0' : v.rake)
  let nets: Map<number, number> | null = null
  if (rakeOk.ok && detail.rake <= base.analysis.totalPot) {
    const a = analyzeDetail(detail, board)
    const collected = a.ok ? computeCollected(detail, board, a.analysis) : null
    if (collected) nets = netBySeat(base.analysis.state.players, collected)
  }
  return { totalPot: base.analysis.totalPot, pots, nets, analysis: base.analysis }
}

// ---------------------------------------------------------------------------
// 5.5 驗證
// ---------------------------------------------------------------------------

export interface ValidationContext {
  now: Date
  /** 用於關聯場次的類型相容檢查（3.11） */
  sessionsById: ReadonlyMap<string, Pick<Session, 'type'>>
}

/** 共通：時間、關聯場次 */
export function validateTimeAndSession(v: HandFormValues, ctx: ValidationContext): HandErrors {
  const errors: HandErrors = {}
  const playedAt = buildPlayedAt(v)
  if (!isValidPlayedAt(playedAt)) errors[ERROR_KEYS.date] = e.dateRequired
  else if (playedAt.slice(0, 16) > dayjs(ctx.now).format('YYYY-MM-DDTHH:mm')) errors[ERROR_KEYS.date] = e.timeFuture
  if (v.sessionId !== '') {
    const session = ctx.sessionsById.get(v.sessionId)
    if (session && !isSessionTypeCompatible(v.gameType, session.type)) {
      errors[ERROR_KEYS.sessionId] = v.gameType === 'cash' ? e.sessionCashOnly : e.sessionTournamentOnly
    }
  }
  return errors
}

/** 新增一個標籤時的檢查（5.5 標籤規則）；回傳錯誤訊息或 null */
export function validateNewTag(tags: readonly string[], input: string): string | null {
  const tag = input.trim()
  if (charCount(tag) > MAX_TAG_LENGTH) return e.tagTooLong
  if (tags.some((t) => tagKey(t) === tagKey(tag))) return e.tagDuplicate
  if (tags.length >= MAX_TAGS) return e.tooManyTags
  return null
}

/** 共通：標籤、備註（草稿還原時仍需檢查） */
function validateTagsAndNote(v: HandFormValues, errors: HandErrors): void {
  const seen = new Set<string>()
  for (const t of v.tags) {
    const key = tagKey(t)
    if (charCount(t.trim()) > MAX_TAG_LENGTH) errors[ERROR_KEYS.tags] ??= e.tagTooLong
    else if (seen.has(key)) errors[ERROR_KEYS.tags] ??= e.tagDuplicate
    seen.add(key)
  }
  if (v.tags.length > MAX_TAGS) errors[ERROR_KEYS.tags] ??= e.tooManyTags
  if (charCount(v.note) > MAX_HAND_NOTE_LENGTH) errors[ERROR_KEYS.note] = e.noteTooLong
}

/** 3.6 同一張牌出現兩次：錯誤掛在第二次出現的牌組（Hero 手牌 → 公牌 → 攤牌） */
function validateDuplicates(groups: { key: string; cards: readonly CardSlot[] }[], errors: HandErrors): void {
  const seen = new Set<Card>()
  for (const g of groups) {
    for (const c of filled(g.cards)) {
      if (seen.has(c)) {
        errors[g.key] ??= e.duplicateCard
        return
      }
      seen.add(c)
    }
  }
}

/** 5.2 簡易模式的儲存驗證 */
export function validateSimple(v: HandFormValues, ctx: ValidationContext): HandErrors {
  const errors = validateTimeAndSession(v, ctx)
  const hero = filled(v.heroCards).length
  if (hero === 1) errors[ERROR_KEYS.heroCards] = e.heroCardsCount
  if (!boardSlotsValid(v.board)) errors[ERROR_KEYS.board] = e.boardCount
  validateDuplicates([{ key: ERROR_KEYS.heroCards, cards: v.heroCards }, { key: ERROR_KEYS.board, cards: v.board }], errors)
  const bb = parseAmount(v.bb)
  if (bb.ok && bb.value === 0) errors[ERROR_KEYS.bb] = e.bbZero
  else if (amountFormatError(bb, v.gameType)) errors[ERROR_KEYS.bb] = amountFormatError(bb, v.gameType)
  if (v.result === 'win' || v.result === 'loss') {
    const msg = amountFormatError(parseAmount(v.resultAmount), v.gameType)
    if (msg) errors[ERROR_KEYS.resultAmount] = msg
  }
  validateTagsAndNote(v, errors)
  const anyFilled = hero > 0 || filled(v.board).length > 0 || simpleHeroNet(v) !== null || v.note !== '' || v.tags.length > 0
  if (!anyFilled) errors[ERROR_KEYS.simpleEmpty] = e.simpleEmpty
  return errors
}

/** 5.3「開始翻前」：時間、關聯場次與牌局設定 */
export function validateSetupStep(v: HandFormValues, ctx: ValidationContext): HandErrors {
  const errors = { ...validateTimeAndSession(v, ctx), ...validateSetup(v) }
  validateDuplicates([{ key: ERROR_KEYS.heroCards, cards: v.heroCards }], errors)
  return errors
}

/** 公牌與攤牌的牌組（重複檢查用） */
function cardGroups(v: HandFormValues, stage: CompleteStage): { key: string; cards: readonly CardSlot[] }[] {
  const opponents = showdownOpponents(stage)
  return [
    { key: ERROR_KEYS.heroCards, cards: v.heroCards },
    { key: ERROR_KEYS.streetBoard, cards: v.board.slice(0, boardDone(v)) },
    ...opponents.map((s) => ({ key: showdownErrorKey(s), cards: v.showdown[String(s)]?.cards ?? [] })),
  ]
}

/**
 * 5.3 步驟 6「儲存」：共通規則、結果規則（攤牌選擇、底池至少一位亮牌、抽水），
 * 以及編輯時可直接修改的 Hero 手牌與已確認公牌（5.8）
 */
export function validateCompleteSave(v: HandFormValues, stage: Extract<CompleteStage, { step: 'result' }>, ctx: ValidationContext): HandErrors {
  const errors = validateTimeAndSession(v, ctx)
  if (filled(v.heroCards).length !== 2) errors[ERROR_KEYS.heroCards] = e.heroCardsRequired
  const board = v.board.slice(0, boardDone(v))
  const missing = board.findIndex((c) => c === null)
  if (missing >= 0) errors[ERROR_KEYS.streetBoard] = missing < 3 ? e.boardFlop : missing === 3 ? e.boardTurn : e.boardRiver
  validateDuplicates(cardGroups(v, stage), errors)

  const rake = parseAmount(v.rake === '' ? '0' : v.rake)
  if (v.gameType === 'cash') {
    const msg = amountFormatError(rake, v.gameType)
    if (msg) errors[ERROR_KEYS.rake] = msg
  }
  const opponents = showdownOpponents(stage)
  let showdownOk = true
  for (const seat of opponents) {
    const sd = v.showdown[String(seat)]
    if (!sd || (!sd.mucked && filled(sd.cards).length !== 2)) {
      errors[showdownErrorKey(seat)] ??= e.showdownRequired
      showdownOk = false
    }
  }
  const view = missing < 0 ? computeResultView(v, stage) : null
  if (view) {
    if (showdownOk && view.pots.some((p) => p.winners === null)) errors[ERROR_KEYS.pots] = e.potNoShown
    if (v.gameType === 'cash' && rake.ok && rake.value > view.totalPot) errors[ERROR_KEYS.rake] = e.rakeExceedsPot
  }
  validateTagsAndNote(v, errors)
  return errors
}

// ---------------------------------------------------------------------------
// 轉成 handRepo 的輸入
// ---------------------------------------------------------------------------

/** 簡易模式的結果：贏 / 輸未填金額視為未填；平為 0（5.2） */
export function simpleHeroNet(v: Pick<HandFormValues, 'result' | 'resultAmount'>): number | null {
  if (v.result === 'even') return 0
  if (v.result === '') return null
  const amount = amountOrNull(v.resultAmount)
  if (amount === null) return null
  return v.result === 'win' ? amount : 0 - amount
}

function commonInput(v: HandFormValues) {
  return {
    source: 'manual' as const,
    gameType: v.gameType,
    playedAt: buildPlayedAt(v),
    sessionId: v.sessionId === '' ? null : v.sessionId,
    tags: v.tags.map((t) => t.trim()),
    note: v.note === '' ? null : v.note,
  }
}

/** 簡易備忘（detail 為 null）：摘要欄位為使用者輸入的備忘值（3.1） */
export function toSimpleInput(v: HandFormValues): HandInput {
  const hero = filled(v.heroCards)
  return {
    ...commonInput(v),
    detail: null,
    board: filled(v.board),
    bb: amountOrNull(v.bb),
    heroCards: hero.length === 2 ? hero : [],
    heroPosition: v.position === '' ? null : v.position,
    heroNet: simpleHeroNet(v),
  }
}

/** 完整模式（含暫存為簡易的未完成紀錄）：摘要欄位由 detail 推導（handRepo / finalizeHandContent） */
export function toCompleteInput(v: HandFormValues, stage: Exclude<CompleteStage, { step: 'setup' }>): HandInput {
  return { ...commonInput(v), detail: buildDetail(v, stage), board: confirmedBoard(v) }
}

// ---------------------------------------------------------------------------
// 編輯與補齊（5.8）
// ---------------------------------------------------------------------------

/** 由已儲存的公牌張數與行動還原 boardSteps（每條有行動的街各一步；其後多出的公牌為下一條街或自動發完） */
export function reconstructBoardSteps(actions: readonly Action[], boardLength: number): number[] {
  const steps: number[] = []
  for (const street of ['flop', 'turn', 'river'] as const) {
    if (actions.some((a) => a.street === street)) steps.push(boardCountFor(street))
  }
  const last = steps[steps.length - 1] ?? 0
  if (boardLength > last) steps.push(boardLength)
  return steps
}

/** 既有手牌轉為表單值（編輯模式）；簡易備忘的牌局設定欄位為預帶值（補齊時使用） */
export function handToValues(hand: Hand, lastHandSetup: HandSetup | undefined): HandFormValues {
  const minute = String(Number(hand.playedAt.slice(14, 16)))
  const base: HandFormValues = {
    ...createEntryValues({ now: new Date(), lastHandSetup, session: null, stake: null }),
    date: hand.playedAt.slice(0, 10),
    hour: String(Number(hand.playedAt.slice(11, 13))),
    minute,
    sessionId: hand.sessionId ?? '',
    gameType: hand.gameType,
    heroCards: [hand.heroCards[0] ?? null, hand.heroCards[1] ?? null],
    board: Array.from({ length: 5 }, (_, i) => hand.board[i] ?? null),
    tags: [...hand.tags],
    note: hand.note ?? '',
  }
  const d = hand.detail
  if (d === null) {
    const net = hand.heroNet
    return {
      ...base,
      ...setupDefaults(hand.gameType, lastHandSetup, null),
      mode: 'simple',
      position: hand.heroPosition ?? '',
      bb: hand.bb === null ? '' : String(hand.bb),
      result: net === null ? '' : net > 0 ? 'win' : net < 0 ? 'loss' : 'even',
      resultAmount: net === null || net === 0 ? '' : String(Math.abs(net)),
    }
  }
  const hero = d.seats.find((s) => s.seatNo === d.heroSeat)
  const defaultStack = String(hero?.stack ?? '')
  const seats: SeatValues[] = Array.from({ length: SEAT_ROWS }, (_, i) => {
    const seat = d.seats.find((s) => s.seatNo === i + 1)
    return seat ? { empty: false, stack: String(seat.stack), edited: true } : { empty: true, stack: defaultStack, edited: false }
  })
  const showdown: Record<string, ShowdownValues> = {}
  for (const s of d.seats) {
    if (s.seatNo === d.heroSeat || (s.cards.length === 0 && !s.mucked)) continue
    showdown[String(s.seatNo)] = { cards: [s.cards[0] ?? null, s.cards[1] ?? null], mucked: s.mucked }
  }
  return {
    ...base,
    mode: 'complete',
    tableSize: d.tableSize,
    sb: String(d.sb),
    setupBb: String(d.bb),
    ante: String(d.ante),
    straddle: d.straddle > 0,
    defaultStack,
    seats,
    buttonSeat: d.buttonSeat,
    heroSeat: d.heroSeat,
    setupDone: true,
    actions: d.actions.map((a) => ({ ...a })),
    boardSteps: reconstructBoardSteps(d.actions, hand.board.length),
    showdown,
    rake: String(d.rake),
  }
}

/**
 * 5.8 補齊為完整手牌：開啟完整模式步驟 1，預填時間、關聯場次、牌局類型、標籤、備註、你的手牌、大盲
 * （小盲 = 大盲 ÷ 2 四捨五入到 1，0.5 進位）、公牌（暫存）。有位置時依預設人數推算按鈕座位，推算不出時不預填（按鈕維持座位 1）。
 * 備忘的「結果」不預填。
 */
export function completeFromSimple(v: HandFormValues, lastHandSetup: HandSetup | undefined): HandFormValues {
  const bb = amountOrNull(v.bb)
  const blinds = bb !== null && bb > 0 ? { sb: Math.max(1, roundDivHalfUp(bb, 2)), bb } : null
  const setup = setupDefaults(v.gameType, lastHandSetup, blinds)
  let buttonSeat = setup.buttonSeat
  if (v.position !== '' && setup.heroSeat !== null) {
    const seatNos = Array.from({ length: setup.tableSize }, (_, i) => i + 1)
    buttonSeat = buttonSeatForPosition(seatNos, setup.heroSeat, v.position) ?? buttonSeat
  }
  return {
    ...v,
    ...setup,
    buttonSeat,
    mode: 'complete',
    setupDone: false,
    actions: [],
    boardSteps: [],
    showdown: {},
    rake: '0',
  }
}

/** 5.1 從「完整」切到「簡易」且已輸入行動時：捨棄牌局設定與行動（共用欄位保留） */
export function discardComplete(v: HandFormValues, entry: HandFormValues): HandFormValues {
  return {
    ...v,
    mode: 'simple',
    tableSize: entry.tableSize,
    sb: entry.sb,
    setupBb: entry.setupBb,
    ante: entry.ante,
    straddle: entry.straddle,
    defaultStack: entry.defaultStack,
    seats: entry.seats.map((s) => ({ ...s })),
    buttonSeat: entry.buttonSeat,
    heroSeat: entry.heroSeat,
    setupDone: false,
    actions: [],
    boardSteps: [],
    showdown: {},
    rake: entry.rake,
  }
}

// ---------------------------------------------------------------------------
// 5.7 草稿
// ---------------------------------------------------------------------------

export const HAND_DRAFT_VERSION = 1

const slotSchema = z.string().regex(CARD_RE).nullable()
const amountText = z.string().regex(/^[\d.]*$/)

const draftSchema = z.strictObject({
  version: z.literal(HAND_DRAFT_VERSION),
  values: z.strictObject({
    mode: z.enum(['simple', 'complete']),
    date: z.string(),
    hour: z.string().regex(/^(?:[0-9]|1[0-9]|2[0-3])$/),
    minute: z.string().regex(/^(?:[0-9]|[1-5][0-9])$/),
    sessionId: z.string(),
    gameType: z.enum(HAND_GAME_TYPES),
    heroCards: z.array(slotSchema).length(2),
    board: z.array(slotSchema).length(5),
    tags: z.array(z.string()).max(100),
    tagInput: z.string(),
    note: z.string(),
    position: z.union([z.literal(''), z.enum(POSITIONS)]),
    bb: amountText,
    result: z.enum(['', ...RESULT_CHOICES]),
    resultAmount: amountText,
    tableSize: z.int().min(2).max(MAX_TABLE_SIZE),
    sb: amountText,
    setupBb: amountText,
    ante: amountText,
    straddle: z.boolean(),
    defaultStack: amountText,
    seats: z.array(z.strictObject({ empty: z.boolean(), stack: amountText, edited: z.boolean() })).length(SEAT_ROWS),
    buttonSeat: z.int().min(1).max(MAX_TABLE_SIZE),
    heroSeat: z.int().min(1).max(MAX_TABLE_SIZE).nullable(),
    setupDone: z.boolean(),
    actions: z.array(actionSchema).max(200),
    boardSteps: z.array(z.int()).max(3),
    showdown: z.record(z.string().regex(/^\d+$/), z.strictObject({ cards: z.array(slotSchema).length(2), mucked: z.boolean() })),
    rake: amountText,
  }),
})

export type HandDraftData = z.infer<typeof draftSchema>

export function toHandDraft(v: HandFormValues): HandDraftData {
  return { version: HAND_DRAFT_VERSION, values: v }
}

/** 已確認的步驟（牌局設定、行動、公牌、攤牌）是否能完整重播並通過 3.9 結構驗證 */
function progressValid(v: HandFormValues): boolean {
  if (!v.setupDone) return v.actions.length === 0 && v.boardSteps.length === 0
  if (!parseSetup(v)) return false
  const steps = v.boardSteps
  if (steps.some((s, i) => ![3, 4, 5].includes(s) || (i > 0 && s <= steps[i - 1]!))) return false
  if (v.board.slice(0, boardDone(v)).some((c) => c === null)) return false
  const stage = deriveStage(v)
  if (stage.step === 'setup') return false
  return analyzeDetail(buildDetail(v, stage), confirmedBoard(v)).ok
}

/**
 * 解析 Settings.handDraft；格式不符回傳 null（丟棄草稿）。
 * 還原後若完整模式的行動不合法（例如行動重播失敗），捨棄行動部分、保留牌局設定（actionsDropped = true，5.7）。
 */
export function parseHandDraft(raw: unknown): { values: HandFormValues; actionsDropped: boolean } | null {
  const r = draftSchema.safeParse(raw)
  if (!r.success) return null
  const values = r.data.values as HandFormValues
  if (progressValid(values)) return { values, actionsDropped: false }
  return { values: clearActions(values), actionsDropped: true }
}

// ---------------------------------------------------------------------------
// 5.5「完整模式：行動」：下注 / 加注金額
// ---------------------------------------------------------------------------

/** 下注 / 加注的「到」金額檢查；合法時回傳 null（全下金額一律合法，即使不足最小金額，4.3） */
export function betAmountError(
  text: string,
  kind: 'bet' | 'raise',
  legal: Pick<LegalActions, 'maxTo' | 'currentBet' | 'minRaise'>,
  bb: number,
  unit: AmountUnit,
  gameType: HandGameType,
): string | null {
  const r = parseAmount(text)
  if (!r.ok) {
    if (r.reason === 'empty') return e.amountRequired
    if (r.reason === 'tooLarge') return e.amountTooLarge
    return gameType === 'tournament' ? e.tournamentInteger : e.cashInteger
  }
  const maxTo = legal.maxTo ?? 0
  if (r.value > maxTo) return e.exceedsStack(formatHandAmount(maxTo, unit))
  if (r.value === maxTo) return null
  if (kind === 'bet' && r.value < bb) return e.betTooSmall(formatHandAmount(bb, unit))
  const minRaiseTo = legal.currentBet + legal.minRaise
  if (kind === 'raise' && r.value < minRaiseTo) return e.raiseTooSmall(formatHandAmount(minRaiseTo, unit))
  return null
}
