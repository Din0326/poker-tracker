// 8.6 匯出 CSV：Excel 相容要點（BOM、CRLF、RFC 4180 跳脫、含逗號與換行的備註不跑欄）、公式注入、負數
import { describe, expect, it } from 'vitest'
import {
  buildSessionsCsv,
  csvFileName,
  escapeCsvField,
  neutralizeFormula,
  type Session,
  type Stake,
  type Venue,
} from '../../src/domain'
import { makeSession } from './helpers/fixtures'

/** 簡易 RFC 4180 parser：用來把輸出解析回來，確認欄數與內容 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
      i++
    } else if (c === ',') {
      row.push(field)
      field = ''
      i++
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 2
    } else if (c === '\n' || c === '\r') {
      throw new Error(`bare line break outside quotes at ${i}`)
    } else {
      field += c
      i++
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const HEADERS = [
  '日期',
  '開始時',
  '類型',
  '場地',
  '盲注',
  '名稱',
  '進場次數',
  '買入總額',
  '服務費總額',
  '到手金額',
  '盈利',
  '時長（分）',
  '參賽人數',
  '名次',
  '備註',
]

const venues: Venue[] = [
  { id: 'v1', name: 'Ace, Club', archived: false, sortOrder: 0 },
  { id: 'v2', name: '=HYPERLINK("x")', archived: true, sortOrder: 1 },
]
const stakes: Stake[] = [{ id: 's1', sb: 50, bb: 100, archived: false, sortOrder: 0 }]

const cash = makeSession({
  type: 'cash',
  startAt: '2026-09-27T08:00',
  durationMin: 270,
  buyIns: [{ amount: 10000, fee: 300 }],
  cashOut: 0,
  stakeId: 's1',
  venueId: 'v1',
  note: '第一行, 有逗號\n第二行 "引號"',
  createdAt: '2026-09-28T02:00:00+08:00',
})
const mtt = makeSession({
  type: 'mtt',
  startAt: '2026-09-14T13:00',
  durationMin: 375,
  buyIns: [
    { amount: 3400, fee: 400 },
    { amount: 3200, fee: 200 },
  ],
  cashOut: 9000,
  stakeId: null,
  venueId: 'v2',
  name: '-週日賽',
  fieldSize: 180,
  finishPlace: 12,
})
const timed = makeSession({
  type: 'timed_mtt',
  startAt: '2026-09-27T08:00',
  durationMin: 60,
  buyIns: [{ amount: 2000, fee: 0 }],
  cashOut: 2000,
  stakeId: null,
  venueId: null,
  name: '@Daily',
  note: '+1 bullet',
  // 與 cash 同一個 startAt，較早建立 → 排在 cash 前面
  createdAt: '2026-09-27T12:00:00+08:00',
})

const sessions: Session[] = [cash, mtt, timed]

describe('8.6 buildSessionsCsv', () => {
  const csv = buildSessionsCsv(sessions, venues, stakes)

  it('UTF-8 BOM 開頭、CRLF 換行、每列以 CRLF 結尾', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(new TextEncoder().encode(csv).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
    expect(csv.endsWith('\r\n')).toBe(true)
    // 引號外沒有單獨的 LF / CR（parseCsv 遇到會丟錯）
    expect(() => parseCsv(csv.slice(1))).not.toThrow()
  })

  it('標題列與欄位順序', () => {
    const rows = parseCsv(csv.slice(1))
    expect(rows[0]).toEqual(HEADERS)
  })

  it('一場一列，依 startAt 由舊到新（同時間依 createdAt）；每列欄數一致（含逗號與換行的備註不跑欄）', () => {
    const rows = parseCsv(csv.slice(1))
    expect(rows).toHaveLength(4)
    for (const r of rows) expect(r).toHaveLength(15)
    expect(rows.slice(1).map((r) => r[5])).toEqual(["'-週日賽", "'@Daily", ''])
  })

  it('各欄的值：日期、開始時、類型名稱、場地、盲注、數字（無千分位、負數 ASCII -）、空值', () => {
    const rows = parseCsv(csv.slice(1))
    expect(rows[1]).toEqual([
      '2026-09-14',
      '13',
      'MTT',
      "'=HYPERLINK(\"x\")",
      '',
      "'-週日賽",
      '2',
      '6600',
      '600',
      '9000',
      '2400',
      '375',
      '180',
      '12',
      '',
    ])
    expect(rows[2]).toEqual(['2026-09-27', '8', '限時 MTT', '', '', "'@Daily", '1', '2000', '0', '2000', '0', '60', '', '', "'+1 bullet"])
    expect(rows[3]).toEqual([
      '2026-09-27',
      '8',
      '現金桌',
      'Ace, Club',
      '50/100',
      '',
      '1',
      '10000',
      '300',
      '0',
      '-10000',
      '270',
      '',
      '',
      '第一行, 有逗號\n第二行 "引號"',
    ])
  })

  it('原始文字：含逗號、引號、換行的欄位以雙引號包起，引號轉為兩個', () => {
    expect(csv).toContain('"第一行, 有逗號\n第二行 ""引號"""')
    expect(csv).toContain('"Ace, Club"')
    expect(csv).toContain(',-10000,')
    expect(csv).not.toMatch(/[−$]/)
  })

  it('沒有場次時只有標題列', () => {
    const empty = buildSessionsCsv([], [], [])
    expect(empty).toBe(`${String.fromCharCode(0xfeff)}${HEADERS.join(',')}\r\n`)
  })

  it('找不到的場地、盲注參照輸出空字串', () => {
    const rows = parseCsv(buildSessionsCsv([cash], [], []).slice(1))
    expect(rows[1]![3]).toBe('')
    expect(rows[1]![4]).toBe('')
  })

  it('數字欄位不做公式注入處理（負數維持 -）', () => {
    const loss = makeSession({ buyIns: [{ amount: 500, fee: 0 }], cashOut: 0, stakeId: 's1' })
    const rows = parseCsv(buildSessionsCsv([loss], venues, stakes).slice(1))
    expect(rows[1]![10]).toBe('-500')
  })
})

describe('escapeCsvField / neutralizeFormula', () => {
  it('RFC 4180 跳脫', () => {
    expect(escapeCsvField('plain')).toBe('plain')
    expect(escapeCsvField('a,b')).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('a\nb')).toBe('"a\nb"')
    expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"')
    expect(escapeCsvField('')).toBe('')
  })

  it('= + - @ 與 tab、CR 開頭加單引號；其他不變', () => {
    for (const c of ['=', '+', '-', '@', '\t', '\r']) expect(neutralizeFormula(`${c}1`)).toBe(`'${c}1`)
    expect(neutralizeFormula('a=1')).toBe('a=1')
    expect(neutralizeFormula('')).toBe('')
    expect(neutralizeFormula("'x")).toBe("'x")
  })

  it('注入防護後仍依 RFC 4180 跳脫（CR 開頭的備註）', () => {
    const s = makeSession({ stakeId: 's1', note: '\r=cmd' })
    const rows = parseCsv(buildSessionsCsv([s], venues, stakes).slice(1))
    expect(rows[1]![14]).toBe("'\r=cmd")
  })
})

describe('8.6 csvFileName', () => {
  it('poker-sessions-YYYYMMDD.csv（本地日期）', () => {
    expect(csvFileName(new Date(2026, 8, 28, 23, 59))).toBe('poker-sessions-20260928.csv')
    expect(csvFileName(new Date(2027, 0, 5, 0, 0))).toBe('poker-sessions-20270105.csv')
  })
})
