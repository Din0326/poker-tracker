// 第 3 節（3.1–3.5）的資料驗證規則，以 Zod 集中定義。
// 寫入 DB 前（repository）與 P5 匯入備份共用同一套 schema。
// 注意：「開始時間不可是未來」屬第 5 節表單規則，刻意不放在這裡（A5）。
// 錯誤訊息一律用英文代碼（ISSUE），由 UI 依代碼對應 strings.ts 的文字。
import { z } from 'zod'
import {
  PROFIT_COLOR_SCHEMES,
  SESSION_TYPES,
  type BuyIn,
  type Session,
  type SettingKey,
  type Settings,
  type Stake,
  type Venue,
} from './types'

/** 金額上限（3.1、3.2） */
export const MAX_AMOUNT = 99_999_999
/** 時長上限：72 小時（3.1） */
export const MAX_DURATION_MIN = 4320
/** 錦標賽買入筆數上限（3.1） */
export const MAX_BUY_INS = 20
export const MAX_NAME_LENGTH = 50
export const MAX_NOTE_LENGTH = 500
export const MAX_VENUE_NAME_LENGTH = 30

/** 自訂驗證失敗的代碼（非 Zod 內建規則） */
export const ISSUE = {
  invalidStartAt: 'invalid_start_at',
  feeExceedsAmount: 'fee_exceeds_amount',
  cashBuyInCount: 'cash_requires_exactly_one_buy_in',
  cashStakeRequired: 'cash_requires_stake',
  stakeNotAllowed: 'stake_must_be_null',
  fieldSizeNotAllowed: 'field_size_must_be_null',
  finishPlaceNotAllowed: 'finish_place_must_be_null',
  finishPlaceRequiresFieldSize: 'finish_place_requires_field_size',
  finishPlaceExceedsFieldSize: 'finish_place_exceeds_field_size',
  notTrimmed: 'not_trimmed',
  emptyText: 'empty_text',
  textTooLong: 'text_too_long',
  bbLessThanSb: 'bb_less_than_sb',
} as const

/** 字數以 Unicode code point 計算，emoji 算 1 字（A2） */
export function charCount(s: string): number {
  return Array.from(s).length
}

const START_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/

/** startAt 是否為 `YYYY-MM-DDTHH:00` 且為合法日期時間（月份、日期、小時都要存在） */
export function isValidStartAt(value: string): boolean {
  const m = START_AT_RE.exec(value)
  if (!m) return false
  const [year, month, day, hour] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number]
  if (month < 1 || month > 12 || day < 1 || hour > 23) return false
  // 以 UTC 計算當月天數，避免受裝置時區（夏令時間）影響
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

const startAtSchema = z.string().refine(isValidStartAt, { message: ISSUE.invalidStartAt })

/** 含時區偏移的 ISO 8601（例 2026-09-28T21:05:00+08:00） */
export const timestampSchema = z.iso.datetime({ offset: true })

const amountSchema = z.int().min(1).max(MAX_AMOUNT)
const cashOutSchema = z.int().min(0).max(MAX_AMOUNT)

export const buyInSchema: z.ZodType<BuyIn> = z
  .strictObject({
    amount: amountSchema,
    fee: z.int().min(0).max(MAX_AMOUNT),
  })
  .refine((b) => b.fee <= b.amount, { message: ISSUE.feeExceedsAmount, path: ['fee'] })

/**
 * 選填文字欄位：必須是已正規化的值（A1）。
 * 未填存 null；有值時不可為空字串，長度以 code point 計（A2）。
 * trimmed 為 true 時另要求已去除前後空白（name）。
 */
function optionalText(max: number, trimmed: boolean) {
  return z
    .string()
    .superRefine((s, ctx) => {
      if (s === '') ctx.addIssue({ code: 'custom', message: ISSUE.emptyText })
      if (trimmed && s !== s.trim()) ctx.addIssue({ code: 'custom', message: ISSUE.notTrimmed })
      if (charCount(s) > max) ctx.addIssue({ code: 'custom', message: ISSUE.textTooLong })
    })
    .nullable()
}

export const sessionSchema: z.ZodType<Session> = z
  .strictObject({
    id: z.uuid(),
    type: z.enum(SESSION_TYPES),
    startAt: startAtSchema,
    durationMin: z.int().min(1).max(MAX_DURATION_MIN),
    buyIns: z.array(buyInSchema).min(1).max(MAX_BUY_INS),
    cashOut: cashOutSchema,
    stakeId: z.string().nullable(),
    venueId: z.string().nullable(),
    name: optionalText(MAX_NAME_LENGTH, true),
    note: optionalText(MAX_NOTE_LENGTH, false),
    fieldSize: z.int().min(2).nullable(),
    finishPlace: z.int().min(1).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((s, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: 'custom', message, path: [path] })
    if (s.type === 'cash') {
      if (s.buyIns.length !== 1) issue(ISSUE.cashBuyInCount, 'buyIns')
      if (s.stakeId === null || s.stakeId === '') issue(ISSUE.cashStakeRequired, 'stakeId')
    } else if (s.stakeId !== null) {
      issue(ISSUE.stakeNotAllowed, 'stakeId')
    }
    if (s.type === 'mtt') {
      if (s.finishPlace !== null) {
        if (s.fieldSize === null) issue(ISSUE.finishPlaceRequiresFieldSize, 'finishPlace')
        else if (s.finishPlace > s.fieldSize) issue(ISSUE.finishPlaceExceedsFieldSize, 'finishPlace')
      }
    } else {
      // fieldSize、finishPlace 僅標準 MTT 使用，其他類型必須為 null
      if (s.fieldSize !== null) issue(ISSUE.fieldSizeNotAllowed, 'fieldSize')
      if (s.finishPlace !== null) issue(ISSUE.finishPlaceNotAllowed, 'finishPlace')
    }
  })

export const venueSchema: z.ZodType<Venue> = z.strictObject({
  id: z.uuid(),
  // 名稱須已去除前後空白，1–30 字（code point）；重複檢查在 repository
  name: z.string().superRefine((s, ctx) => {
    if (s !== s.trim()) ctx.addIssue({ code: 'custom', message: ISSUE.notTrimmed })
    const n = charCount(s)
    if (n < 1) ctx.addIssue({ code: 'custom', message: ISSUE.emptyText })
    if (n > MAX_VENUE_NAME_LENGTH) ctx.addIssue({ code: 'custom', message: ISSUE.textTooLong })
  }),
  archived: z.boolean(),
  sortOrder: z.int(),
})

export const stakeSchema: z.ZodType<Stake> = z
  .strictObject({
    id: z.uuid(),
    sb: z.int().min(1),
    bb: z.int().min(1),
    archived: z.boolean(),
    sortOrder: z.int(),
  })
  .refine((s) => s.bb >= s.sb, { message: ISSUE.bbLessThanSb, path: ['bb'] })

/** 3.5 各 key 的值驗證 */
export const settingSchemas: { [K in SettingKey]: z.ZodType<Settings[K]> } = {
  lastType: z.enum(SESSION_TYPES),
  lastVenueByType: z.partialRecord(z.enum(SESSION_TYPES), z.string().nullable()),
  lastStakeId: z.string().min(1),
  lastBackupAt: timestampSchema,
  recordDraft: z.record(z.string(), z.unknown()),
  profitColorScheme: z.enum(PROFIT_COLOR_SCHEMES),
}
