import { describe, expect, it } from 'vitest'
import { filterByPeriod, isValidDate, resolvePeriod, toLocalDate } from '../../src/domain/period'
import { compareChronological, sortChronological, sortReverseChronological } from '../../src/domain/sort'
import { makeSession } from './helpers/fixtures'

describe('4.5 期間篩選', () => {
  it('全部：不限', () => {
    const sessions = [makeSession({ startAt: '2000-01-01T00:00' }), makeSession({ startAt: '2099-12-31T23:00' })]
    const r = filterByPeriod(sessions, { kind: 'all' }, '2026-09-28')
    expect(r.ok && r.sessions).toEqual(sessions)
  })

  it('近三個月：前一天 23 時不含、起日 00 時含、今天 23 時含、明天不含', () => {
    const today = '2026-09-28'
    expect(resolvePeriod({ kind: 'last3Months' }, today)).toEqual({ ok: true, range: { from: '2026-06-28', to: today } })
    const before = makeSession({ startAt: '2026-06-27T23:00' })
    const start = makeSession({ startAt: '2026-06-28T00:00' })
    const end = makeSession({ startAt: '2026-09-28T23:00' })
    const tomorrow = makeSession({ startAt: '2026-09-29T00:00' })
    const r = filterByPeriod([before, start, end, tomorrow], { kind: 'last3Months' }, today)
    expect(r.ok && r.sessions).toEqual([start, end])
  })

  it('近半年：月底收斂（8/31 往前 6 個月為 2/28，閏年 2/29）', () => {
    expect(resolvePeriod({ kind: 'last6Months' }, '2026-08-31')).toEqual({
      ok: true,
      range: { from: '2026-02-28', to: '2026-08-31' },
    })
    expect(resolvePeriod({ kind: 'last6Months' }, '2028-08-31')).toEqual({
      ok: true,
      range: { from: '2028-02-29', to: '2028-08-31' },
    })
    expect(resolvePeriod({ kind: 'last3Months' }, '2028-05-31')).toEqual({
      ok: true,
      range: { from: '2028-02-29', to: '2028-05-31' },
    })
  })

  it('跨年', () => {
    expect(resolvePeriod({ kind: 'last3Months' }, '2027-01-15')).toEqual({
      ok: true,
      range: { from: '2026-10-15', to: '2027-01-15' },
    })
  })

  it('自訂：兩端皆含', () => {
    const a = makeSession({ startAt: '2026-09-01T00:00' })
    const b = makeSession({ startAt: '2026-09-10T23:00' })
    const out = makeSession({ startAt: '2026-09-11T00:00' })
    const r = filterByPeriod([a, b, out], { kind: 'custom', from: '2026-09-01', to: '2026-09-10' }, '2026-09-28')
    expect(r.ok && r.sessions).toEqual([a, b])
  })

  it('自訂：起日晚於迄日回報錯誤', () => {
    expect(resolvePeriod({ kind: 'custom', from: '2026-09-11', to: '2026-09-10' }, '2026-09-28')).toEqual({
      ok: false,
      error: 'fromAfterTo',
    })
    expect(filterByPeriod([], { kind: 'custom', from: '2026-09-11', to: '2026-09-10' }, '2026-09-28')).toEqual({
      ok: false,
      error: 'fromAfterTo',
    })
  })

  it('不合法的日期回報 invalidDate', () => {
    expect(resolvePeriod({ kind: 'custom', from: '2026-02-30', to: '2026-03-01' }, '2026-09-28')).toEqual({
      ok: false,
      error: 'invalidDate',
    })
    expect(resolvePeriod({ kind: 'last3Months' }, '2026/09/28')).toEqual({ ok: false, error: 'invalidDate' })
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2026-02-29')).toBe(false)
  })

  it('toLocalDate 以本地日期輸出', () => {
    expect(toLocalDate(new Date(2026, 4, 31, 23, 59))).toBe('2026-05-31')
  })
})

describe('6.3 / 7.1 排序', () => {
  const a = makeSession({ startAt: '2026-09-01T10:00', createdAt: '2026-09-01T15:00:00+08:00' })
  const b = makeSession({ startAt: '2026-09-01T20:00', createdAt: '2026-09-02T01:00:00+08:00' })
  // 與 c 同一個 startAt，createdAt 較晚
  const c1 = makeSession({ startAt: '2026-09-02T20:00', createdAt: '2026-09-03T01:00:00+08:00' })
  const c2 = makeSession({ startAt: '2026-09-02T20:00', createdAt: '2026-09-03T02:00:00+08:00' })

  it('由舊到新：startAt，同時間依 createdAt', () => {
    expect(sortChronological([c2, b, c1, a])).toEqual([a, b, c1, c2])
  })

  it('由新到舊：兩者皆反向', () => {
    expect(sortReverseChronological([a, c1, b, c2])).toEqual([c2, c1, b, a])
  })

  it('不改動原陣列', () => {
    const input = [c2, a]
    sortChronological(input)
    expect(input).toEqual([c2, a])
  })

  it('createdAt 時區偏移不同時以實際時間比較', () => {
    const x = makeSession({ startAt: '2026-09-02T20:00', createdAt: '2026-09-03T01:30:00+08:00' }) // 17:30Z
    const y = makeSession({ startAt: '2026-09-02T20:00', createdAt: '2026-09-02T18:00:00Z' }) // 18:00Z
    expect(compareChronological(x, y)).toBeLessThan(0)
    expect(sortChronological([y, x])).toEqual([x, y])
  })
})
