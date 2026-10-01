// 第 3 節 schema 的共用基礎：自訂驗證代碼、字數計算、時間戳格式。
// 獨立成檔讓 v1 的 schemas.ts 與 v2 手牌的 hands/schemas.ts 都能引用，而不形成循環 import。
import { z } from 'zod'

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
  duplicateBackerName: 'duplicate_backer_name',
  backerShareTotalExceeded: 'backer_share_total_exceeded',
} as const

/** 字數以 Unicode code point 計算，emoji 算 1 字（A2） */
export function charCount(s: string): number {
  return Array.from(s).length
}

/** 含時區偏移的 ISO 8601（例 2026-09-28T21:05:00+08:00） */
export const timestampSchema = z.iso.datetime({ offset: true })
