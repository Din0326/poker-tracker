// 新增 / 編輯表單的賣股份純邏輯（5.1–5.7 v1.2 新增部分；src/features/record/formModel.ts）
import { describe, expect, it } from 'vitest'
import type { Stake, Venue } from '../../src/domain'
import {
  BACKERS_TOTAL_ERROR_KEY,
  computeBackerRowPreview,
  computePreview,
  createDefaults,
  createRecordSchema,
  isBlankBacker,
  newBackerRow,
  parseDraft,
  resetAfterSave,
  sessionToValues,
  switchType,
  toDraft,
  toSessionInput,
  valuesEqual,
  type BackerValues,
  type RecordFormSettings,
  type RecordFormValues,
} from '../../src/features/record/formModel'
import { sessionToCopyDraft, sessionToCopyValues } from '../../src/features/sessions/copySession'
import { makeSession } from './helpers/fixtures'

const NOW = new Date(2026, 8, 28, 20, 30)
const stakes: Stake[] = [{ id: 's1', sb: 50, bb: 100, archived: false, sortOrder: 0 }]
const venues: Venue[] = [{ id: 'v1', name: 'A', archived: false, sortOrder: 0 }]
const settings: RecordFormSettings = { lastType: 'mtt', lastVenueByType: {}, lastStakeId: 's1' }

const row = (name: string, share: string, markup = '1.0'): BackerValues => ({ name, share, markup })

/** C13 的輸入：MTT 買入 10,000、到手 50,000、A 10%、B 20% */
function c13(overrides: Partial<RecordFormValues> = {}): RecordFormValues {
  return {
    ...createDefaults(settings, stakes, venues, NOW),
    type: 'mtt',
    buyIns: [{ amount: '10000', fee: '' }],
    cashOut: '50000',
    durationH: '2',
    durationM: '0',
    backers: [row('A', '10'), row('B', '20')],
    ...overrides,
  }
}

/** 驗證後的錯誤：路徑 → 訊息 */
function errorsOf(v: RecordFormValues): Record<string, string> {
  const r = createRecordSchema(NOW).safeParse(v)
  if (r.success) return {}
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
}

describe('5.3 出資者列預設', () => {
  it('新增頁預設沒有出資者列（區塊收合）；新增的列名稱與比例空白、倍數預填 1.0', () => {
    expect(createDefaults(settings, stakes, venues, NOW).backers).toEqual([])
    expect(newBackerRow()).toEqual({ name: '', share: '', markup: '1.0' })
  })
})

describe('5.4 出資者驗證規則（10 條）', () => {
  it('合法：C13 的輸入通過', () => {
    expect(errorsOf(c13())).toEqual({})
  })

  it('P5.5 規則 1 出資者名稱空白 → 請填寫出資者名稱', () => {
    expect(errorsOf(c13({ backers: [row('  ', '10')] }))).toEqual({ 'backers.0.name': '請填寫出資者名稱' })
  })

  it('P5.5 規則 2 名稱去除前後空白後超過 20 字 → 出資者名稱最多 20 字（20 字含前後空白合法）', () => {
    expect(errorsOf(c13({ backers: [row('一二三四五六七八九十一二三四五六七八九十一', '10')] }))).toEqual({
      'backers.0.name': '出資者名稱最多 20 字',
    })
    expect(errorsOf(c13({ backers: [row('  一二三四五六七八九十一二三四五六七八九十  ', '10')] }))).toEqual({})
  })

  it('P5.5 規則 3 同一場名稱重複（去除前後空白、不分大小寫）→ 出資者名稱重複', () => {
    expect(errorsOf(c13({ backers: [row('Alice', '10'), row(' alice ', '20')] }))).toEqual({
      'backers.1.name': '出資者名稱重複',
    })
  })

  it('P5.5 規則 4 比例空白或為 0 → 請填寫比例', () => {
    expect(errorsOf(c13({ backers: [row('A', '')] }))).toEqual({ 'backers.0.share': '請填寫比例' })
    expect(errorsOf(c13({ backers: [row('A', '0')] }))).toEqual({ 'backers.0.share': '請填寫比例' })
  })

  it('P5.5 規則 5 比例不是數字或超過 1 位小數 → 比例最多到小數 1 位', () => {
    expect(errorsOf(c13({ backers: [row('A', '12.55')] }))).toEqual({ 'backers.0.share': '比例最多到小數 1 位' })
    expect(errorsOf(c13({ backers: [row('A', '.')] }))).toEqual({ 'backers.0.share': '比例最多到小數 1 位' })
  })

  it('P5.5 規則 6 比例大於 100 → 比例需介於 0.1% 到 100% 之間', () => {
    expect(errorsOf(c13({ backers: [row('A', '100.1')] }))).toEqual({ 'backers.0.share': '比例需介於 0.1% 到 100% 之間' })
  })

  it('P5.5 規則 7 比例合計超過 100% → 賣出比例合計不可超過 100%（目前 105%）；恰 100% 合法', () => {
    expect(errorsOf(c13({ backers: [row('A', '60'), row('B', '45')] }))).toEqual({
      [BACKERS_TOTAL_ERROR_KEY]: '賣出比例合計不可超過 100%（目前 105%）',
    })
    expect(errorsOf(c13({ backers: [row('A', '60'), row('B', '40.1')] }))).toEqual({
      [BACKERS_TOTAL_ERROR_KEY]: '賣出比例合計不可超過 100%（目前 100.1%）',
    })
    expect(errorsOf(c13({ backers: [row('A', '60'), row('B', '40')] }))).toEqual({})
  })

  it('P5.5 規則 8 加價倍數空白 → 請填寫加價倍數', () => {
    expect(errorsOf(c13({ backers: [row('A', '10', '')] }))).toEqual({ 'backers.0.markup': '請填寫加價倍數' })
  })

  it('P5.5 規則 9 加價倍數不是數字或超過 3 位小數 → 加價倍數最多到小數 3 位', () => {
    expect(errorsOf(c13({ backers: [row('A', '10', '1.1255')] }))).toEqual({ 'backers.0.markup': '加價倍數最多到小數 3 位' })
  })

  it('P5.5 規則 10 加價倍數小於 1.0 或大於 3.0 → 加價倍數需介於 1.0 到 3.0 之間', () => {
    expect(errorsOf(c13({ backers: [row('A', '10', '0.9')] }))).toEqual({ 'backers.0.markup': '加價倍數需介於 1.0 到 3.0 之間' })
    expect(errorsOf(c13({ backers: [row('A', '10', '3.01')] }))).toEqual({ 'backers.0.markup': '加價倍數需介於 1.0 到 3.0 之間' })
  })

  it('P5.5 空白列（名稱、比例空白且倍數空白或 1.0）不套用規則、儲存時自動移除', () => {
    expect(isBlankBacker(row('', ''))).toBe(true)
    expect(isBlankBacker(row(' ', ' ', ''))).toBe(true)
    expect(isBlankBacker(row('', '', '1'))).toBe(true)
    expect(isBlankBacker(row('', '', '1.000'))).toBe(true)
    expect(isBlankBacker(row('', '', '1.2'))).toBe(false)
    expect(isBlankBacker(row('A', ''))).toBe(false)
    const v = c13({ backers: [row('', ''), row('A', '10', '1.2'), row('', '', '')] })
    expect(errorsOf(v)).toEqual({})
    expect(toSessionInput(v).backers).toEqual([{ name: 'A', sharePermille: 100, markupPermille: 1200 }])
    // 只有空白列 → 沒有賣股
    expect(toSessionInput(c13({ backers: [row('', '')] })).backers).toEqual([])
  })
})

describe('toSessionInput / sessionToValues', () => {
  it('比例、倍數字串精確轉為千分比整數；依輸入順序', () => {
    const v = c13({ backers: [row('A', '12.5', '1.15'), row('B', '0.1', '3'), row('C', '33.3', '1.125')] })
    expect(toSessionInput(v).backers).toEqual([
      { name: 'A', sharePermille: 125, markupPermille: 1150 },
      { name: 'B', sharePermille: 1, markupPermille: 3000 },
      { name: 'C', sharePermille: 333, markupPermille: 1125 },
    ])
  })

  it('5.7 編輯模式：帶入出資者列（依儲存順序）', () => {
    const s = makeSession({
      type: 'mtt',
      stakeId: null,
      backers: [
        { name: 'B', sharePermille: 200, markupPermille: 1000 },
        { name: 'A', sharePermille: 125, markupPermille: 1150 },
      ],
    })
    const v = sessionToValues(s)
    expect(v.backers).toEqual([row('B', '20', '1.0'), row('A', '12.5', '1.15')])
    expect(toSessionInput(v).backers).toEqual(s.backers)
  })

  it('5.7 出資者列的增刪與修改算作變更', () => {
    const base = c13()
    expect(valuesEqual(base, c13())).toBe(true)
    expect(valuesEqual(base, c13({ backers: [row('A', '10')] }))).toBe(false)
    expect(valuesEqual(base, c13({ backers: [row('A', '10'), row('B', '20', '1.2')] }))).toBe(false)
    expect(valuesEqual(base, c13({ backers: [row('A', '10'), row('C', '20')] }))).toBe(false)
  })
})

describe('5.1 切換類型 / 5.5 儲存後重置', () => {
  it('切換類型時出資者列保留（共用欄位）', () => {
    const v = c13()
    const ctx = { settings, stakes, venues, venueTouched: false }
    expect(switchType(v, 'cash', ctx).backers).toEqual(v.backers)
    expect(switchType(v, 'timed_mtt', ctx).backers).toEqual(v.backers)
  })

  it('儲存後出資者列全部清空（區塊回到收合）', () => {
    expect(resetAfterSave(c13()).backers).toEqual([])
  })
})

describe('5.2 預覽列 / 5.3 每列付你 · 分走', () => {
  it('P5.5 以 C13 輸入：全額 +40,000、賣出 30%、你的盈利 +28,000', () => {
    expect(computePreview(c13())).toEqual({
      buyInTotal: 10000,
      entries: 1,
      feeTotal: 0,
      profit: 40000,
      backerRows: 2,
      soldPermille: 300,
      myProfit: 28000,
    })
  })

  it('你的盈利需買入、到手與每一列的比例、倍數都有效（不含名稱）才計算；賣出比例取有效值合計', () => {
    expect(computePreview(c13({ backers: [row('', '10'), row('', '20')] })).myProfit).toBe(28000)
    const badShare = computePreview(c13({ backers: [row('A', '10'), row('B', '')] }))
    expect(badShare.myProfit).toBeNull()
    expect(badShare.soldPermille).toBe(100)
    expect(computePreview(c13({ backers: [row('A', '10', '0.5')] })).myProfit).toBeNull()
    expect(computePreview(c13({ cashOut: '' })).myProfit).toBeNull()
    expect(computePreview(c13({ buyIns: [{ amount: '', fee: '' }] })).myProfit).toBeNull()
    // 無出資者列時預覽與 v1.1 相同（盈利為全額，backerRows 0）
    expect(computePreview(c13({ backers: [] }))).toMatchObject({ profit: 40000, backerRows: 0, myProfit: 40000 })
  })

  it('每列「付你 / 分走」：買入無效時付款 —、到手無效時分走 —、比例或倍數無效時兩者都 —', () => {
    const v = c13({ backers: [row('A', '10', '1.2'), row('B', '20')] })
    expect(computeBackerRowPreview(v, 0)).toEqual({ pay: 1200, payout: 5000 })
    expect(computeBackerRowPreview(v, 1)).toEqual({ pay: 2000, payout: 10000 })
    expect(computeBackerRowPreview(c13({ buyIns: [{ amount: '', fee: '' }] }), 0)).toEqual({ pay: null, payout: 5000 })
    expect(computeBackerRowPreview(c13({ cashOut: '' }), 0)).toEqual({ pay: 1000, payout: null })
    expect(computeBackerRowPreview(c13({ backers: [row('A', '')] }), 0)).toEqual({ pay: null, payout: null })
    expect(computeBackerRowPreview(c13({ backers: [row('A', '10', '')] }), 0)).toEqual({ pay: null, payout: null })
  })
})

describe('5.6 草稿（v2）', () => {
  it('出資者列以原始字串保存（含未通過驗證的值與空白列），還原後列數與內容相同', () => {
    const v = c13({ backers: [row('A', '12.55', '0.9'), row('', ''), row('B', '20', '1.15')] })
    const draft = JSON.parse(JSON.stringify(toDraft(v, false)))
    expect(draft.version).toBe(2)
    expect(draft.values.backers).toEqual(v.backers)
    const parsed = parseDraft(draft, stakes, venues)
    expect(parsed?.values.backers).toEqual(v.backers)
    expect(valuesEqual(parsed!.values, v)).toBe(true)
  })

  it('v1.1 存下（version 1、沒有出資者資料）的草稿：還原時視為 0 列', () => {
    const v = c13({ backers: [] })
    const valuesV1: Record<string, unknown> = { ...toDraft(v, true).values }
    delete valuesV1.backers
    const v1Draft = { version: 1, type: 'mtt', venueTouched: true, values: valuesV1 }
    const parsed = parseDraft(v1Draft, stakes, venues)
    expect(parsed?.values.backers).toEqual([])
    expect(parsed?.values.cashOut).toBe('50000')
    expect(parsed?.venueTouched).toBe(true)
  })

  it('格式錯誤的出資者列（含非數字字元、超過 10 列）丟棄整份草稿', () => {
    const draft = toDraft(c13(), false)
    expect(parseDraft({ ...draft, values: { ...draft.values, backers: [{ name: 'A', share: '10%', markup: '1' }] } }, stakes, venues)).toBeNull()
    expect(
      parseDraft({ ...draft, values: { ...draft.values, backers: Array.from({ length: 11 }, () => row('', '')) } }, stakes, venues),
    ).toBeNull()
  })
})

describe('7.4 複製為新紀錄（Q16）', () => {
  it('帶出全部出資者列（名稱、比例、倍數），依儲存順序', () => {
    const s = makeSession({
      type: 'mtt',
      stakeId: null,
      backers: [
        { name: 'A', sharePermille: 100, markupPermille: 1200 },
        { name: 'B', sharePermille: 200, markupPermille: 1000 },
      ],
    })
    expect(sessionToCopyValues(s, stakes, venues, NOW).backers).toEqual([row('A', '10', '1.2'), row('B', '20', '1.0')])
    const draft = sessionToCopyDraft(s, stakes, venues, NOW)
    expect(parseDraft(draft, stakes, venues)?.values.backers).toEqual([row('A', '10', '1.2'), row('B', '20', '1.0')])
  })
})
