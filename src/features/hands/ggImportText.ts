// SPEC-v2-hands 8.5、8.2：GG 匯入拒絕原因的畫面文字（文字照 8.5 / 第 8 節，集中在字串檔）
import type { GgRejectReason, GgRejectSample } from '../../domain/hands'
import { strings } from '../../strings'

const r = strings.hands.ggImport.reasons

/** 分組名稱（不含行號）：例「無法辨識的內容」「不支援 Run It Twice（發兩次牌）」 */
export function ggReasonGroupText(reason: GgRejectReason): string {
  switch (reason.code) {
    case 'unknownPrefix':
      return r.unknownPrefix(reason.prefix)
    case 'unrecognizedLine':
    case 'illegalAction':
      return r[reason.code]
    default:
      return r[reason.code]
  }
}

/** 單筆原因（含行號）：例「無法辨識的內容：第 18 行」 */
export function ggReasonText(reason: GgRejectReason): string {
  const base = ggReasonGroupText(reason)
  if ((reason.code === 'unrecognizedLine' || reason.code === 'illegalAction') && reason.line !== null) return r.withLine(base, reason.line)
  return base
}

/** 明細的手牌識別：原站手牌編號，取不到時「第 3 個檔案第 18 手」（8.2） */
export function ggSampleWho(sample: GgRejectSample): string {
  return sample.sourceHandId ?? strings.hands.ggImport.sampleWhere(sample.fileIndex, sample.handIndex)
}
