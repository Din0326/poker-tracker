import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  applyListFilters,
  isFiltering,
  matchKeyword,
  matchName,
  nameKey,
  normalizeKeyword,
  type ListFilters,
} from '../../src/features/sessions/listFilters'
import { makeSession } from './helpers/fixtures'

// 7.1 篩選：類型、期間（4.5）、關鍵字，與報表分組跳入的場地 / 盲注 / 名稱（6.4 比對規則）

const TODAY = '2026-09-28'
const f = (patch: Partial<ListFilters> = {}): ListFilters => ({ ...DEFAULT_FILTERS, ...patch })

const sessions = [
  makeSession({ id: 'cash-recent', type: 'cash', startAt: '2026-09-20T20:00', venueId: 'v1', stakeId: 's1', note: '手感不錯' }),
  makeSession({ id: 'cash-old', type: 'cash', startAt: '2026-01-10T20:00', venueId: null, stakeId: 's2' }),
  makeSession({ id: 'mtt-recent', type: 'mtt', startAt: '2026-08-01T13:00', venueId: 'v1', name: ' 週日賽 ', note: null }),
  makeSession({ id: 'mtt-old', type: 'mtt', startAt: '2025-12-31T13:00', venueId: 'v2', name: '週日賽' }),
  makeSession({ id: 'timed', type: 'timed_mtt', startAt: '2026-06-28T00:00', venueId: null, name: null, note: 'Sunday MAIN event' }),
]
const ids = (r: { sessions: { id: string }[] }) => r.sessions.map((s) => s.id)

describe('類型與期間', () => {
  it('預設不篩選', () => {
    expect(ids(applyListFilters(sessions, f(), {}, TODAY))).toHaveLength(5)
  })

  it('類型', () => {
    expect(ids(applyListFilters(sessions, f({ type: 'mtt' }), {}, TODAY))).toEqual(['mtt-recent', 'mtt-old'])
  })

  it('近三個月（6/28 起，含當天）、近半年（3/28 起）', () => {
    expect(ids(applyListFilters(sessions, f({ period: 'last3Months' }), {}, TODAY))).toEqual([
      'cash-recent',
      'mtt-recent',
      'timed',
    ])
    expect(ids(applyListFilters(sessions, f({ period: 'last6Months' }), {}, TODAY))).toEqual([
      'cash-recent',
      'mtt-recent',
      'timed',
    ])
  })

  it('自訂期間兩端皆含', () => {
    const r = applyListFilters(sessions, f({ period: 'custom', from: '2025-12-31', to: '2026-01-10' }), {}, TODAY)
    expect(ids(r)).toEqual(['cash-old', 'mtt-old'])
    expect(r.periodError).toBeNull()
  })

  it('自訂起日晚於迄日：回報錯誤且不套用期間（其他條件照常）', () => {
    const r = applyListFilters(
      sessions,
      f({ type: 'cash', period: 'custom', from: '2026-09-01', to: '2026-01-01' }),
      {},
      TODAY,
    )
    expect(r.periodError).toBe('fromAfterTo')
    expect(ids(r)).toEqual(['cash-recent', 'cash-old'])
  })

  it('自訂起迄未填完整：不套用期間', () => {
    const r = applyListFilters(sessions, f({ period: 'custom', from: '2026-09-01', to: '' }), {}, TODAY)
    expect(r.periodError).toBe('invalidDate')
    expect(ids(r)).toHaveLength(5)
  })

  it('兩項同時套用：類型 + 期間', () => {
    expect(ids(applyListFilters(sessions, f({ type: 'mtt', period: 'last3Months' }), {}, TODAY))).toEqual([
      'mtt-recent',
    ])
  })
})

describe('關鍵字', () => {
  it('比對 name 與 note，不分大小寫、部分符合', () => {
    expect(matchKeyword({ name: 'Sunday Main', note: null }, 'main')).toBe(true)
    expect(matchKeyword({ name: null, note: 'Sunday MAIN event' }, normalizeKeyword('main EV'))).toBe(true)
    expect(matchKeyword({ name: null, note: null }, 'x')).toBe(false)
    expect(matchKeyword({ name: null, note: null }, '')).toBe(true)
  })

  it('前後空白不影響；只有空白視為沒有關鍵字', () => {
    expect(normalizeKeyword('  Main ')).toBe('main')
    expect(ids(applyListFilters(sessions, f({ keyword: '   ' }), {}, TODAY))).toHaveLength(5)
  })

  it('兩項同時套用：類型 + 關鍵字', () => {
    expect(ids(applyListFilters(sessions, f({ keyword: '週日' }), {}, TODAY))).toEqual(['mtt-recent', 'mtt-old'])
    expect(ids(applyListFilters(sessions, f({ type: 'timed_mtt', keyword: 'main' }), {}, TODAY))).toEqual(['timed'])
    expect(ids(applyListFilters(sessions, f({ type: 'cash', keyword: 'main' }), {}, TODAY))).toEqual([])
  })
})

describe('報表分組跳入的額外條件', () => {
  it('名稱：去除前後空白、不分大小寫完全相同（6.4）；null 為未命名', () => {
    expect(nameKey('  Sunday ')).toBe('sunday')
    expect(matchName({ name: 'SUNDAY' }, 'sunday ')).toBe(true)
    expect(matchName({ name: 'Sunday Main' }, 'sunday')).toBe(false)
    expect(matchName({ name: null }, null)).toBe(true)
    expect(matchName({ name: '週日賽' }, null)).toBe(false)
    expect(ids(applyListFilters(sessions, f(), { name: '週日賽' }, TODAY))).toEqual(['mtt-recent', 'mtt-old'])
    expect(ids(applyListFilters(sessions, f(), { name: null }, TODAY))).toEqual(['cash-recent', 'cash-old', 'timed'])
  })

  it('場地：id 相同；null 為未指定', () => {
    expect(ids(applyListFilters(sessions, f(), { venue: 'v1' }, TODAY))).toEqual(['cash-recent', 'mtt-recent'])
    expect(ids(applyListFilters(sessions, f(), { venue: null }, TODAY))).toEqual(['cash-old', 'timed'])
  })

  it('盲注', () => {
    expect(ids(applyListFilters(sessions, f({ type: 'cash' }), { stake: 's2' }, TODAY))).toEqual(['cash-old'])
  })

  it('與類型、期間一起套用', () => {
    expect(
      ids(applyListFilters(sessions, f({ type: 'mtt', period: 'last6Months' }), { venue: 'v1', name: '週日賽' }, TODAY)),
    ).toEqual(['mtt-recent'])
  })
})

describe('isFiltering', () => {
  it('任何一項不是預設值即為篩選中', () => {
    expect(isFiltering(f(), {})).toBe(false)
    expect(isFiltering(f({ type: 'cash' }), {})).toBe(true)
    expect(isFiltering(f({ period: 'last3Months' }), {})).toBe(true)
    expect(isFiltering(f({ keyword: 'x' }), {})).toBe(true)
    expect(isFiltering(f(), { venue: null })).toBe(true)
    expect(isFiltering(f(), { name: null })).toBe(true)
  })
})
