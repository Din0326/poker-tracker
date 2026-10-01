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
  duplicateBackerName: i.duplicateBackerName,
  backerShareTotalExceeded: i.backerShareTotalExceeded,
  // v2 手牌
  invalidPlayedAt: i.invalidPlayedAt,
  manualSecondsNotZero: i.manualSecondsNotZero,
  amountUnitMismatch: i.amountUnitMismatch,
  amountExceedsUnitMax: i.amountExceedsUnitMax,
  sourceFieldRequired: i.sourceFieldRequired,
  sourceFieldNotAllowed: i.sourceFieldNotAllowed,
  invalidCardCount: i.invalidCardCount,
  invalidBoardCount: i.invalidBoardCount,
  duplicateCard: i.duplicateCard,
  duplicateTag: i.duplicateTag,
  invalidSourceHandId: i.invalidSourceHandId,
  seatNotFound: i.seatNotFound,
  seatsNotSorted: i.seatsNotSorted,
  seatNoExceedsTableSize: i.seatNoExceedsTableSize,
  tooManySeats: i.tooManySeats,
  invalidStraddle: i.invalidStraddle,
  straddleNeedsThreePlayers: i.straddleNeedsThreePlayers,
  actionToRequired: i.actionToRequired,
  actionToNotAllowed: i.actionToNotAllowed,
  tournamentRakeNotZero: i.tournamentRakeNotZero,
  collectedNotSorted: i.collectedNotSorted,
  invalidSeatName: i.invalidSeatName,
  seatNameNotAllowed: i.seatNameNotAllowed,
  invalidHeroName: i.invalidHeroName,
  heroNameReserved: i.heroNameReserved,
  kindMismatch: i.kindMismatch,
  summaryMismatch: i.summaryMismatch,
  collectedMustBeEmpty: i.collectedMustBeEmpty,
  sessionTypeMismatch: i.sessionTypeMismatch,
}

/**
 * 欄位路徑的顯示文字。出資者欄位改用中文位置（8.5 例「出資者第 2 位：比例格式錯誤」），
 * 例 ['backers', 1, 'sharePermille'] → 「出資者第 2 位 比例」；其餘維持 `buyIns[0].fee` 格式。
 */
export function describeFieldPath(path: readonly (string | number)[]): string | null {
  if (path.length === 0) return null
  if (path[0] === 'backers') {
    const index = path[1]
    if (typeof index !== 'number') return e.backersField
    const key = path[2]
    const label = typeof key === 'string' && key in e.backerFields ? e.backerFields[key as keyof typeof e.backerFields] : null
    return e.backerAt(index + 1, label ?? (key === undefined ? null : String(key)))
  }
  return formatIssuePath(path)
}

export interface BackupErrorText {
  reason: string
  /** 位置與欄位說明；檔案層級的錯誤（JSON、app、版本）為 null */
  detail: string | null
}

export function describeBackupError(error: BackupError): BackupErrorText {
  const reason = e.reasons[error.code]
  const issue = error.issue === undefined ? i.invalid : issueText[error.issue]
  const field = error.path ? describeFieldPath(error.path) : null

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
        detail: e.detail(
          location,
          null,
          field === 'stakeId' ? i.missingStake(value) : field === 'sessionId' ? i.missingSession(value) : i.missingVenue(value),
        ),
      }
    // v2 手牌（10.2 例「第 12 筆手牌：行動不合法（第 5 個行動）」）
    case 'invalidHandDetail': {
      const text = error.handIssue === undefined ? i.invalid : e.handIssues[error.handIssue]
      const at = error.actionIndex === undefined ? '' : e.actionAt(error.actionIndex)
      return { reason, detail: e.detail(location, null, `${text}${at}`) }
    }
    case 'duplicateExportSeq':
      return { reason, detail: e.detail(location, null, i.duplicateExportSeq(value)) }
    case 'duplicateSourceHandId':
      return { reason, detail: e.detail(location, null, i.duplicateSourceHandId(value)) }
    default:
      return { reason, detail: e.detail(location, field, issue) }
  }
}
