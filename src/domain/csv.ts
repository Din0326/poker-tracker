// 8.6 匯出 CSV（純函式）。
// - 全部場次，一場一列，依 startAt 由舊到新（同時間依 createdAt）
// - UTF-8 加 BOM、CRLF 換行；逗號、雙引號、換行依 RFC 4180 以雙引號包起，雙引號重複一次
// - 數字無千分位、無貨幣符號，負數用 ASCII 減號；空值為空字串
// - 公式注入防護：文字欄位（類型、場地、盲注、名稱、備註）以 = + - @ 開頭時前面加單引號；
//   tab、CR 開頭同樣會被 Excel 視為公式前綴（OWASP CSV Injection），一併處理（規格未載明，保守做法）
import dayjs from 'dayjs'
import { strings } from '../strings'
import { stakeLabel } from './format'
import { buyInTotal, entryCount, feeTotal, profit } from './session'
import { sortChronological } from './sort'
import type { Session, Stake, Venue } from './types'

export const CSV_BOM = String.fromCharCode(0xfeff)
export const CSV_EOL = '\r\n'

// 以這些字元開頭的文字欄位前面加單引號
const FORMULA_PREFIX = /^[=+\-@\t\r]/

// 需要以雙引號包起的字元：雙引號（\x22）、逗號、CR、LF
const NEEDS_QUOTING = /[\x22,\r\n]/

const QUOTE = '\x22'

// RFC 4180：含逗號、雙引號、CR、LF 時以雙引號包起，內部雙引號重複一次
export function escapeCsvField(value: string): string {
  return NEEDS_QUOTING.test(value) ? QUOTE + value.replaceAll(QUOTE, QUOTE + QUOTE) + QUOTE : value
}

// 文字欄位的公式注入防護
export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

type Cell = { kind: 'text'; value: string } | { kind: 'number'; value: number | null } | { kind: 'raw'; value: string }

const text = (value: string | null | undefined): Cell => ({ kind: 'text', value: value ?? '' })
const num = (value: number | null): Cell => ({ kind: 'number', value })
const raw = (value: string): Cell => ({ kind: 'raw', value })

function renderCell(cell: Cell): string {
  switch (cell.kind) {
    case 'text':
      return escapeCsvField(neutralizeFormula(cell.value))
    case 'number':
      // 整數以 String() 輸出：無千分位，負數為 ASCII 減號
      return cell.value === null ? '' : String(cell.value)
    case 'raw':
      return escapeCsvField(cell.value)
  }
}

function sessionRow(s: Session, venues: ReadonlyMap<string, Venue>, stakes: ReadonlyMap<string, Stake>): Cell[] {
  const venue = s.venueId === null ? undefined : venues.get(s.venueId)
  const stake = s.stakeId === null ? undefined : stakes.get(s.stakeId)
  return [
    // 日期 YYYY-MM-DD 與開始時 0 到 23：系統產生的固定格式，不需注入防護
    raw(s.startAt.slice(0, 10)),
    num(Number(s.startAt.slice(11, 13))),
    text(strings.sessionTypes[s.type]),
    text(venue?.name),
    text(stake ? stakeLabel(stake) : ''),
    text(s.name),
    num(entryCount(s)),
    num(buyInTotal(s)),
    num(feeTotal(s)),
    num(s.cashOut),
    num(profit(s)),
    num(s.durationMin),
    num(s.fieldSize),
    num(s.finishPlace),
    text(s.note),
  ]
}

// 產生 CSV 檔內容（含 BOM；每列以 CRLF 結尾）
export function buildSessionsCsv(
  sessions: readonly Session[],
  venues: readonly Venue[],
  stakes: readonly Stake[],
): string {
  const venueMap = new Map(venues.map((v) => [v.id, v]))
  const stakeMap = new Map(stakes.map((s) => [s.id, s]))
  const lines = [strings.csv.headers.map((h) => escapeCsvField(h)).join(',')]
  for (const s of sortChronological(sessions)) {
    lines.push(sessionRow(s, venueMap, stakeMap).map(renderCell).join(','))
  }
  return CSV_BOM + lines.map((l) => l + CSV_EOL).join('')
}

// 檔名 poker-sessions-YYYYMMDD.csv（本地日期）
export function csvFileName(now: Date): string {
  return `poker-sessions-${dayjs(now).format('YYYYMMDD')}.csv`
}
