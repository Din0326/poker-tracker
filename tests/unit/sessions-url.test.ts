import { describe, expect, it } from 'vitest'
import {
  buildSessionsListPath,
  extrasToSearch,
  parseListSearch,
  withoutExtra,
} from '../../src/features/sessions/listUrl'

// Q3：報表分組跳到紀錄列表的網址參數（P4 使用 buildSessionsListPath）

const search = (path: string) => path.slice(path.indexOf('?'))

describe('buildSessionsListPath', () => {
  it('類型 + 期間 + 場地', () => {
    expect(buildSessionsListPath({ type: 'cash', period: { kind: 'last3Months' }, venueId: 'v-1' })).toBe(
      '/sessions?type=cash&period=3m&venue=v-1',
    )
  })

  it('總體、全部期間', () => {
    expect(buildSessionsListPath({ type: 'all', period: { kind: 'all' } })).toBe('/sessions?type=all&period=all')
  })

  it('自訂期間帶起迄', () => {
    expect(
      buildSessionsListPath({ type: 'mtt', period: { kind: 'custom', from: '2026-01-01', to: '2026-03-31' } }),
    ).toBe('/sessions?type=mtt&period=custom&from=2026-01-01&to=2026-03-31')
  })

  it('未指定場地、未命名以空值表示；名稱會編碼並去除前後空白', () => {
    expect(buildSessionsListPath({ type: 'mtt', period: { kind: 'last6Months' }, venueId: null, name: null })).toBe(
      '/sessions?type=mtt&period=6m&venue=&name=',
    )
    const p = buildSessionsListPath({ type: 'mtt', period: { kind: 'all' }, name: '  週日賽 & Main ' })
    expect(parseListSearch(search(p)).extras).toEqual({ name: '週日賽 & Main' })
  })

  it('盲注', () => {
    expect(buildSessionsListPath({ type: 'cash', period: { kind: 'all' }, stakeId: 's-1' })).toBe(
      '/sessions?type=cash&period=all&stake=s-1',
    )
  })
})

describe('parseListSearch', () => {
  it('與 build 互為反函式', () => {
    const cases = [
      { type: 'cash', period: { kind: 'last3Months' }, venueId: 'v-1', stakeId: 's-1' },
      { type: 'timed_mtt', period: { kind: 'custom', from: '2026-01-01', to: '2026-02-01' }, name: '週日賽' },
      { type: 'all', period: { kind: 'all' }, venueId: null },
      { type: 'mtt', period: { kind: 'last6Months' }, name: null },
    ] as const
    const expected = [
      { overrides: { type: 'cash', period: 'last3Months' }, extras: { venue: 'v-1', stake: 's-1' } },
      {
        overrides: { type: 'timed_mtt', period: 'custom', from: '2026-01-01', to: '2026-02-01' },
        extras: { name: '週日賽' },
      },
      { overrides: { type: 'all', period: 'all' }, extras: { venue: null } },
      { overrides: { type: 'mtt', period: 'last6Months' }, extras: { name: null } },
    ]
    cases.forEach((c, i) => {
      const r = parseListSearch(search(buildSessionsListPath(c)))
      expect(r).toEqual({ ...expected[i], hasOverrides: true })
    })
  })

  it('沒有參數', () => {
    expect(parseListSearch('')).toEqual({ overrides: {}, hasOverrides: false, extras: {} })
  })

  it('不認得的值忽略，但仍需從網址移除', () => {
    expect(parseListSearch('?type=poker&period=1y&stake=')).toEqual({ overrides: {}, hasOverrides: true, extras: {} })
  })

  it('custom 缺起迄時為空字串（由篩選列顯示並等待使用者填寫）', () => {
    expect(parseListSearch('?period=custom').overrides).toEqual({ period: 'custom', from: '', to: '' })
  })

  it('只有空白的名稱視為未命名', () => {
    expect(parseListSearch('?name=%20%20').extras).toEqual({ name: null })
  })
})

describe('extrasToSearch、withoutExtra', () => {
  it('只保留額外條件；全部移除時為空字串', () => {
    const extras = { venue: null, stake: 's-1', name: '週日賽' }
    expect(parseListSearch(extrasToSearch(extras)).extras).toEqual(extras)
    expect(parseListSearch(extrasToSearch(extras)).hasOverrides).toBe(false)
    expect(extrasToSearch(withoutExtra(withoutExtra(withoutExtra(extras, 'venue'), 'stake'), 'name'))).toBe('')
    expect(withoutExtra(extras, 'stake')).toEqual({ venue: null, name: '週日賽' })
  })
})
