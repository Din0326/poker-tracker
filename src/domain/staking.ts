// 賣股份（v1.2）的輸入轉換與出資者名稱建議（純函式）。
// - 5.3：比例「12.5」→ sharePermille 125、倍數「1.15」→ markupPermille 1150。
//   以字串拆整數與小數部分再組成整數，不經過浮點數相乘，轉換結果精確。
// - 5.3 名稱建議：來源為所有已儲存場次的 backers[].name，依最近使用排序、不分大小寫去重。
import { backerNameKey, MAX_MARKUP_PERMILLE, MAX_SHARE_PERMILLE, MIN_MARKUP_PERMILLE } from './schemas'
import { sortReverseChronological } from './sort'
import type { Session } from './types'

/** 比例最多 1 位小數、倍數最多 3 位小數（5.3） */
export const SHARE_DECIMALS = 1
export const MARKUP_DECIMALS = 3
/** 名稱建議最多顯示 8 筆（5.3） */
export const MAX_BACKER_SUGGESTIONS = 8

/**
 * 小數輸入框的字元過濾（5.3）：只保留數字與第一個小數點。
 * 貼上含 `%`、`×`、`x`、空白等字元時一併移除。
 */
export function sanitizeDecimal(text: string): string {
  const kept = text.replace(/[^\d.]/g, '')
  const dot = kept.indexOf('.')
  return dot === -1 ? kept : `${kept.slice(0, dot + 1)}${kept.slice(dot + 1).replace(/\./g, '')}`
}

export type DecimalParseResult =
  | { ok: true; value: number }
  /** empty：空白；format：不是數字或小數位數過多；range：超出範圍（比例為 0 時回傳 empty，見 5.4） */
  | { ok: false; reason: 'empty' | 'format' | 'range' }

/**
 * 十進位字串轉為「× 10^decimals」的整數（例 decimals = 1：'12.5' → 125）。
 * 不是數字或小數位數超過 decimals 時回傳 null。允許 '12.'（視為 12）與 '.5'（視為 0.5）。
 */
export function decimalToScaledInt(text: string, decimals: number): number | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text.trim())
  if (!m) return null
  const intPart = m[1] ?? ''
  const fracPart = m[2] ?? ''
  if (intPart === '' && fracPart === '') return null
  if (fracPart.length > decimals) return null
  return Number(intPart === '' ? '0' : intPart) * 10 ** decimals + Number(fracPart.padEnd(decimals, '0') || '0')
}

/**
 * 比例輸入（%）→ sharePermille（5.3、5.4）：
 * 空白或為 0 → empty；不是數字或超過 1 位小數 → format；大於 100 → range。
 */
export function parseShareInput(text: string): DecimalParseResult {
  if (text.trim() === '') return { ok: false, reason: 'empty' }
  const value = decimalToScaledInt(text, SHARE_DECIMALS)
  if (value === null) return { ok: false, reason: 'format' }
  if (value === 0) return { ok: false, reason: 'empty' }
  if (value > MAX_SHARE_PERMILLE) return { ok: false, reason: 'range' }
  return { ok: true, value }
}

/**
 * 加價倍數輸入 → markupPermille（5.3、5.4）：
 * 空白 → empty；不是數字或超過 3 位小數 → format；小於 1.0 或大於 3.0 → range。
 */
export function parseMarkupInput(text: string): DecimalParseResult {
  if (text.trim() === '') return { ok: false, reason: 'empty' }
  const value = decimalToScaledInt(text, MARKUP_DECIMALS)
  if (value === null) return { ok: false, reason: 'format' }
  if (value < MIN_MARKUP_PERMILLE || value > MAX_MARKUP_PERMILLE) return { ok: false, reason: 'range' }
  return { ok: true, value }
}

/**
 * 出資者名稱歷史（5.3）：依最近使用排序（該名稱出現過的場次中最新的 startAt 由新到舊，
 * 同時間依 createdAt 由新到舊），去除前後空白後不分大小寫視為同一名稱，保留最近一次使用時的寫法。
 */
export function backerNameHistory(sessions: readonly Pick<Session, 'startAt' | 'createdAt' | 'backers'>[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const s of sortReverseChronological(sessions.filter((x) => x.backers.length > 0))) {
    for (const b of s.backers) {
      const name = b.name.trim()
      const key = backerNameKey(name)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
  }
  return names
}

/**
 * 名稱建議清單（5.3）：輸入框有文字時只列出包含該文字的名稱（部分符合、不分大小寫），空白時列出全部；
 * 排除目前表單其他列已填的名稱（去空白、不分大小寫比較）；最多 8 筆。
 */
export function filterBackerSuggestions(
  history: readonly string[],
  query: string,
  otherNames: readonly string[],
  limit: number = MAX_BACKER_SUGGESTIONS,
): string[] {
  const q = backerNameKey(query)
  const excluded = new Set(otherNames.map(backerNameKey).filter((k) => k !== ''))
  const result: string[] = []
  for (const name of history) {
    const key = backerNameKey(name)
    if (excluded.has(key)) continue
    if (q !== '' && !key.includes(q)) continue
    result.push(name)
    if (result.length >= limit) break
  }
  return result
}
