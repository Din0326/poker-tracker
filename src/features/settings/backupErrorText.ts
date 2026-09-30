// 8.5 匯入失敗的顯示文字：失敗原因 + 第一筆有問題的資料位置
// 例「sessions 第 13 筆（id: …）：buyIns[0].fee 服務費不可大於買入」
import { formatIssuePath, type BackupError, type BackupIssueKind } from '../../domain'
import { strings } from '../../strings'

const e = strings.settings.importError
const i = e.issues

const issueText: Record<BackupIssueKind, string> = {
  required: i.required,
  invalidType: i.invalidType,
  notInteger: i.notInteger,
  tooSmall: i.tooSmall,
  tooBig: i.tooBig,
  invalidFormat: i.invalidFormat,
  invalidValue: i.invalidValue,
  unknownKey: i.unknownKey,
  invalid: i.invalid,
  invalidStartAt: i.invalidStartAt,
  feeExceedsAmount: i.feeExceedsAmount,
  cashBuyInCount: i.cashBuyInCount,
  cashStakeRequired: i.cashStakeRequired,
  stakeNotAllowed: i.stakeNotAllowed,
  fieldSizeNotAllowed: i.fieldSizeNotAllowed,
  finishPlaceNotAllowed: i.finishPlaceNotAllowed,
  finishPlaceRequiresFieldSize: i.finishPlaceRequiresFieldSize,
  finishPlaceExceedsFieldSize: i.finishPlaceExceedsFieldSize,
  notTrimmed: i.notTrimmed,
  emptyText: i.emptyText,
  textTooLong: i.textTooLong,
  bbLessThanSb: i.bbLessThanSb,
}

export interface BackupErrorText {
  reason: string
  /** 位置與欄位說明；檔案層級的錯誤（JSON、app、版本）為 null */
  detail: string | null
}

export function describeBackupError(error: BackupError): BackupErrorText {
  const reason = e.reasons[error.code]
  const issue = error.issue === undefined ? i.invalid : issueText[error.issue]
  const field = error.path && error.path.length > 0 ? formatIssuePath(error.path) : null

  switch (error.code) {
    case 'invalidJson':
    case 'notObject':
    case 'wrongApp':
    case 'invalidSchemaVersion':
    case 'schemaTooNew':
      return { reason, detail: null }
    case 'invalidStructure':
      return { reason, detail: e.detail(e.fieldAt(error.key ?? ''), null, issue) }
    default:
      break
  }

  const location =
    error.collection === 'settings'
      ? e.settingAt(error.key ?? '')
      : e.recordAt(error.collection ?? '', error.index ?? 0, error.id ?? null)
  const value = error.value ?? ''
  switch (error.code) {
    case 'duplicateId':
      return { reason, detail: e.detail(location, null, i.duplicateId(value)) }
    case 'duplicateVenueName':
      return { reason, detail: e.detail(location, null, i.duplicateVenueName(value)) }
    case 'duplicateStake':
      return { reason, detail: e.detail(location, null, i.duplicateStake(value)) }
    case 'missingReference':
      return {
        reason,
        detail: e.detail(location, null, field === 'stakeId' ? i.missingStake(value) : i.missingVenue(value)),
      }
    default:
      return { reason, detail: e.detail(location, field, issue) }
  }
}
