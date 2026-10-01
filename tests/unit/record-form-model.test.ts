// 新增表單純邏輯（src/features/record/formModel.ts）
import { describe, expect, it } from 'vitest'
import type { Stake, Venue } from '../../src/domain'
import {
  computePreview,
  createDefaults,
  createRecordSchema,
  needsSwitchConfirm,
  parseDraft,
  resetAfterSave,
  sessionToValues,
  switchType,
  toDraft,
  toSessionInput,
  valuesEqual,
  type RecordFormSettings,
  type RecordFormValues,
} from '../../src/features/record/formModel'
import { makeSession } from './helpers/fixtures'

const NOW = new Date(2026, 8, 28, 20, 30)
const stakes: Stake[] = [
  { id: 's1', sb: 50, bb: 100, archived: false, sortOrder: 0 },
  { id: 's2', sb: 100, bb: 200, archived: true, sortOrder: 1 },
]
const venues: Venue[] = [
  { id: 'v1', name: 'A', archived: false, sortOrder: 0 },
  { id: 'v2', name: 'B', archived: false, sortOrder: 1 },
  { id: 'v3', name: 'C', archived: true, sortOrder: 2 },
]
const settings: RecordFormSettings = {
  lastType: 'mtt',
  lastVenueByType: { cash: 'v1', mtt: 'v2', timed_mtt: 'v3' },
  lastStakeId: 's1',
}

function filled(overrides: Partial<RecordFormValues> = {}): RecordFormValues {
  return {
    ...createDefaults(settings, stakes, venues, NOW),
    buyIns: [
      { amount: '3400', fee: '400' },
      { amount: '3200', fee: '200' },
    ],
    cashOut: '9000',
    durationH: '2',
    durationM: '30',
    fieldSize: '100',
    finishPlace: '10',
    name: 'Daily',
    note: 'n',
    ...overrides,
  }
}

describe('createDefaults', () => {
  it('依 last* 設定預帶類型、場地、盲注；開始時間為今天、目前小時', () => {
    expect(createDefaults(settings, stakes, venues, NOW)).toMatchObject({
      type: 'mtt',
      stakeId: '',
      venueId: 'v2',
      startDate: '2026-09-28',
      startHour: '20',
      durationH: '',
      durationM: '',
      buyIns: [{ amount: '', fee: '' }],
    })
  })

  it('首次使用預設現金桌；lastStakeId、lastVenueByType 指向已封存項目時不預帶', () => {
    const d = createDefaults({ lastType: undefined, lastVenueByType: {}, lastStakeId: undefined }, stakes, venues, NOW)
    expect(d.type).toBe('cash')
    const archived = createDefaults(
      { lastType: 'cash', lastVenueByType: { cash: 'v3' }, lastStakeId: 's2' },
      stakes,
      venues,
      NOW,
    )
    expect(archived.stakeId).toBe('')
    expect(archived.venueId).toBe('')
  })
})

describe('5.1 switchType', () => {
  it('共用欄位保留，mtt 專屬欄位清空；切到現金桌只保留第一筆買入並帶入 lastStakeId', () => {
    const v = filled()
    const cash = switchType(v, 'cash', { settings, stakes, venues, venueTouched: true })
    expect(cash).toMatchObject({
      type: 'cash',
      stakeId: 's1',
      buyIns: [{ amount: '3400', fee: '400' }],
      cashOut: '9000',
      fieldSize: '',
      finishPlace: '',
      durationH: '2',
      name: 'Daily',
      venueId: 'v2',
    })
    const back = switchType(cash, 'timed_mtt', { settings, stakes, venues, venueTouched: true })
    expect(back.stakeId).toBe('')
  })

  it('Q2：未手動改過場地時改帶新類型的 lastVenueByType（已封存則不指定）', () => {
    const v = filled()
    expect(switchType(v, 'cash', { settings, stakes, venues, venueTouched: false }).venueId).toBe('v1')
    expect(switchType(v, 'timed_mtt', { settings, stakes, venues, venueTouched: false }).venueId).toBe('')
  })

  it('錦標賽買入 > 1 筆切到現金桌需確認', () => {
    expect(needsSwitchConfirm(filled(), 'cash')).toBe(true)
    expect(needsSwitchConfirm(filled(), 'timed_mtt')).toBe(false)
    expect(needsSwitchConfirm(filled({ buyIns: [{ amount: '1', fee: '' }] }), 'cash')).toBe(false)
  })
})

describe('5.5 resetAfterSave', () => {
  it('類型、場地、盲注、日期與小時保留；其餘清空；買入回 1 列', () => {
    const v = filled({ startDate: '2026-09-27', startHour: '14' })
    expect(resetAfterSave(v)).toEqual({
      ...v,
      buyIns: [{ amount: '', fee: '' }],
      cashOut: '',
      fieldSize: '',
      finishPlace: '',
      durationH: '',
      durationM: '',
      name: '',
      note: '',
    })
  })
})

describe('toSessionInput / computePreview（使用 domain 計算）', () => {
  it('C1：限時 MTT 3,400（400）+ 3,200（200），到手 9,000', () => {
    const v = filled({ type: 'timed_mtt' })
    // v1.2：預覽另含出資者列數、賣出比例與你的盈利；沒有出資者列時你的盈利 = 盈利
    expect(computePreview(v)).toEqual({
      buyInTotal: 6600,
      entries: 2,
      feeTotal: 600,
      profit: 2400,
      backerRows: 0,
      soldPermille: 0,
      myProfit: 2400,
    })
    expect(toSessionInput(v)).toEqual({
      type: 'timed_mtt',
      startAt: '2026-09-28T20:00',
      durationMin: 150,
      buyIns: [
        { amount: 3400, fee: 400 },
        { amount: 3200, fee: 200 },
      ],
      cashOut: 9000,
      stakeId: null,
      venueId: 'v2',
      name: 'Daily',
      note: 'n',
      fieldSize: null,
      finishPlace: null,
      backers: [],
    })
  })

  it('買入或到手無效時不顯示盈利；服務費留空視為 0', () => {
    expect(computePreview(filled({ cashOut: '' })).profit).toBeNull()
    const p = computePreview(filled({ buyIns: [{ amount: '', fee: '' }] }))
    expect(p).toEqual({ buyInTotal: null, entries: 1, feeTotal: 0, profit: null, backerRows: 0, soldPermille: 0, myProfit: null })
  })

  it('sessionToValues 與 toSessionInput 互為反向（服務費 0 顯示為空白）', () => {
    const s = makeSession({ type: 'mtt', stakeId: null, fieldSize: 50, finishPlace: 3, durationMin: 65, name: 'x' })
    const v = sessionToValues(s)
    expect(v.buyIns).toEqual([{ amount: '1000', fee: '' }])
    expect(v).toMatchObject({ durationH: '1', durationM: '5', startDate: '2026-09-27', startHour: '20' })
    expect(toSessionInput(v)).toMatchObject({
      type: 'mtt',
      startAt: s.startAt,
      durationMin: 65,
      buyIns: s.buyIns,
      fieldSize: 50,
      finishPlace: 3,
    })
  })
})

describe('createRecordSchema', () => {
  it('合法表單通過；限時 MTT 不檢查名次', () => {
    expect(createRecordSchema(NOW).safeParse(filled()).success).toBe(true)
    expect(createRecordSchema(NOW).safeParse(filled({ type: 'timed_mtt', finishPlace: '999' })).success).toBe(true)
  })

  it('72 時 0 分合法、72 時 5 分不合法', () => {
    expect(createRecordSchema(NOW).safeParse(filled({ durationH: '72', durationM: '0' })).success).toBe(true)
    expect(createRecordSchema(NOW).safeParse(filled({ durationH: '72', durationM: '5' })).success).toBe(false)
  })
})

describe('5.6 草稿', () => {
  it('toDraft → parseDraft 還原，且 valuesEqual 相等', () => {
    const v = filled()
    const parsed = parseDraft(JSON.parse(JSON.stringify(toDraft(v, true))), stakes, venues)
    expect(parsed?.venueTouched).toBe(true)
    expect(valuesEqual(parsed!.values, v)).toBe(true)
  })

  it('版本不符、格式錯誤時丟棄；已封存的盲注、場地改為未選', () => {
    const draft = toDraft(filled(), false)
    // v1.2 起草稿版本為 2：未知的較新版本丟棄；版本 1 但含出資者欄位（不符 v1 格式）也丟棄
    expect(parseDraft({ ...draft, version: 3 }, stakes, venues)).toBeNull()
    expect(parseDraft({ ...draft, version: 1 }, stakes, venues)).toBeNull()
    expect(parseDraft({ ...draft, values: { ...draft.values, cashOut: '1,000' } }, stakes, venues)).toBeNull()
    expect(parseDraft('x', stakes, venues)).toBeNull()
    const cash = toDraft(
      { ...filled({ type: 'cash', stakeId: 's2', venueId: 'v3' }), buyIns: [{ amount: '1', fee: '' }] },
      true,
    )
    expect(parseDraft(cash, stakes, venues)?.values).toMatchObject({ stakeId: '', venueId: '' })
  })
})
