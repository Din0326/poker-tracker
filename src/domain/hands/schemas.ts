// SPEC-v2-hands 3.1–3.6、3.10 的欄位規則（Zod）。寫入 DB 前（handRepo）與備份匯入（10.2）共用。
// 需要重播行動才能判斷的規則（3.9 結構驗證、kind 判定、摘要推導）在 summary.ts 的 verifyHand。
// 錯誤訊息一律用英文代碼（HAND_ISSUE / ISSUE），由 UI 依代碼對應 strings.ts 的文字。
import { z } from 'zod'
import { ISSUE, charCount, timestampSchema } from '../schemaBase'
import { CARD_RE, findDuplicateCard } from './cards'
import { deriveAmountUnit } from './summary'
import {
  ACTION_TYPES,
  AMOUNT_UNITS,
  HAND_GAME_TYPES,
  HAND_KINDS,
  HAND_SOURCES,
  POSITIONS,
  STREETS,
  type Action,
  type AmountUnit,
  type Card,
  type Collected,
  type Hand,
  type HandDetail,
  type HandSetup,
  type Seat,
} from './types'

/** 3.8 單一金額上限（依 amountUnit） */
export const MAX_AMOUNT_BY_UNIT: Readonly<Record<AmountUnit, number>> = {
  yuan: 99_999_999,
  cent: 9_999_999_900,
  chip: 99_999_999,
}
/** 各單位上限中的最大值（detail 內金額的型別上限；依單位的上限在 handSchema 檢查） */
const MAX_ANY_AMOUNT = MAX_AMOUNT_BY_UNIT.cent

/** 7.4 exportSeq 範圍 */
export const MAX_EXPORT_SEQ = 99_999_999_999_999
export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 20
export const MAX_HAND_NOTE_LENGTH = 1000
export const MAX_ACTIONS = 200
export const MIN_TABLE_SIZE = 2
export const MAX_TABLE_SIZE = 10
export const MAX_RAW_TEXT_LENGTH = 20_000
export const MAX_SOURCE_HAND_ID_LENGTH = 40

/** 手牌欄位規則的自訂代碼（非 Zod 內建規則） */
export const HAND_ISSUE = {
  invalidPlayedAt: 'invalid_played_at',
  manualSecondsNotZero: 'manual_seconds_not_zero',
  amountUnitMismatch: 'amount_unit_mismatch',
  amountExceedsUnitMax: 'amount_exceeds_unit_max',
  sourceFieldRequired: 'source_field_required',
  sourceFieldNotAllowed: 'source_field_not_allowed',
  invalidCardCount: 'invalid_card_count',
  invalidBoardCount: 'invalid_board_count',
  duplicateCard: 'duplicate_card',
  duplicateTag: 'duplicate_tag',
  invalidSourceHandId: 'invalid_source_hand_id',
  seatNotFound: 'seat_not_found',
  seatsNotSorted: 'seats_not_sorted',
  seatNoExceedsTableSize: 'seat_no_exceeds_table_size',
  tooManySeats: 'too_many_seats',
  invalidStraddle: 'invalid_straddle',
  straddleNeedsThreePlayers: 'straddle_needs_three_players',
  actionToRequired: 'action_to_required',
  actionToNotAllowed: 'action_to_not_allowed',
  tournamentRakeNotZero: 'tournament_rake_not_zero',
  collectedNotSorted: 'collected_not_sorted',
  invalidSeatName: 'invalid_seat_name',
  seatNameNotAllowed: 'seat_name_not_allowed',
  invalidHeroName: 'invalid_hero_name',
  heroNameReserved: 'hero_name_reserved',
} as const

const PLAYED_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/

/** playedAt 是否為 `YYYY-MM-DDTHH:mm:ss` 且為合法日期時間 */
export function isValidPlayedAt(value: string): boolean {
  const m = PLAYED_AT_RE.exec(value)
  if (!m) return false
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [number, number, number, number, number, number]
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 7.3 Seat.name 寫入條件：`^[A-Za-z0-9_]{1,20}$` 且不符合 `^villain\d+$`（不分大小寫） */
export const SEAT_NAME_RE = /^[A-Za-z0-9_]{1,20}$/
export const VILLAIN_NAME_RE = /^villain\d+$/i
/** 7.3 Hero 名稱：1–12 字元、英數字與底線、以英文字母開頭 */
export const HERO_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,11}$/
/** 3.1 sourceHandId：1–40 字元，僅英數字 */
const SOURCE_HAND_ID_RE = /^[A-Za-z0-9]{1,40}$/

export const cardSchema = z.string().regex(CARD_RE)

const amount = (min: number) => z.int().min(min).max(MAX_ANY_AMOUNT)

export const seatSchema: z.ZodType<Seat> = z.strictObject({
  seatNo: z.int().min(1).max(MAX_TABLE_SIZE),
  stack: amount(1),
  cards: z.array(cardSchema).refine((c) => c.length === 0 || c.length === 2, { message: HAND_ISSUE.invalidCardCount }),
  mucked: z.boolean(),
  name: z
    .string()
    .refine((s) => SEAT_NAME_RE.test(s) && !VILLAIN_NAME_RE.test(s), { message: HAND_ISSUE.invalidSeatName })
    .nullable(),
})

export const actionSchema: z.ZodType<Action> = z
  .strictObject({
    street: z.enum(STREETS),
    seatNo: z.int().min(1).max(MAX_TABLE_SIZE),
    type: z.enum(ACTION_TYPES),
    to: amount(1).nullable(),
  })
  .superRefine((a, ctx) => {
    const needsTo = a.type === 'bet' || a.type === 'raise'
    if (needsTo && a.to === null) ctx.addIssue({ code: 'custom', message: HAND_ISSUE.actionToRequired, path: ['to'] })
    if (!needsTo && a.to !== null) ctx.addIssue({ code: 'custom', message: HAND_ISSUE.actionToNotAllowed, path: ['to'] })
  })

export const collectedSchema: z.ZodType<Collected> = z.strictObject({
  seatNo: z.int().min(1).max(MAX_TABLE_SIZE),
  potIndex: z.int().min(0),
  amount: amount(1),
})

export const handDetailSchema: z.ZodType<HandDetail> = z
  .strictObject({
    tableSize: z.int().min(MIN_TABLE_SIZE).max(MAX_TABLE_SIZE),
    buttonSeat: z.int().min(1),
    heroSeat: z.int().min(1),
    sb: amount(1),
    bb: amount(1),
    ante: amount(0),
    straddle: amount(0),
    seats: z.array(seatSchema).min(2).max(MAX_TABLE_SIZE),
    actions: z.array(actionSchema).max(MAX_ACTIONS),
    rake: amount(0),
    collected: z.array(collectedSchema),
  })
  .superRefine((d, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
    if (d.bb < d.sb) issue(ISSUE.bbLessThanSb, ['bb'])
    if (d.straddle !== 0 && d.straddle !== 2 * d.bb) issue(HAND_ISSUE.invalidStraddle, ['straddle'])
    if (d.straddle > 0 && d.seats.length < 3) issue(HAND_ISSUE.straddleNeedsThreePlayers, ['straddle'])
    if (d.seats.length > d.tableSize) issue(HAND_ISSUE.tooManySeats, ['seats'])
    d.seats.forEach((s, i) => {
      if (s.seatNo > d.tableSize) issue(HAND_ISSUE.seatNoExceedsTableSize, ['seats', i, 'seatNo'])
      // 依 seatNo 由小到大排列且不重複
      if (i > 0 && s.seatNo <= d.seats[i - 1]!.seatNo) issue(HAND_ISSUE.seatsNotSorted, ['seats', i, 'seatNo'])
    })
    const seatNos = new Set(d.seats.map((s) => s.seatNo))
    if (!seatNos.has(d.buttonSeat)) issue(HAND_ISSUE.seatNotFound, ['buttonSeat'])
    if (!seatNos.has(d.heroSeat)) issue(HAND_ISSUE.seatNotFound, ['heroSeat'])
    d.actions.forEach((a, i) => {
      if (!seatNos.has(a.seatNo)) issue(HAND_ISSUE.seatNotFound, ['actions', i, 'seatNo'])
    })
    // 3.5：同一 seatNo 與 potIndex 組合最多一筆；依 potIndex、再依 seatNo 由小到大（嚴格遞增即同時保證不重複）
    d.collected.forEach((c, i) => {
      if (!seatNos.has(c.seatNo)) issue(HAND_ISSUE.seatNotFound, ['collected', i, 'seatNo'])
      const prev = d.collected[i - 1]
      if (prev && (c.potIndex < prev.potIndex || (c.potIndex === prev.potIndex && c.seatNo <= prev.seatNo))) {
        issue(HAND_ISSUE.collectedNotSorted, ['collected', i])
      }
    })
  })

/** 3.1 tags：0–10 個；每個已去除前後空白、1–20 字；不分大小寫不可重複 */
const tagsSchema = z
  .array(
    z.string().superRefine((s, ctx) => {
      if (s !== s.trim()) ctx.addIssue({ code: 'custom', message: ISSUE.notTrimmed })
      const n = charCount(s)
      if (n < 1) ctx.addIssue({ code: 'custom', message: ISSUE.emptyText })
      if (n > MAX_TAG_LENGTH) ctx.addIssue({ code: 'custom', message: ISSUE.textTooLong })
    }),
  )
  .max(MAX_TAGS)
  .superRefine((tags, ctx) => {
    const seen = new Set<string>()
    tags.forEach((t, i) => {
      const key = t.trim().toLowerCase()
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: HAND_ISSUE.duplicateTag, path: [i] })
      seen.add(key)
    })
  })

/** 選填文字：未填為 null；有值時不可為空字串，長度以 code point 計 */
function optionalText(max: number) {
  return z
    .string()
    .superRefine((s, ctx) => {
      if (s === '') ctx.addIssue({ code: 'custom', message: ISSUE.emptyText })
      if (charCount(s) > max) ctx.addIssue({ code: 'custom', message: ISSUE.textTooLong })
    })
    .nullable()
}

/** detail 內所有金額欄位與路徑（3.2 的單一金額上限檢查用） */
function detailAmounts(d: HandDetail): { value: number; path: (string | number)[] }[] {
  const out: { value: number; path: (string | number)[] }[] = [
    { value: d.sb, path: ['detail', 'sb'] },
    { value: d.bb, path: ['detail', 'bb'] },
    { value: d.ante, path: ['detail', 'ante'] },
    { value: d.straddle, path: ['detail', 'straddle'] },
    { value: d.rake, path: ['detail', 'rake'] },
  ]
  d.seats.forEach((s, i) => out.push({ value: s.stack, path: ['detail', 'seats', i, 'stack'] }))
  d.actions.forEach((a, i) => {
    if (a.to !== null) out.push({ value: a.to, path: ['detail', 'actions', i, 'to'] })
  })
  d.collected.forEach((c, i) => out.push({ value: c.amount, path: ['detail', 'collected', i, 'amount'] }))
  return out
}

export const handSchema: z.ZodType<Hand> = z
  .strictObject({
    id: z.uuid(),
    exportSeq: z.int().min(1).max(MAX_EXPORT_SEQ),
    kind: z.enum(HAND_KINDS),
    source: z.enum(HAND_SOURCES),
    gameType: z.enum(HAND_GAME_TYPES),
    amountUnit: z.enum(AMOUNT_UNITS),
    sessionId: z.string().min(1).nullable(),
    playedAt: z.string().refine(isValidPlayedAt, { message: HAND_ISSUE.invalidPlayedAt }),
    bb: amount(1).nullable(),
    heroCards: z.array(cardSchema).refine((c) => c.length === 0 || c.length === 2, { message: HAND_ISSUE.invalidCardCount }),
    heroPosition: z.enum(POSITIONS).nullable(),
    board: z.array(cardSchema).refine((c) => [0, 3, 4, 5].includes(c.length), { message: HAND_ISSUE.invalidBoardCount }),
    heroNet: z.int().nullable(),
    detail: handDetailSchema.nullable(),
    tags: tagsSchema,
    note: optionalText(MAX_HAND_NOTE_LENGTH),
    sourceHandId: z.string().nullable(),
    rawText: z.string().nullable(),
    parserVersion: z.int().min(1).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((h, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
    // 3.8：amountUnit 必須等於推導結果
    if (h.amountUnit !== deriveAmountUnit(h.source, h.gameType)) issue(HAND_ISSUE.amountUnitMismatch, ['amountUnit'])
    const max = MAX_AMOUNT_BY_UNIT[h.amountUnit]
    if (h.bb !== null && h.bb > max) issue(HAND_ISSUE.amountExceedsUnitMax, ['bb'])
    // 無 detail 時 heroNet 為備忘值：絕對值 ≤ 單一金額上限；有 detail 時由 4.9 計算（verifyHand 檢查）
    if (h.detail === null && h.heroNet !== null && Math.abs(h.heroNet) > max) issue(HAND_ISSUE.amountExceedsUnitMax, ['heroNet'])
    if (h.detail) {
      for (const a of detailAmounts(h.detail)) if (a.value > max) issue(HAND_ISSUE.amountExceedsUnitMax, a.path)
      // 3.2：錦標賽 rake 必須為 0
      if (h.gameType === 'tournament' && h.detail.rake !== 0) issue(HAND_ISSUE.tournamentRakeNotZero, ['detail', 'rake'])
    }

    // 3.1：source 決定 sourceHandId / rawText / parserVersion 是否必填
    if (h.source === 'manual') {
      for (const key of ['sourceHandId', 'rawText', 'parserVersion'] as const) {
        if (h[key] !== null) issue(HAND_ISSUE.sourceFieldNotAllowed, [key])
      }
      // 3.1：手動紀錄秒數固定 00
      if (isValidPlayedAt(h.playedAt) && !h.playedAt.endsWith(':00')) issue(HAND_ISSUE.manualSecondsNotZero, ['playedAt'])
      // 3.3：Seat.name 手動紀錄為 null
      h.detail?.seats.forEach((s, i) => {
        if (s.name !== null) issue(HAND_ISSUE.seatNameNotAllowed, ['detail', 'seats', i, 'name'])
      })
    } else {
      if (h.sourceHandId === null) issue(HAND_ISSUE.sourceFieldRequired, ['sourceHandId'])
      else if (!SOURCE_HAND_ID_RE.test(h.sourceHandId)) issue(HAND_ISSUE.invalidSourceHandId, ['sourceHandId'])
      if (h.rawText === null) issue(HAND_ISSUE.sourceFieldRequired, ['rawText'])
      else if (h.rawText === '') issue(ISSUE.emptyText, ['rawText'])
      else if (charCount(h.rawText) > MAX_RAW_TEXT_LENGTH) issue(ISSUE.textTooLong, ['rawText'])
      if (h.parserVersion === null) issue(HAND_ISSUE.sourceFieldRequired, ['parserVersion'])
    }

    // 3.6：同一手牌內 heroCards、board、所有 Seat.cards 合計不得有重複的牌
    const others: Card[] = h.detail ? h.detail.seats.filter((s) => s.seatNo !== h.detail!.heroSeat).flatMap((s) => s.cards) : []
    const heroSeatCards = h.detail?.seats.find((s) => s.seatNo === h.detail!.heroSeat)?.cards ?? []
    if (
      findDuplicateCard([...h.heroCards, ...h.board, ...others]) !== null ||
      findDuplicateCard([...heroSeatCards, ...h.board, ...others]) !== null
    ) {
      issue(HAND_ISSUE.duplicateCard, ['board'])
    }
  })

/** 7.3 匯出名稱（Settings.handHeroName） */
export const handHeroNameSchema = z.string().superRefine((s, ctx) => {
  if (!HERO_NAME_RE.test(s)) ctx.addIssue({ code: 'custom', message: HAND_ISSUE.invalidHeroName })
  else if (VILLAIN_NAME_RE.test(s)) ctx.addIssue({ code: 'custom', message: HAND_ISSUE.heroNameReserved })
})

/** 3.10 lastHandSetup（金額單位依 gameType 為元或籌碼，上限同 3.8） */
export const handSetupSchema: z.ZodType<HandSetup> = z
  .strictObject({
    gameType: z.enum(HAND_GAME_TYPES),
    tableSize: z.int().min(MIN_TABLE_SIZE).max(MAX_TABLE_SIZE),
    sb: z.int().min(1).max(MAX_AMOUNT_BY_UNIT.yuan),
    bb: z.int().min(1).max(MAX_AMOUNT_BY_UNIT.yuan),
    ante: z.int().min(0).max(MAX_AMOUNT_BY_UNIT.yuan),
    straddle: z.int().min(0).max(MAX_AMOUNT_BY_UNIT.yuan),
    defaultStack: z.int().min(1).max(MAX_AMOUNT_BY_UNIT.yuan),
    heroSeat: z.int().min(1).max(MAX_TABLE_SIZE),
  })
  .superRefine((s, ctx) => {
    if (s.bb < s.sb) ctx.addIssue({ code: 'custom', message: ISSUE.bbLessThanSb, path: ['bb'] })
    if (s.straddle !== 0 && s.straddle !== 2 * s.bb) ctx.addIssue({ code: 'custom', message: HAND_ISSUE.invalidStraddle, path: ['straddle'] })
    if (s.heroSeat > s.tableSize) ctx.addIssue({ code: 'custom', message: HAND_ISSUE.seatNoExceedsTableSize, path: ['heroSeat'] })
  })

/** 3.10 lastHandSeq：最後一次配發的 exportSeq（0 = 尚未配發） */
export const lastHandSeqSchema = z.int().min(0).max(MAX_EXPORT_SEQ)
