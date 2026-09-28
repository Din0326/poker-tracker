// 4.4 數值顯示規則（純函式）。所有畫面文字與符號取自 src/strings.ts。
// - 捨入只在顯示時進行，一律以絕對值進位（round half away from zero，−2.5 → −3）（A6）
// - 進位後為 0 時不帶正負號，不會出現 −0.0%（A6、A7）
// - 負號使用 U+2212；金額為整數、千分位逗號、`$` 前綴（A7）
// - 輸入為 null（分母為 0）時顯示 —
import dayjs from 'dayjs'
import { strings } from '../strings'
import type { PlacePercentile } from './aggregate'
import type { Stake } from './types'

const f = strings.format

/**
 * 四捨五入到 decimals 位小數，以絕對值進位。
 * 先以 15 位有效數字正規化，消除二進位浮點誤差（例 1.005、0.0105 × 100），
 * 再以十進位字串位移計算，避免 1.005 × 100 = 100.49999… 這類誤差。
 */
export function roundHalfAwayFromZero(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return value
  const abs = Number(Math.abs(value).toPrecision(15))
  const text = String(abs)
  let rounded: number
  if (text.includes('e')) {
    // 極大或極小的值（科學記號）無法以字串位移，退回一般算法
    const factor = 10 ** decimals
    rounded = Math.round(abs * factor) / factor
  } else {
    rounded = Number(`${Math.round(Number(`${text}e${decimals}`))}e-${decimals}`)
  }
  if (rounded === 0) return 0
  return value < 0 ? -rounded : rounded
}

/** 整數部分加千分位逗號（不依賴裝置語系） */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 捨入後拆成正負號與絕對值的文字 */
function parts(value: number, decimals: number, grouped: boolean): { sign: -1 | 0 | 1; text: string } {
  const r = roundHalfAwayFromZero(value, decimals)
  const fixed = Math.abs(r).toFixed(decimals)
  const [intPart = '', fracPart] = fixed.split('.')
  const intText = grouped ? groupThousands(intPart) : intPart
  return { sign: r > 0 ? 1 : r < 0 ? -1 : 0, text: fracPart === undefined ? intText : `${intText}.${fracPart}` }
}

function signPrefix(sign: -1 | 0 | 1, showPlus: boolean): string {
  if (sign < 0) return f.minus
  return sign > 0 && showPlus ? f.plus : ''
}

function money(value: number, signed: boolean): string {
  const p = parts(value, 0, true)
  return `${signPrefix(p.sign, signed)}${f.currency}${p.text}`
}

/** 不帶正號的金額：總投入、總到手、總服務費、ABI。例 `$1,523` */
export function formatMoney(value: number | null): string {
  return value === null ? f.empty : money(value, false)
}

/** 帶正負號的金額：盈利、平均每場盈利。例 `+$1,523`、`−$4,000`、`$0` */
export function formatSignedMoney(value: number | null): string {
  return value === null ? f.empty : money(value, true)
}

/** 時薪。例 `+$250/hr` */
export function formatHourly(value: number | null): string {
  return value === null ? f.empty : `${money(value, true)}${f.hourlySuffix}`
}

/** 不帶正號的百分比（輸入為比率，0.123 → `12.3%`）：服務費比例 */
export function formatPercent(ratio: number | null): string {
  if (ratio === null) return f.empty
  const p = parts(ratio * 100, 1, false)
  return `${signPrefix(p.sign, false)}${p.text}${f.percent}`
}

/** 帶正負號的百分比（輸入為比率）：ROI。例 `+7.5%`、`−12.3%`、`0.0%` */
export function formatSignedPercent(ratio: number | null): string {
  if (ratio === null) return f.empty
  const p = parts(ratio * 100, 1, false)
  return `${signPrefix(p.sign, true)}${p.text}${f.percent}`
}

/** bb/hr，小數 1 位、帶正負號。例 `+7.5 bb/hr` */
export function formatBbPerHour(value: number | null): string {
  if (value === null) return f.empty
  const p = parts(value, 1, false)
  return `${signPrefix(p.sign, true)}${p.text}${f.bbPerHourSuffix}`
}

/** 分數加百分比：贏率 `13/26（50.0%）`、ITM% `8/40（20.0%）`；分母為 0 顯示 — */
export function formatFraction(numerator: number, denominator: number): string {
  if (denominator === 0) return f.empty
  return f.fraction(numerator, denominator, parts((numerator / denominator) * 100, 1, false).text)
}

/** 平均名次百分位：`前 23.5%（n=12）`；無樣本顯示 — */
export function formatPlacePercentile(p: PlacePercentile): string {
  if (p.value === null) return f.empty
  return f.placePercentile(parts(p.value * 100, 1, false).text, p.n)
}

/** 平均進場次數，小數 2 位。例 `1.25` */
export function formatAvgEntries(value: number | null): string {
  if (value === null) return f.empty
  const p = parts(value, 2, false)
  return `${signPrefix(p.sign, false)}${p.text}`
}

/** 總時數，固定小數 1 位（A8）。例 `4.0 小時`、`123.5 小時` */
export function formatHours(hours: number): string {
  const p = parts(hours, 1, false)
  return f.hours(`${signPrefix(p.sign, false)}${p.text}`)
}

/** 盲注顯示名稱 `sb/bb`（3.4），不存 DB */
export function stakeLabel(stake: Pick<Stake, 'sb' | 'bb'>): string {
  return f.stake(stake.sb, stake.bb)
}

/** 單場 bb 盈利，小數 1 位、帶正負號（7.2）。例 `+20.0 bb` */
export function formatBbProfit(value: number | null): string {
  if (value === null) return f.empty
  const p = parts(value, 1, false)
  return `${signPrefix(p.sign, true)}${p.text}${f.bbSuffix}`
}

/**
 * 時長（7.2）`4 小時 30 分`。
 * 規格未載明 0 分或 0 小時時是否省略，這裡一律顯示兩段（`4 小時 0 分`、`0 小時 30 分`）。
 */
export function formatDuration(minutes: number): string {
  return f.duration(Math.floor(minutes / 60), minutes % 60)
}

/**
 * MTT 名次（7.2）`第 12 名 / 180 人（前 6.7%）`；ratio 為 finishPlace ÷ fieldSize（0–1），
 * 百分比小數 1 位（與平均名次百分位相同）
 */
export function formatFinishPlace(place: number, fieldSize: number, ratio: number): string {
  return f.finishPlace(place, fieldSize, parts(ratio * 100, 1, false).text)
}

/** 建立 / 修改時間戳（ISO 8601 含時區）以裝置本地時間顯示 `2026/09/28 21:05` */
export function formatTimestamp(iso: string): string {
  const d = dayjs(iso)
  return d.isValid() ? d.format('YYYY/MM/DD HH:mm') : f.empty
}
