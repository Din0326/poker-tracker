// 數字輸入框用的字串處理（5.3）

/** 只含數字的字串加千分位逗號 */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 取出數字（移除逗號、$ 等所有非數字字元）並去掉多餘的前導 0（保留單一個 0） */
export function sanitizeDigits(text: string): string {
  return text.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}
