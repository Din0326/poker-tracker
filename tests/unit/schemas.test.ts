import { describe, expect, it } from 'vitest'
import {
  ISSUE,
  charCount,
  isValidStartAt,
  sessionSchema,
  settingSchemas,
  stakeSchema,
  venueSchema,
} from '../../src/domain/schemas'
import type { Session } from '../../src/domain/types'
import { makeSession, testUuid } from './helpers/fixtures'

function ok(s: unknown): boolean {
  return sessionSchema.safeParse(s).success
}

function messages(s: unknown): string[] {
  const r = sessionSchema.safeParse(s)
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

describe('3.1 Session schema', () => {
  it('合法的三種類型場次通過', () => {
    expect(ok(makeSession({ type: 'cash' }))).toBe(true)
    expect(ok(makeSession({ type: 'mtt', fieldSize: 100, finishPlace: 1 }))).toBe(true)
    expect(ok(makeSession({ type: 'timed_mtt' }))).toBe(true)
  })

  it('id 必須是 UUID', () => {
    expect(ok(makeSession({ id: 'not-a-uuid' }))).toBe(false)
    expect(ok(makeSession({ id: crypto.randomUUID() }))).toBe(true)
  })

  it('type 只能是 cash / mtt / timed_mtt', () => {
    expect(ok({ ...makeSession(), type: 'sng' })).toBe(false)
  })

  it('startAt 必須為 YYYY-MM-DDTHH:00 且為合法日期時間', () => {
    for (const v of ['2026-09-27T20:00', '2024-02-29T00:00', '2026-12-31T23:00']) {
      expect(isValidStartAt(v), v).toBe(true)
      expect(ok(makeSession({ startAt: v })), v).toBe(true)
    }
    for (const v of [
      '2026-09-27T20:30', // 分鐘不是 00
      '2026-09-27T24:00', // 小時超過 23
      '2026-02-29T10:00', // 非閏年
      '2026-13-01T10:00', // 月份不存在
      '2026-04-31T10:00', // 日期不存在
      '2026-00-10T10:00',
      '2026-09-27 20:00',
      '2026-09-27T20:00:00',
      '2026-9-27T20:00',
      '2026-09-27T20:00+08:00',
    ]) {
      expect(isValidStartAt(v), v).toBe(false)
      expect(ok(makeSession({ startAt: v })), v).toBe(false)
    }
  })

  it('startAt 可以是未來時間（A5：未來檢查屬表單規則）', () => {
    expect(ok(makeSession({ startAt: '2099-01-01T00:00' }))).toBe(true)
  })

  it('durationMin 為整數 1–4320', () => {
    expect(ok(makeSession({ durationMin: 1 }))).toBe(true)
    expect(ok(makeSession({ durationMin: 4320 }))).toBe(true)
    expect(ok(makeSession({ durationMin: 0 }))).toBe(false)
    expect(ok(makeSession({ durationMin: 4321 }))).toBe(false)
    expect(ok(makeSession({ durationMin: 60.5 }))).toBe(false)
  })

  it('buyIns：cash 恰 1 筆', () => {
    expect(ok(makeSession({ type: 'cash', buyIns: [] }))).toBe(false)
    const two = [
      { amount: 100, fee: 0 },
      { amount: 100, fee: 0 },
    ]
    expect(messages(makeSession({ type: 'cash', buyIns: two }))).toContain(ISSUE.cashBuyInCount)
  })

  it('buyIns：mtt / timed_mtt 1–20 筆', () => {
    const n = (k: number) => Array.from({ length: k }, () => ({ amount: 100, fee: 0 }))
    for (const type of ['mtt', 'timed_mtt'] as const) {
      expect(ok(makeSession({ type, buyIns: n(1) }))).toBe(true)
      expect(ok(makeSession({ type, buyIns: n(20) }))).toBe(true)
      expect(ok(makeSession({ type, buyIns: n(0) }))).toBe(false)
      expect(ok(makeSession({ type, buyIns: n(21) }))).toBe(false)
    }
  })

  it('BuyIn.amount 為整數 1–99,999,999；fee 為整數 0 ≤ fee ≤ amount', () => {
    const b = (amount: number, fee: number) => makeSession({ buyIns: [{ amount, fee }] })
    expect(ok(b(1, 0))).toBe(true)
    expect(ok(b(99_999_999, 0))).toBe(true)
    expect(ok(b(0, 0))).toBe(false)
    expect(ok(b(100_000_000, 0))).toBe(false)
    expect(ok(b(100.5, 0))).toBe(false)
    expect(ok(b(100, 100))).toBe(true)
    expect(messages(b(100, 101))).toContain(ISSUE.feeExceedsAmount)
    expect(ok(b(100, -1))).toBe(false)
    expect(ok(b(100, 1.5))).toBe(false)
  })

  it('cashOut 為整數 0–99,999,999', () => {
    expect(ok(makeSession({ cashOut: 0 }))).toBe(true)
    expect(ok(makeSession({ cashOut: 99_999_999 }))).toBe(true)
    expect(ok(makeSession({ cashOut: -1 }))).toBe(false)
    expect(ok(makeSession({ cashOut: 100_000_000 }))).toBe(false)
    expect(ok(makeSession({ cashOut: 1.5 }))).toBe(false)
  })

  it('stakeId：cash 必須為非空字串，mtt / timed_mtt 必須為 null', () => {
    expect(messages(makeSession({ type: 'cash', stakeId: null }))).toContain(ISSUE.cashStakeRequired)
    expect(messages(makeSession({ type: 'cash', stakeId: '' }))).toContain(ISSUE.cashStakeRequired)
    expect(messages(makeSession({ type: 'mtt', stakeId: 'x' }))).toContain(ISSUE.stakeNotAllowed)
    expect(messages(makeSession({ type: 'timed_mtt', stakeId: 'x' }))).toContain(ISSUE.stakeNotAllowed)
  })

  it('venueId 為 string 或 null', () => {
    expect(ok(makeSession({ venueId: 'v1' }))).toBe(true)
    expect(ok(makeSession({ venueId: null }))).toBe(true)
    expect(ok({ ...makeSession(), venueId: 1 })).toBe(false)
  })

  it('fieldSize、finishPlace 僅 mtt 使用，其他類型必須為 null', () => {
    expect(messages(makeSession({ type: 'cash', fieldSize: 10 }))).toContain(ISSUE.fieldSizeNotAllowed)
    expect(messages(makeSession({ type: 'timed_mtt', fieldSize: 10 }))).toContain(ISSUE.fieldSizeNotAllowed)
    expect(messages(makeSession({ type: 'timed_mtt', fieldSize: 10, finishPlace: 1 }))).toContain(
      ISSUE.finishPlaceNotAllowed,
    )
  })

  it('fieldSize ≥ 2；只填 fieldSize 允許', () => {
    expect(ok(makeSession({ type: 'mtt', fieldSize: 2 }))).toBe(true)
    expect(ok(makeSession({ type: 'mtt', fieldSize: 1 }))).toBe(false)
    expect(ok(makeSession({ type: 'mtt', fieldSize: 2.5 }))).toBe(false)
  })

  it('填 finishPlace 必須同時填 fieldSize，且 1 ≤ finishPlace ≤ fieldSize', () => {
    expect(messages(makeSession({ type: 'mtt', finishPlace: 1 }))).toContain(ISSUE.finishPlaceRequiresFieldSize)
    expect(ok(makeSession({ type: 'mtt', fieldSize: 100, finishPlace: 100 }))).toBe(true)
    expect(messages(makeSession({ type: 'mtt', fieldSize: 100, finishPlace: 101 }))).toContain(
      ISSUE.finishPlaceExceedsFieldSize,
    )
    expect(ok(makeSession({ type: 'mtt', fieldSize: 100, finishPlace: 0 }))).toBe(false)
  })

  it('name：null 或已去除前後空白的 1–50 字（code point，emoji 算 1 字）', () => {
    expect(ok(makeSession({ name: null }))).toBe(true)
    expect(ok(makeSession({ name: 'a'.repeat(50) }))).toBe(true)
    expect(ok(makeSession({ name: '😀'.repeat(50) }))).toBe(true)
    expect(messages(makeSession({ name: 'a'.repeat(51) }))).toContain(ISSUE.textTooLong)
    expect(messages(makeSession({ name: '' }))).toContain(ISSUE.emptyText)
    expect(messages(makeSession({ name: ' abc ' }))).toContain(ISSUE.notTrimmed)
  })

  it('note：null 或 1–500 字，原樣保留（可含前後空白與換行）', () => {
    expect(ok(makeSession({ note: ' line1\nline2 ' }))).toBe(true)
    expect(ok(makeSession({ note: '字'.repeat(500) }))).toBe(true)
    expect(ok(makeSession({ note: '😀'.repeat(500) }))).toBe(true)
    expect(messages(makeSession({ note: '字'.repeat(501) }))).toContain(ISSUE.textTooLong)
    expect(messages(makeSession({ note: '' }))).toContain(ISSUE.emptyText)
  })

  it('charCount 以 code point 計算', () => {
    expect(charCount('😀')).toBe(1)
    expect('😀'.length).toBe(2)
    expect(charCount('德州a')).toBe(3)
  })

  it('createdAt / updatedAt 為含時區偏移的 ISO 8601', () => {
    expect(ok(makeSession({ createdAt: '2026-09-28T21:05:00+08:00' }))).toBe(true)
    expect(ok(makeSession({ updatedAt: '2026-09-28T13:05:00Z' }))).toBe(true)
    expect(ok(makeSession({ createdAt: '2026-09-28T21:05:00' }))).toBe(false)
    expect(ok(makeSession({ createdAt: '2026-09-28' }))).toBe(false)
    expect(ok(makeSession({ updatedAt: 'yesterday' }))).toBe(false)
  })

  it('不接受未定義的欄位、缺少必填欄位', () => {
    expect(ok({ ...makeSession(), extra: 1 })).toBe(false)
    const { note: _note, ...missing } = makeSession()
    void _note
    expect(ok(missing)).toBe(false)
    expect(ok({ ...makeSession(), name: undefined } as unknown as Session)).toBe(false)
  })
})

describe('3.3 Venue schema', () => {
  const v = (name: string) => ({ id: testUuid(), name, archived: false, sortOrder: 0 })
  it('name 去除前後空白後 1–30 字', () => {
    expect(venueSchema.safeParse(v('6bet')).success).toBe(true)
    expect(venueSchema.safeParse(v('a'.repeat(30))).success).toBe(true)
    expect(venueSchema.safeParse(v('😀'.repeat(30))).success).toBe(true)
    expect(venueSchema.safeParse(v('a'.repeat(31))).success).toBe(false)
    expect(venueSchema.safeParse(v('')).success).toBe(false)
    expect(venueSchema.safeParse(v(' 6bet')).success).toBe(false)
  })
  it('archived 為 boolean、sortOrder 為整數', () => {
    expect(venueSchema.safeParse({ ...v('a'), archived: 'no' }).success).toBe(false)
    expect(venueSchema.safeParse({ ...v('a'), sortOrder: 1.5 }).success).toBe(false)
    expect(venueSchema.safeParse({ ...v('a'), sortOrder: -3 }).success).toBe(true)
  })
})

describe('3.4 Stake schema', () => {
  const s = (sb: number, bb: number) => ({ id: testUuid(), sb, bb, archived: false, sortOrder: 0 })
  it('sb 為整數 ≥ 1、bb 為整數 ≥ sb', () => {
    expect(stakeSchema.safeParse(s(50, 100)).success).toBe(true)
    expect(stakeSchema.safeParse(s(1, 1)).success).toBe(true)
    expect(stakeSchema.safeParse(s(0, 100)).success).toBe(false)
    expect(stakeSchema.safeParse(s(100, 50)).success).toBe(false)
    expect(stakeSchema.safeParse(s(1.5, 3)).success).toBe(false)
  })
})

describe('3.5 Settings schema', () => {
  it('各 key 的型別', () => {
    expect(settingSchemas.lastType.safeParse('mtt').success).toBe(true)
    expect(settingSchemas.lastType.safeParse('poker').success).toBe(false)
    expect(settingSchemas.lastVenueByType.safeParse({ cash: 'v1', mtt: null }).success).toBe(true)
    expect(settingSchemas.lastVenueByType.safeParse({}).success).toBe(true)
    expect(settingSchemas.lastVenueByType.safeParse({ sng: 'v1' }).success).toBe(false)
    expect(settingSchemas.lastStakeId.safeParse('s1').success).toBe(true)
    expect(settingSchemas.lastBackupAt.safeParse('2026-09-28T21:05:00+08:00').success).toBe(true)
    expect(settingSchemas.lastBackupAt.safeParse('2026-09-28').success).toBe(false)
    expect(settingSchemas.recordDraft.safeParse({ any: 1 }).success).toBe(true)
    expect(settingSchemas.recordDraft.safeParse('draft').success).toBe(false)
    expect(settingSchemas.profitColorScheme.safeParse('greenGain').success).toBe(true)
    expect(settingSchemas.profitColorScheme.safeParse('blue').success).toBe(false)
  })
})
