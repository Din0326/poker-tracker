// SPEC-v2-hands 8.2 步驟 3、8.6、8.7：GG 匯入的預覽結果（尚未寫入）。純函式：輸入每手的解析結果與資料庫中已存在的
// sourceHandId，輸出可匯入的手牌、重複略過數、無法匯入數與依原因分組的明細。
// 數字定義（8.7）：可匯入 = 解析成功且不重複；重複略過 = 8.6；無法匯入 = 8.5 拒絕。三者相加 = 拆出的總手數。
import type { GgHandResult, GgRejectReason, ParsedGgHand } from './parse/gg'

/** 8.2：每個原因可展開看前 20 筆明細 */
export const GG_REJECT_SAMPLE_LIMIT = 20

export interface GgImportItem {
  /** 第幾個檔案（1 起算；zip 內的每個 `.txt` 各算一個檔案） */
  fileIndex: number
  /** 該檔案內第幾手（1 起算） */
  handIndex: number
  result: GgHandResult
}

export interface GgRejectSample {
  /** 原站手牌編號；取不到時為 null（畫面改顯示「第 3 個檔案第 18 手」） */
  sourceHandId: string | null
  fileIndex: number
  handIndex: number
  reason: GgRejectReason
}

export interface GgRejectGroup {
  /** 分組鍵：原因代碼（不支援的前綴另依前綴分組）；同一組內行號可不同 */
  key: string
  /** 該組第一筆的原因（畫面以此顯示分組名稱） */
  reason: GgRejectReason
  count: number
  /** 前 GG_REJECT_SAMPLE_LIMIT 筆明細 */
  samples: GgRejectSample[]
}

export interface GgImportPreview {
  /** 拆出的總手數 */
  total: number
  /** 可匯入的手牌（依出現順序） */
  importable: ParsedGgHand[]
  duplicates: number
  rejected: number
  /** 依原因分組；依手數由多到少，同手數依第一次出現的順序 */
  groups: GgRejectGroup[]
}

export function rejectGroupKey(reason: GgRejectReason): string {
  return reason.code === 'unknownPrefix' ? `unknownPrefix:${reason.prefix}` : reason.code
}

/** 解析成功的手牌的 sourceHandId（供資料庫去重查詢） */
export function parsedSourceHandIds(items: readonly GgImportItem[]): string[] {
  return [...new Set(items.flatMap((i) => (i.result.ok ? [i.result.hand.sourceHandId] : [])))]
}

/**
 * 8.6 去重與 8.7 摘要：sourceHandId 已存在於資料庫，或同一次匯入中先前已出現（第一次出現的計為可匯入）→ 重複略過。
 * 去重只針對解析成功的手牌；被拒絕的手牌一律計入無法匯入。
 */
export function buildGgImportPreview(items: readonly GgImportItem[], existing: ReadonlySet<string>): GgImportPreview {
  const importable: ParsedGgHand[] = []
  const seen = new Set<string>()
  let duplicates = 0
  const groups = new Map<string, GgRejectGroup & { first: number }>()
  items.forEach((item, order) => {
    const r = item.result
    if (r.ok) {
      const id = r.hand.sourceHandId
      if (existing.has(id) || seen.has(id)) duplicates++
      else {
        seen.add(id)
        importable.push(r.hand)
      }
      return
    }
    const key = rejectGroupKey(r.reason)
    let g = groups.get(key)
    if (!g) {
      g = { key, reason: r.reason, count: 0, samples: [], first: order }
      groups.set(key, g)
    }
    g.count++
    if (g.samples.length < GG_REJECT_SAMPLE_LIMIT) {
      g.samples.push({ sourceHandId: r.sourceHandId, fileIndex: item.fileIndex, handIndex: item.handIndex, reason: r.reason })
    }
  })
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.first - b.first)
  return {
    total: items.length,
    importable,
    duplicates,
    rejected: items.length - importable.length - duplicates,
    groups: sorted.map((g) => ({ key: g.key, reason: g.reason, count: g.count, samples: g.samples })),
  }
}
