// 與執行環境時區無關的時間戳期望值（CI 為 UTC、開發者電腦可能在任何時區）

/** 指定本地時間點的時區偏移字串，例如 `+08:00`、`-04:00`、`+00:00`（不經 dayjs，獨立於被測程式計算） */
export function localOffsetSuffix(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const mm = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}

/** 本地牆上時間 `YYYY-MM-DDTHH:mm:ss` 加上該時間點的本地偏移；月份為 1 起算 */
export function localIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string {
  const date = new Date(year, month - 1, day, hour, minute, second)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:${p(second)}${localOffsetSuffix(date)}`
}
