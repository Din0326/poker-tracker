import { describe, expect, it } from 'vitest'
import { formatMarkup, formatPermille, markupNumber, permilleNumber } from '../../src/domain/format'
import { ISSUE, backerSchema, sessionSchema } from '../../src/domain/schemas'
import { backerPay, backerPayout, roundDivHalfUp, stakingBreakdown } from '../../src/domain/session'
import {
  backerNameHistory,
  decimalToScaledInt,
  filterBackerSuggestions,
  parseMarkupInput,
  parseShareInput,
  sanitizeDecimal,
} from '../../src/domain/staking'
import type { Backer } from '../../src/domain/types'
import { makeSession } from './helpers/fixtures'

// 4.6 整數運算捨入、3.8 Backer 驗證、5.3 比例 / 倍數輸入轉換與名稱建議

describe('4.6 roundDivHalfUp（整數運算的四捨五入）', () => {
  it('q = ⌊N ÷ D⌋、r = N − qD，2r ≥ D 時進位', () => {
    expect(roundDivHalfUp(0, 1000)).toBe(0)
    expect(roundDivHalfUp(499, 1000)).toBe(0)
    expect(roundDivHalfUp(500, 1000)).toBe(1)
    expect(roundDivHalfUp(1500, 1000)).toBe(2)
    expect(roundDivHalfUp(2499, 1000)).toBe(2)
    expect(roundDivHalfUp(241_500_000, 1_000_000)).toBe(242)
  })

  it('3.8 上限的最大乘積（≈ 6.0 × 10¹⁵）仍精確', () => {
    // 買入總額上限 1,999,999,980 × 1000 × 3000
    const n = 1_999_999_980 * 1000 * 3000
    expect(Number.isSafeInteger(n)).toBe(true)
    expect(roundDivHalfUp(n, 1_000_000)).toBe(5_999_999_940)
    // 餘數為 D − 1（浮點除法可能進位成整數）時仍正確捨去
    expect(roundDivHalfUp(5_999_999_940 * 1_000_000 + 499_999, 1_000_000)).toBe(5_999_999_940)
    expect(roundDivHalfUp(5_999_999_940 * 1_000_000 + 999_999, 1_000_000)).toBe(5_999_999_941)
  })

  it('兩條帳永遠成立：出資者付款合計 + 你的成本 = 買入總額；分走獎金合計 + 你的到手 = cashOut', () => {
    const backers: Backer[] = [
      { name: 'A', sharePermille: 333, markupPermille: 1150 },
      { name: 'B', sharePermille: 167, markupPermille: 1333 },
      { name: 'C', sharePermille: 1, markupPermille: 3000 },
    ]
    for (const [buyIn, cashOut] of [
      [1, 1],
      [1005, 2005],
      [99_999_999, 0],
      [12345, 67891],
    ] as const) {
      const b = stakingBreakdown(makeSession({ type: 'mtt', stakeId: null, buyIns: [{ amount: buyIn, fee: 0 }], cashOut, backers }))
      expect(b.payTotal + b.myCost).toBe(buyIn)
      expect(b.payoutTotal + b.myCashOut).toBe(cashOut)
      expect(b.myProfit).toBe(b.myCashOut - b.myCost)
    }
  })

  it('12.3 已知極端情況：cashOut 1、兩位各 50% 時 Σpayout = 2、你的到手 −1（照實顯示）', () => {
    const b = stakingBreakdown(
      makeSession({
        type: 'mtt',
        stakeId: null,
        cashOut: 1,
        backers: [
          { name: 'A', sharePermille: 500, markupPermille: 1000 },
          { name: 'B', sharePermille: 500, markupPermille: 1000 },
        ],
      }),
    )
    expect(b.payoutTotal).toBe(2)
    expect(b.myCashOut).toBe(-1)
  })

  it('backerPay / backerPayout 以整數運算，結果為整數', () => {
    expect(backerPay(10000, { sharePermille: 125, markupPermille: 1150 })).toBe(1438) // 1437.5 → 1438
    expect(backerPayout(999, { sharePermille: 125 })).toBe(125) // 124.875 → 125
  })
})

describe('3.8 Backer schema 與 Session.backers', () => {
  const ok = (b: unknown) => backerSchema.safeParse(b).success
  it('名稱去除前後空白後 1–20 字；比例 1–1000；倍數 1000–3000；皆為整數', () => {
    expect(ok({ name: 'A', sharePermille: 1, markupPermille: 1000 })).toBe(true)
    expect(ok({ name: '一二三四五六七八九十一二三四五六七八九十', sharePermille: 1000, markupPermille: 3000 })).toBe(true)
    expect(ok({ name: '一二三四五六七八九十一二三四五六七八九十一', sharePermille: 100, markupPermille: 1000 })).toBe(false)
    expect(ok({ name: '', sharePermille: 100, markupPermille: 1000 })).toBe(false)
    expect(ok({ name: ' A', sharePermille: 100, markupPermille: 1000 })).toBe(false)
    expect(ok({ name: 'A', sharePermille: 0, markupPermille: 1000 })).toBe(false)
    expect(ok({ name: 'A', sharePermille: 1001, markupPermille: 1000 })).toBe(false)
    expect(ok({ name: 'A', sharePermille: 12.5, markupPermille: 1000 })).toBe(false)
    expect(ok({ name: 'A', sharePermille: 100, markupPermille: 999 })).toBe(false)
    expect(ok({ name: 'A', sharePermille: 100, markupPermille: 3001 })).toBe(false)
    expect(ok({ name: 'A', sharePermille: 100, markupPermille: 1.15 })).toBe(false)
    expect(ok({ name: 'A', sharePermille: 100, markupPermille: 1000, id: 'x' })).toBe(false)
  })

  it('backers 必須存在（不得為 null 或省略）、0–10 筆、同場名稱不分大小寫不可重複、比例合計 ≤ 1000', () => {
    const s = makeSession()
    expect(sessionSchema.safeParse(s).success).toBe(true)
    const withoutBackers: Record<string, unknown> = { ...s }
    delete withoutBackers.backers
    expect(sessionSchema.safeParse(withoutBackers).success).toBe(false)
    expect(sessionSchema.safeParse({ ...s, backers: null }).success).toBe(false)
    const b = (name: string, share = 100): Backer => ({ name, sharePermille: share, markupPermille: 1000 })
    expect(sessionSchema.safeParse({ ...s, backers: Array.from({ length: 10 }, (_, i) => b(`N${i}`, 100)) }).success).toBe(true)
    expect(sessionSchema.safeParse({ ...s, backers: Array.from({ length: 11 }, (_, i) => b(`N${i}`, 1)) }).success).toBe(false)
    const dup = sessionSchema.safeParse({ ...s, backers: [b('Alice'), b('alice')] })
    expect(dup.success).toBe(false)
    expect(dup.error?.issues[0]).toMatchObject({ message: ISSUE.duplicateBackerName, path: ['backers', 1, 'name'] })
    expect(sessionSchema.safeParse({ ...s, backers: [b('A', 600), b('B', 400)] }).success).toBe(true)
    const over = sessionSchema.safeParse({ ...s, backers: [b('A', 600), b('B', 401)] })
    expect(over.error?.issues[0]).toMatchObject({ message: ISSUE.backerShareTotalExceeded, path: ['backers'] })
  })
})

describe('5.3 比例 / 倍數輸入', () => {
  it('sanitizeDecimal：只保留數字與第一個小數點；移除 %、×、x、X、空白', () => {
    expect(sanitizeDecimal('12.5%')).toBe('12.5')
    expect(sanitizeDecimal(' 30 % ')).toBe('30')
    expect(sanitizeDecimal('×1.15')).toBe('1.15')
    expect(sanitizeDecimal('x1.2')).toBe('1.2')
    expect(sanitizeDecimal('X1.2')).toBe('1.2')
    expect(sanitizeDecimal('1.2.3')).toBe('1.23')
    expect(sanitizeDecimal('abc')).toBe('')
  })

  it('字串轉成儲存值精確：「12.5」→ 125、「1.15」→ 1150（不經浮點相乘）', () => {
    expect(decimalToScaledInt('12.5', 1)).toBe(125)
    expect(decimalToScaledInt('1.15', 3)).toBe(1150)
    expect(decimalToScaledInt('0.1', 1)).toBe(1)
    expect(decimalToScaledInt('1.005', 3)).toBe(1005)
    expect(decimalToScaledInt('2.675', 3)).toBe(2675)
    expect(decimalToScaledInt('12.', 1)).toBe(120)
    expect(decimalToScaledInt('.5', 1)).toBe(5)
    expect(decimalToScaledInt('.', 1)).toBeNull()
    expect(decimalToScaledInt('1.25', 1)).toBeNull()
  })

  it('parseShareInput：空白或 0 → empty；超過 1 位小數 → format；大於 100 → range', () => {
    expect(parseShareInput('12.5')).toEqual({ ok: true, value: 125 })
    expect(parseShareInput('100')).toEqual({ ok: true, value: 1000 })
    expect(parseShareInput('0.1')).toEqual({ ok: true, value: 1 })
    expect(parseShareInput('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseShareInput('0')).toEqual({ ok: false, reason: 'empty' })
    expect(parseShareInput('0.0')).toEqual({ ok: false, reason: 'empty' })
    expect(parseShareInput('12.55')).toEqual({ ok: false, reason: 'format' })
    expect(parseShareInput('.')).toEqual({ ok: false, reason: 'format' })
    expect(parseShareInput('100.1')).toEqual({ ok: false, reason: 'range' })
  })

  it('parseMarkupInput：空白 → empty；超過 3 位小數 → format；小於 1.0 或大於 3.0 → range', () => {
    expect(parseMarkupInput('1.0')).toEqual({ ok: true, value: 1000 })
    expect(parseMarkupInput('1.15')).toEqual({ ok: true, value: 1150 })
    expect(parseMarkupInput('3')).toEqual({ ok: true, value: 3000 })
    expect(parseMarkupInput('1.125')).toEqual({ ok: true, value: 1125 })
    expect(parseMarkupInput('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseMarkupInput('1.1255')).toEqual({ ok: false, reason: 'format' })
    expect(parseMarkupInput('0.9')).toEqual({ ok: false, reason: 'range' })
    expect(parseMarkupInput('3.001')).toEqual({ ok: false, reason: 'range' })
  })

  it('儲存值轉回表單字串（編輯、複製）：125 → 12.5、300 → 30、1150 → 1.15、1000 → 1.0', () => {
    expect(permilleNumber(125)).toBe('12.5')
    expect(permilleNumber(300)).toBe('30')
    expect(markupNumber(1150)).toBe('1.15')
    expect(markupNumber(1000)).toBe('1.0')
    expect(formatPermille(1)).toBe('0.1%')
    expect(formatPermille(1001)).toBe('100.1%')
    expect(formatMarkup(3000)).toBe('×3.0')
    expect(formatMarkup(1200)).toBe('×1.2')
  })
})

describe('5.3 出資者名稱建議', () => {
  const s = (startAt: string, createdAt: string, names: string[]) =>
    makeSession({
      type: 'mtt',
      stakeId: null,
      startAt,
      createdAt,
      backers: names.map((name) => ({ name, sharePermille: 10, markupPermille: 1000 })),
    })

  it('依最近使用排序（startAt 新到舊、同時間依 createdAt 新到舊）；不分大小寫去重並保留最近一次的寫法', () => {
    const history = backerNameHistory([
      s('2026-09-01T10:00', '2026-09-01T12:00:00+08:00', ['alice', 'Bob']),
      s('2026-09-10T10:00', '2026-09-10T12:00:00+08:00', ['Carol']),
      s('2026-09-10T10:00', '2026-09-10T13:00:00+08:00', ['ALICE']),
      s('2026-08-01T10:00', '2026-08-01T12:00:00+08:00', ['Dave', 'bob']),
      makeSession(),
    ])
    expect(history).toEqual(['ALICE', 'Carol', 'Bob', 'Dave'])
  })

  it('篩選：部分符合、不分大小寫；排除其他列已填的名稱；最多 8 筆', () => {
    const history = ['Alice', 'Bob', 'Carol', 'Alan', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivan']
    expect(filterBackerSuggestions(history, '', [])).toEqual(history.slice(0, 8))
    expect(filterBackerSuggestions(history, 'al', [])).toEqual(['Alice', 'Alan'])
    expect(filterBackerSuggestions(history, ' AL ', [' alice '])).toEqual(['Alan'])
    expect(filterBackerSuggestions(history, '', ['bob', 'CAROL'])).toEqual([
      'Alice',
      'Alan',
      'Dave',
      'Eve',
      'Frank',
      'Grace',
      'Heidi',
      'Ivan',
    ])
    expect(filterBackerSuggestions(history, 'zzz', [])).toEqual([])
  })
})
