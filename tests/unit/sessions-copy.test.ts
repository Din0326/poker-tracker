import { describe, expect, it } from 'vitest'
import type { Stake, Venue } from '../../src/domain'
import { sessionToCopyDraft, sessionToCopyValues } from '../../src/features/sessions/copySession'
import { createDefaults, parseDraft, valuesEqual } from '../../src/features/record/formModel'
import { makeSession } from './helpers/fixtures'

// 7.4 複製為新紀錄的預填規則

const NOW = new Date(2026, 8, 28, 21, 30)
const venues: Venue[] = [
  { id: 'v-active', name: 'A', archived: false, sortOrder: 0 },
  { id: 'v-archived', name: 'B', archived: true, sortOrder: 1 },
]
const stakes: Stake[] = [
  { id: 's-active', sb: 50, bb: 100, archived: false, sortOrder: 0 },
  { id: 's-archived', sb: 100, bb: 200, archived: true, sortOrder: 1 },
]

const mtt = makeSession({
  type: 'mtt',
  startAt: '2026-09-01T13:00',
  durationMin: 375,
  buyIns: [
    { amount: 3400, fee: 400 },
    { amount: 3200, fee: 0 },
  ],
  cashOut: 9000,
  venueId: 'v-active',
  name: '週日賽',
  note: '備註',
  fieldSize: 180,
  finishPlace: 12,
})

describe('sessionToCopyValues', () => {
  it('預填類型、場地、名稱、全部買入列；開始時間為現在；其餘留空', () => {
    expect(sessionToCopyValues(mtt, stakes, venues, NOW)).toEqual({
      type: 'mtt',
      stakeId: '',
      buyIns: [
        { amount: '3400', fee: '400' },
        { amount: '3200', fee: '' },
      ],
      cashOut: '',
      fieldSize: '',
      finishPlace: '',
      startDate: '2026-09-28',
      startHour: '21',
      durationH: '',
      durationM: '',
      venueId: 'v-active',
      name: '週日賽',
      note: '',
      // v1.2：沒有出資者的來源場次，出資者列為 0 列（有出資者的情況見 staking-form.test.ts）
      backers: [],
    })
  })

  it('現金桌預填盲注', () => {
    const cash = makeSession({ type: 'cash', stakeId: 's-active', venueId: 'v-active', buyIns: [{ amount: 10000, fee: 300 }] })
    expect(sessionToCopyValues(cash, stakes, venues, NOW)).toMatchObject({
      type: 'cash',
      stakeId: 's-active',
      venueId: 'v-active',
      buyIns: [{ amount: '10000', fee: '300' }],
      name: '',
    })
  })

  it('來源場地或盲注已封存（或不存在）時留空', () => {
    const cash = makeSession({ type: 'cash', stakeId: 's-archived', venueId: 'v-archived' })
    expect(sessionToCopyValues(cash, stakes, venues, NOW)).toMatchObject({ stakeId: '', venueId: '' })
    const missing = makeSession({ type: 'cash', stakeId: 'nope', venueId: 'nope' })
    expect(sessionToCopyValues(missing, stakes, venues, NOW)).toMatchObject({ stakeId: '', venueId: '' })
  })
})

describe('sessionToCopyDraft', () => {
  it('新增頁可還原成同樣的值，且與預設值不同（會被視為草稿）', () => {
    const draft = sessionToCopyDraft(mtt, stakes, venues, NOW)
    const restored = parseDraft(draft, stakes, venues)
    expect(restored).not.toBeNull()
    expect(restored!.values).toEqual(sessionToCopyValues(mtt, stakes, venues, NOW))
    expect(restored!.venueTouched).toBe(true)
    const defaults = createDefaults({ lastType: 'mtt', lastVenueByType: { mtt: 'v-active' }, lastStakeId: undefined }, stakes, venues, NOW)
    expect(valuesEqual(restored!.values, defaults)).toBe(false)
  })
})
