// SPEC-v2-hands 7.8 GTO Wizard 支援提示（需驗證，14 節 HQ14：以 tableSize 判斷，不支援仍可匯出，只提示）。
import type { Hand, HandDetail } from './types'

type GtoInput = Pick<Hand, 'gameType'> & { detail: Pick<HandDetail, 'tableSize' | 'ante' | 'straddle'> | null }

/**
 * 依 2026 年公開資料，GTO Wizard Hand History Analyzer 支援的牌局格式：
 * Cash 6max、Cash 6max straddle+ante、Cash 8max straddle+ante、Cash Heads-up、MTT 8max、Spin & Go、HU SNG。
 * 沒有 detail（簡易備忘）時無法判斷，回傳 false（簡易手牌本來就不匯出）。
 */
export function isLikelySupportedByGtoWizard(hand: GtoInput): boolean {
  const d = hand.detail
  if (d === null) return false
  if (hand.gameType === 'cash') {
    if (d.tableSize === 6 && d.ante === 0 && d.straddle === 0) return true
    if (d.tableSize === 6 && d.ante > 0 && d.straddle > 0) return true
    if (d.tableSize === 8 && d.ante > 0 && d.straddle > 0) return true
    return d.tableSize === 2
  }
  return d.tableSize === 8 || d.tableSize === 3 || d.tableSize === 2
}
