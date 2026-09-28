// repository 丟出的具名錯誤。UI 依 code 對應 strings.ts 的文字顯示；
// message 只供開發除錯，一律英文（避免違反 check:strings）。
// 注意：類別名稱不可與 Dexie / IndexedDB 內建錯誤名稱相同（例 NotFoundError、DataError、
// ConstraintError），否則在 Dexie transaction 內丟出時會被轉換成 DexieError。
import type { z } from 'zod'

export type RepositoryErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'DUPLICATE_NAME'
  | 'DUPLICATE_STAKE'
  | 'IN_USE'
  | 'REFERENCE_NOT_FOUND'
  | 'TYPE_IMMUTABLE'

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode
  constructor(code: RepositoryErrorCode, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

export interface ValidationIssue {
  path: (string | number)[]
  /** Zod 內建代碼訊息或 domain/schemas.ts 的 ISSUE 代碼 */
  message: string
}

/** 資料未通過 Zod schema */
export class ValidationError extends RepositoryError {
  readonly issues: ValidationIssue[]
  constructor(issues: ValidationIssue[]) {
    super('VALIDATION', `Validation failed: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    this.issues = issues
  }

  static fromZod(error: z.ZodError): ValidationError {
    return new ValidationError(
      error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: i.message,
      })),
    )
  }
}

export type EntityKind = 'session' | 'venue' | 'stake'

/** 指定 id 的資料不存在 */
export class RecordNotFoundError extends RepositoryError {
  readonly entity: EntityKind
  readonly id: string
  constructor(entity: EntityKind, id: string) {
    super('NOT_FOUND', `${entity} not found: ${id}`)
    this.entity = entity
    this.id = id
  }
}

/** 復原時同 id 的資料已存在 */
export class AlreadyExistsError extends RepositoryError {
  readonly entity: EntityKind
  readonly id: string
  constructor(entity: EntityKind, id: string) {
    super('ALREADY_EXISTS', `${entity} already exists: ${id}`)
    this.entity = entity
    this.id = id
  }
}

/** 場地名稱重複（去除前後空白、不分大小寫） */
export class DuplicateNameError extends RepositoryError {
  readonly venueName: string
  constructor(venueName: string) {
    super('DUPLICATE_NAME', `Venue name already exists: ${venueName}`)
    this.venueName = venueName
  }
}

/** 同一組 sb、bb 已存在 */
export class DuplicateStakeError extends RepositoryError {
  readonly sb: number
  readonly bb: number
  constructor(sb: number, bb: number) {
    super('DUPLICATE_STAKE', `Stake already exists: ${sb}/${bb}`)
    this.sb = sb
    this.bb = bb
  }
}

/** 已被場次參照，不可刪除或修改 sb、bb */
export class InUseError extends RepositoryError {
  readonly entity: 'venue' | 'stake'
  readonly id: string
  readonly usageCount: number
  constructor(entity: 'venue' | 'stake', id: string, usageCount: number) {
    super('IN_USE', `${entity} ${id} is referenced by ${usageCount} session(s)`)
    this.entity = entity
    this.id = id
    this.usageCount = usageCount
  }
}

/** 場次參照的 venueId 或 stakeId 不存在 */
export class ReferenceNotFoundError extends RepositoryError {
  readonly field: 'venueId' | 'stakeId'
  readonly id: string
  constructor(field: 'venueId' | 'stakeId', id: string) {
    super('REFERENCE_NOT_FOUND', `${field} not found: ${id}`)
    this.field = field
    this.id = id
  }
}

/** 場次 type 建立後不可變更（3.1） */
export class TypeImmutableError extends RepositoryError {
  constructor(from: string, to: string) {
    super('TYPE_IMMUTABLE', `Session type cannot change from ${from} to ${to}`)
  }
}
