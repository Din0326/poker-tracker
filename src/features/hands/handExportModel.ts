// SPEC-v2-hands 7.1 匯出 sheet 的資料準備（純函式，不含 React 與 DB）。匯出文字一律由 domain/hands/export 產生。
import {
  EXPORT_LIMIT,
  exportPokerStars,
  handsExportFileName,
  isExportable,
  isLikelySupportedByGtoWizard,
  singleHandExportFileName,
  type Hand,
} from '../../domain/hands'

/** 匯出範圍：列表的篩選結果（7.1「匯出目前篩選結果中的完整手牌」）或詳情的單手（「匯出這手」） */
export interface ExportRequest {
  /** 要匯出的完整手牌 id（尚未讀取 detail） */
  completeIds: string[]
  /** 範圍內被略過的簡易手牌數（簡易手牌一律不匯出、不報錯） */
  skippedSimple: number
  /** 詳情的「匯出這手」：檔名為 poker-hand-<匯出編號>.txt */
  single: boolean
}

/** 由列表的篩選結果（或單手）決定匯出範圍；只依 kind 判斷，不需要 detail */
export function exportRequestFor(hands: readonly Pick<Hand, 'id' | 'kind'>[], single = false): ExportRequest {
  const completeIds: string[] = []
  let skippedSimple = 0
  for (const h of hands) {
    if (h.kind === 'complete') completeIds.push(h.id)
    else skippedSimple++
  }
  return { completeIds, skippedSimple, single }
}

/** 超過單次匯出上限（7.1、HQ28）：不讀取、不顯示匯出按鈕 */
export function exceedsExportLimit(request: ExportRequest): boolean {
  return request.completeIds.length > EXPORT_LIMIT
}

/** sheet 開啟後預先組好的匯出內容（按「分享 / 下載」時同步建立 File，7.1） */
export interface PreparedExport {
  text: string
  count: number
  /** 7.8 GTO Wizard 可能無法分析的手數 */
  unsupported: number
  /** 檔名（多手時依按下當時的本地時間） */
  fileName: (now: Date) => string
}

/**
 * 組出匯出文字：只取完整手牌（讀取期間被改成簡易或刪除的手牌不匯出），依 7.1 排序，名稱依 7.3。
 * 完整手牌為 0 手時回傳 null。
 */
export function prepareExport(hands: readonly Hand[], heroName: string, single: boolean): PreparedExport | null {
  const exportable = hands.filter(isExportable)
  if (exportable.length === 0) return null
  const first = exportable[0]!
  return {
    text: exportPokerStars(exportable, heroName),
    count: exportable.length,
    unsupported: exportable.filter((h) => !isLikelySupportedByGtoWizard(h)).length,
    fileName: single && exportable.length === 1 ? () => singleHandExportFileName(first.exportSeq) : handsExportFileName,
  }
}

const countFormat = new Intl.NumberFormat('en-US')

/** 手數顯示（千分位，例 10,000） */
export function countText(n: number): string {
  return countFormat.format(n)
}
