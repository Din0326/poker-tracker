// 8.4 匯出備份、8.5 匯入備份的純函式：組出備份物件、檔名、遷移與驗證。
// 不碰 DB 與 UI；錯誤以代碼 + 位置回傳，由 UI 依 strings.ts 組成文字。
import dayjs from 'dayjs'
import type { z } from 'zod'
import { HAND_ISSUE, handSchema } from './hands/schemas'
import { verifyHand, type HandDetailIssueCode } from './hands/summary'
import type { ActionErrorCode } from './hands/engine'
import type { Hand, HandGameType } from './hands/types'
import { ISSUE, sessionSchema, settingSchemas, stakeSchema, timestampSchema, venueSchema } from './schemas'
import { SETTING_KEYS, type Session, type SessionType, type SettingKey, type Settings, type Stake, type Venue } from './types'

export const BACKUP_APP = 'poker-tracker'
/**
 * 目前的備份檔格式版本（8.4）：v1.0–v1.1 為 1；v1.2（賣股份）起為 2；v2（手牌，SPEC-v2-hands 10.1）起為 3。
 * 每次升版都需在 BACKUP_MIGRATIONS 加入 v(n-1) → v(n) 的遷移
 */
export const CURRENT_SCHEMA_VERSION = 3

/** 備份檔不包含的設定（8.4、v2 10.1）：草稿（場次與手牌）與上次備份時間 */
export const NON_EXPORTED_SETTING_KEYS = ['recordDraft', 'lastBackupAt', 'handDraft'] as const satisfies readonly SettingKey[]
type NonExportedKey = (typeof NON_EXPORTED_SETTING_KEYS)[number]
export type ExportedSettingKey = Exclude<SettingKey, NonExportedKey>
export const EXPORTED_SETTING_KEYS = SETTING_KEYS.filter(
  (k): k is ExportedSettingKey => !(NON_EXPORTED_SETTING_KEYS as readonly string[]).includes(k),
)

export type BackupSettings = Partial<Pick<Settings, ExportedSettingKey>>

/** 備份檔格式（8.4） */
export interface BackupFile {
  app: typeof BACKUP_APP
  schemaVersion: number
  /** ISO 8601 含時區偏移，例 2026-09-28T21:05:00+08:00 */
  exportedAt: string
  sessions: Session[]
  venues: Venue[]
  stakes: Stake[]
  /** v2 手牌（10.1），依 id 排序 */
  hands: Hand[]
  settings: BackupSettings
}

const TOP_LEVEL_KEYS = ['app', 'schemaVersion', 'exportedAt', 'sessions', 'venues', 'stakes', 'hands', 'settings'] as const

/** ISO 8601 含本地時區偏移（與 db 層 toIsoWithOffset 相同格式） */
export function isoWithOffset(date: Date): string {
  return dayjs(date).format('YYYY-MM-DDTHH:mm:ssZ')
}

export interface BackupSource {
  sessions: readonly Session[]
  venues: readonly Venue[]
  stakes: readonly Stake[]
  hands: readonly Hand[]
  /** 目前的全部設定；recordDraft、lastBackupAt、handDraft 會被排除 */
  settings: Partial<Settings>
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const bySortOrderThenId = <T extends { id: string; sortOrder: number }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || byId(a, b)

/**
 * 組出備份物件（8.4）。順序固定，同一份資料每次匯出結果相同：
 * sessions、hands 依 id；venues、stakes 依 sortOrder（同值再依 id）；settings 依 3.5 的 key 順序。
 */
export function buildBackup(source: BackupSource, now: Date): BackupFile {
  const settings: BackupSettings = {}
  for (const key of EXPORTED_SETTING_KEYS) {
    const value = source.settings[key]
    if (value !== undefined) (settings as Record<string, unknown>)[key] = value
  }
  return {
    app: BACKUP_APP,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: isoWithOffset(now),
    sessions: [...source.sessions].sort(byId),
    venues: [...source.venues].sort(bySortOrderThenId),
    stakes: [...source.stakes].sort(bySortOrderThenId),
    hands: [...source.hands].sort(byId),
    settings,
  }
}

// ---------------------------------------------------------------------------
// 升級前的備份（v1 3.7「升級前的備份提示」、8.4「升級前的備份」，v1.6）
// ---------------------------------------------------------------------------

/**
 * 舊資料庫的 Dexie 版本 → 升級前備份的 schemaVersion（8.4 表格）：
 * version 1（v1.0–v1.1）→ 1、version 2（v1.2–v1.4.1）→ 2、version 3（產品 v2）→ 3
 */
export const BACKUP_SCHEMA_BY_DB_VERSION: Readonly<Record<number, number>> = { 1: 1, 2: 2, 3: 3 }

/** 對應的 schemaVersion；沒有定義的版本回傳 null（呼叫端不提供匯出） */
export function backupSchemaForDbVersion(dbVersion: number): number | null {
  return BACKUP_SCHEMA_BY_DB_VERSION[dbVersion] ?? null
}

/** 升級前舊資料庫的原始資料（原樣，型別不保證符合目前版本） */
export interface LegacyBackupSource {
  sessions: readonly Record<string, unknown>[]
  venues: readonly Record<string, unknown>[]
  stakes: readonly Record<string, unknown>[]
  hands: readonly Record<string, unknown>[]
  settings: Readonly<Record<string, unknown>>
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const legacyById = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const x = str(a.id)
  const y = str(b.id)
  return x < y ? -1 : x > y ? 1 : 0
}
const legacyBySortOrderThenId = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const x = typeof a.sortOrder === 'number' ? a.sortOrder : 0
  const y = typeof b.sortOrder === 'number' ? b.sortOrder : 0
  return x - y || legacyById(a, b)
}

/**
 * 組出升級前的備份物件（8.4「升級前的備份」）：每筆資料原樣寫出、不轉換也不補欄位，
 * 讓新版以 8.5 的遷移（1 → 2 → 3）匯入。排序與 settings 排除規則同 buildBackup；
 * schemaVersion < 3 時不含 hands 欄位（舊格式沒有此欄位，2 → 3 遷移會補上 []）。
 */
export function buildLegacyBackup(source: LegacyBackupSource, schemaVersion: number, now: Date): Record<string, unknown> {
  const settings: Record<string, unknown> = {}
  for (const key of EXPORTED_SETTING_KEYS) {
    const value = source.settings[key]
    if (value !== undefined) settings[key] = value
  }
  return {
    app: BACKUP_APP,
    schemaVersion,
    exportedAt: isoWithOffset(now),
    sessions: [...source.sessions].sort(legacyById),
    venues: [...source.venues].sort(legacyBySortOrderThenId),
    stakes: [...source.stakes].sort(legacyBySortOrderThenId),
    ...(schemaVersion >= 3 ? { hands: [...source.hands].sort(legacyById) } : {}),
    settings,
  }
}

/** 備份檔內容（JSON 文字，縮排 2 格方便人工檢視） */
export function serializeBackup(backup: BackupFile | Record<string, unknown>): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

/** 檔名 `poker-backup-YYYYMMDD-HHmm.json`（本地時間） */
export function backupFileName(now: Date): string {
  return `poker-backup-${dayjs(now).format('YYYYMMDD-HHmm')}.json`
}

// ---------------------------------------------------------------------------
// 遷移（8.5：schemaVersion 小於目前版本時，先遷移再匯入）
// ---------------------------------------------------------------------------

export type BackupData = Record<string, unknown> & { schemaVersion: number }
/** key 為來源版本 n，函式把 v(n) 的資料轉為 v(n+1)（schemaVersion 由 migrateBackup 更新） */
export type BackupMigrations = Readonly<Record<number, (data: BackupData) => Record<string, unknown>>>

/**
 * 8.5 定義的遷移：
 * - 1 → 2：每筆 session 設定 `backers: []`（v1 備份檔沒有此欄位；即使檔案中意外出現也一律覆寫為 []），
 *   其他欄位不變。sessions 不是陣列、或某筆不是物件時原樣保留，交給後續驗證回報錯誤。
 * - 2 → 3（v2 10.2）：設定 `hands: []`（v2 備份檔沒有此欄位；即使檔案中意外出現也一律覆寫為 []），其他欄位不變。
 */
export const BACKUP_MIGRATIONS: BackupMigrations = {
  1: (data) => ({
    ...data,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s: unknown) => (isPlainObject(s) ? { ...s, backers: [] } : s))
      : data.sessions,
  }),
  2: (data) => ({ ...data, hands: [] }),
}

/** 依版本逐步升級到 target；缺少某一步的遷移時丟出錯誤（程式錯誤，不應發生） */
export function migrateBackup(
  data: BackupData,
  migrations: BackupMigrations = BACKUP_MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): BackupData {
  let current = data
  while (current.schemaVersion < target) {
    const from = current.schemaVersion
    const step = migrations[from]
    if (!step) throw new Error(`Missing backup migration from v${from}`)
    current = { ...step(current), schemaVersion: from + 1 }
  }
  return current
}

// ---------------------------------------------------------------------------
// 驗證（8.5）
// ---------------------------------------------------------------------------

export type BackupErrorCode =
  | 'invalidJson'
  | 'notObject'
  | 'wrongApp'
  | 'invalidSchemaVersion'
  | 'schemaTooNew'
  | 'invalidStructure'
  | 'invalidRecord'
  | 'duplicateId'
  | 'duplicateVenueName'
  | 'duplicateStake'
  | 'missingReference'
  /** v2 10.3：手牌的 3.9 結構驗證失敗（附行動序號） */
  | 'invalidHandDetail'
  | 'duplicateExportSeq'
  | 'duplicateSourceHandId'

export type BackupCollection = 'sessions' | 'venues' | 'stakes' | 'hands' | 'settings'

type CustomIssueKind = keyof typeof ISSUE | keyof typeof HAND_ISSUE

/** 欄位問題種類（Zod 代碼或 domain/schemas.ts 的 ISSUE 轉成的名稱） */
export type BackupIssueKind =
  | 'required'
  | 'invalidType'
  | 'notInteger'
  | 'tooSmall'
  | 'tooBig'
  | 'invalidFormat'
  | 'invalidValue'
  | 'unknownKey'
  | 'invalid'
  | CustomIssueKind
  /** 手牌：kind 與 3.9 判定不一致 */
  | 'kindMismatch'
  /** 手牌：摘要欄位與推導結果不一致（path 為該欄位） */
  | 'summaryMismatch'
  /** 手牌：簡易手牌的 collected 必須為 [] */
  | 'collectedMustBeEmpty'
  /** 手牌：關聯場次的類型不相容（3.11） */
  | 'sessionTypeMismatch'

export interface BackupError {
  code: BackupErrorCode
  /** 有問題的集合（invalidRecord、duplicate*、missingReference） */
  collection?: BackupCollection
  /** 集合內第幾筆，1 起算 */
  index?: number
  /** 該筆資料的 id（取不到時為 null） */
  id?: string | null
  /** settings 的 key，或 invalidStructure 時的頂層欄位名稱 */
  key?: string
  /** 該筆資料內的欄位路徑，例 ['buyIns', 0, 'fee'] */
  path?: (string | number)[]
  issue?: BackupIssueKind
  /** 重複的 id / 名稱 / 盲注 / exportSeq / sourceHandId，或不存在的參照 id */
  value?: string
  /** invalidHandDetail：結構驗證失敗的原因 */
  handIssue?: HandDetailIssueCode
  /** invalidHandDetail 且 handIssue 為 illegalAction：第幾個行動（1 起算）與引擎的錯誤代碼 */
  actionIndex?: number
  actionError?: ActionErrorCode
}

export type BackupResult = { ok: true; backup: BackupFile } | { ok: false; error: BackupError }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const customIssueByCode = new Map<string, CustomIssueKind>(
  ([...Object.entries(ISSUE), ...Object.entries(HAND_ISSUE)] as [CustomIssueKind, string][]).map(([kind, code]) => [code, kind]),
)

/** 沿著路徑取值，用來判斷欄位是缺少（undefined）還是型別錯誤 */
function valueAt(root: unknown, path: readonly (string | number)[]): unknown {
  let cur: unknown = root
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[p]
  }
  return cur
}

/** 取 Zod 錯誤的第一個問題，轉成路徑與問題種類 */
function firstIssue(error: z.ZodError, input: unknown): { path: (string | number)[]; issue: BackupIssueKind } {
  const i = error.issues[0]
  if (!i) return { path: [], issue: 'invalid' }
  const path = i.path.filter((p): p is string | number => typeof p !== 'symbol')
  switch (i.code) {
    case 'invalid_type':
      if (valueAt(input, path) === undefined) return { path, issue: 'required' }
      return { path, issue: i.expected === 'int' ? 'notInteger' : 'invalidType' }
    case 'too_small':
      return { path, issue: 'tooSmall' }
    case 'too_big':
      return { path, issue: 'tooBig' }
    case 'invalid_format':
      return { path, issue: 'invalidFormat' }
    case 'invalid_value':
      return { path, issue: 'invalidValue' }
    case 'unrecognized_keys':
      return { path: [...path, ...(i.keys[0] !== undefined ? [i.keys[0]] : [])], issue: 'unknownKey' }
    case 'custom':
      return { path, issue: customIssueByCode.get(i.message) ?? 'invalid' }
    default:
      return { path, issue: 'invalid' }
  }
}

function recordId(item: unknown): string | null {
  return isPlainObject(item) && typeof item.id === 'string' ? item.id : null
}

/** 路徑顯示格式：`buyIns[0].fee` */
export function formatIssuePath(path: readonly (string | number)[]): string {
  return path.reduce<string>((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : acc === '' ? p : `${acc}.${p}`), '')
}

const fail = (error: BackupError): BackupResult => ({ ok: false, error })

/** 8.5：先解析 JSON，再依序驗證 */
export function parseBackupText(text: string): BackupResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return fail({ code: 'invalidJson' })
  }
  return validateBackup(data)
}

function validateCollection<T>(
  collection: 'sessions' | 'venues' | 'stakes' | 'hands',
  items: readonly unknown[],
  schema: z.ZodType<T>,
): { ok: true; data: T[] } | { ok: false; error: BackupError } {
  const data: T[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const r = schema.safeParse(item)
    if (!r.success) {
      return {
        ok: false,
        error: { code: 'invalidRecord', collection, index: i + 1, id: recordId(item), ...firstIssue(r.error, item) },
      }
    }
    data.push(r.data)
  }
  return { ok: true, data }
}

/** 同一集合內 id 不可重複；回傳第一筆重複（第二次出現的位置） */
function findDuplicateId(collection: 'sessions' | 'venues' | 'stakes' | 'hands', items: readonly { id: string }[]): BackupError | null {
  const seen = new Set<string>()
  for (let i = 0; i < items.length; i++) {
    const id = items[i]!.id
    if (seen.has(id)) return { code: 'duplicateId', collection, index: i + 1, id, path: ['id'], value: id }
    seen.add(id)
  }
  return null
}

/**
 * 8.5 驗證順序（任一步失敗即停止）：
 * 1. 是物件 → 2. app 為 poker-tracker → 3. schemaVersion 為正整數且不大於目前版本（較舊時先遷移）
 * → 4. 頂層結構（exportedAt 與五個集合）→ 5. 每筆資料通過 Zod（sessions、venues、stakes、hands、settings 依序；
 *    hands 含 amountUnit 推導檢查，v2 10.2 第 1 項）
 * → v2 10.2 第 2 項：每筆有 detail 的手牌通過 3.9 結構驗證、kind 與摘要欄位一致
 * → v2 10.2 第 3 項：手牌的 sessionId 存在於檔案的 sessions 中（或為 null）且類型相容（3.11）
 * → v2 10.2 第 4 項：exportSeq 不重複；source 為 gg 的 sourceHandId 不重複
 * → 6. id 不重複（含 hands）、場地名稱不重複（不分大小寫）、盲注 sb/bb 不重複（3.3、3.4）
 * → 7. 參照的 venueId、stakeId 都存在於備份檔內
 *
 * settings：允許缺 key；recordDraft、lastBackupAt、handDraft 若存在直接忽略（匯入時本來就會清除 / 覆寫）；
 * 其他未知 key 視為錯誤。頂層未知欄位也視為錯誤。
 */
export function validateBackup(input: unknown): BackupResult {
  if (!isPlainObject(input)) return fail({ code: 'notObject' })
  if (input.app !== BACKUP_APP) return fail({ code: 'wrongApp' })
  const version = input.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail({ code: 'invalidSchemaVersion' })
  }
  if (version > CURRENT_SCHEMA_VERSION) return fail({ code: 'schemaTooNew' })

  const data = migrateBackup({ ...input, schemaVersion: version })

  // ---- 頂層結構 ----
  const unknownKey = Object.keys(data).find((k) => !(TOP_LEVEL_KEYS as readonly string[]).includes(k))
  if (unknownKey !== undefined) return fail({ code: 'invalidStructure', key: unknownKey, issue: 'unknownKey' })
  const exportedAt = timestampSchema.safeParse(data.exportedAt)
  if (!exportedAt.success) {
    return fail({
      code: 'invalidStructure',
      key: 'exportedAt',
      issue: data.exportedAt === undefined ? 'required' : 'invalidFormat',
    })
  }
  for (const key of ['sessions', 'venues', 'stakes', 'hands'] as const) {
    if (!Array.isArray(data[key])) {
      return fail({ code: 'invalidStructure', key, issue: data[key] === undefined ? 'required' : 'invalidType' })
    }
  }
  if (!isPlainObject(data.settings)) {
    return fail({
      code: 'invalidStructure',
      key: 'settings',
      issue: data.settings === undefined ? 'required' : 'invalidType',
    })
  }

  // ---- 每筆資料 ----
  const sessions = validateCollection('sessions', data.sessions as unknown[], sessionSchema)
  if (!sessions.ok) return fail(sessions.error)
  const venues = validateCollection('venues', data.venues as unknown[], venueSchema)
  if (!venues.ok) return fail(venues.error)
  const stakes = validateCollection('stakes', data.stakes as unknown[], stakeSchema)
  if (!stakes.ok) return fail(stakes.error)
  const hands = validateCollection('hands', data.hands as unknown[], handSchema)
  if (!hands.ok) return fail(hands.error)

  const settings: BackupSettings = {}
  for (const [key, value] of Object.entries(data.settings)) {
    if ((NON_EXPORTED_SETTING_KEYS as readonly string[]).includes(key)) continue
    if (!(EXPORTED_SETTING_KEYS as readonly string[]).includes(key)) {
      return fail({ code: 'invalidRecord', collection: 'settings', key, path: [], issue: 'unknownKey' })
    }
    const k = key as ExportedSettingKey
    const r = (settingSchemas[k] as z.ZodType).safeParse(value)
    if (!r.success) return fail({ code: 'invalidRecord', collection: 'settings', key, ...firstIssue(r.error, value) })
    ;(settings as Record<string, unknown>)[k] = r.data
  }

  // ---- v2 10.2：手牌的結構驗證、參照、編號不重複 ----
  const handError = validateHands(hands.data, sessions.data)
  if (handError) return fail(handError)

  // ---- 不可重複（3.3、3.4） ----
  const dup =
    findDuplicateId('sessions', sessions.data) ??
    findDuplicateId('venues', venues.data) ??
    findDuplicateId('stakes', stakes.data) ??
    findDuplicateId('hands', hands.data)
  if (dup) return fail(dup)

  const names = new Set<string>()
  for (let i = 0; i < venues.data.length; i++) {
    const v = venues.data[i]!
    const key = v.name.trim().toLowerCase()
    if (names.has(key)) {
      return fail({ code: 'duplicateVenueName', collection: 'venues', index: i + 1, id: v.id, path: ['name'], value: v.name })
    }
    names.add(key)
  }
  const pairs = new Set<string>()
  for (let i = 0; i < stakes.data.length; i++) {
    const s = stakes.data[i]!
    const key = `${s.sb}/${s.bb}`
    if (pairs.has(key)) {
      return fail({ code: 'duplicateStake', collection: 'stakes', index: i + 1, id: s.id, path: ['sb'], value: key })
    }
    pairs.add(key)
  }

  // ---- 參照完整性 ----
  const venueIds = new Set(venues.data.map((v) => v.id))
  const stakeIds = new Set(stakes.data.map((s) => s.id))
  for (let i = 0; i < sessions.data.length; i++) {
    const s = sessions.data[i]!
    const base = { code: 'missingReference', collection: 'sessions', index: i + 1, id: s.id } as const
    if (s.venueId !== null && !venueIds.has(s.venueId)) return fail({ ...base, path: ['venueId'], value: s.venueId })
    if (s.stakeId !== null && !stakeIds.has(s.stakeId)) return fail({ ...base, path: ['stakeId'], value: s.stakeId })
  }

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: exportedAt.data,
      sessions: sessions.data,
      venues: venues.data,
      stakes: stakes.data,
      hands: hands.data,
      settings,
    },
  }
}

/** 3.11 類型相容：cash 手牌只能關聯 cash 場次；tournament 只能關聯 mtt、timed_mtt */
export function isSessionTypeCompatible(gameType: HandGameType, sessionType: SessionType): boolean {
  return gameType === 'cash' ? sessionType === 'cash' : sessionType === 'mtt' || sessionType === 'timed_mtt'
}

/** v2 10.2 第 2–4 項（每筆已通過 handSchema） */
function validateHands(hands: readonly Hand[], sessions: readonly Session[]): BackupError | null {
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!
    const base = { collection: 'hands', index: i + 1, id: h.id } as const
    const r = verifyHand(h)
    if (r.ok) continue
    const e = r.error
    switch (e.code) {
      case 'invalidDetail':
        return {
          ...base,
          code: 'invalidHandDetail',
          path: ['detail'],
          handIssue: e.issue.code,
          ...(e.issue.actionIndex !== undefined ? { actionIndex: e.issue.actionIndex + 1, actionError: e.issue.actionError } : {}),
        }
      case 'kindMismatch':
        return { ...base, code: 'invalidRecord', path: ['kind'], issue: 'kindMismatch' }
      case 'summaryMismatch':
        return { ...base, code: 'invalidRecord', path: [e.field], issue: 'summaryMismatch' }
      case 'collectedMustBeEmpty':
        return { ...base, code: 'invalidRecord', path: ['detail', 'collected'], issue: 'collectedMustBeEmpty' }
    }
  }
  const sessionTypes = new Map(sessions.map((s) => [s.id, s.type]))
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!
    if (h.sessionId === null) continue
    const type = sessionTypes.get(h.sessionId)
    const base = { collection: 'hands', index: i + 1, id: h.id } as const
    if (type === undefined) return { ...base, code: 'missingReference', path: ['sessionId'], value: h.sessionId }
    if (!isSessionTypeCompatible(h.gameType, type)) {
      return { ...base, code: 'invalidRecord', path: ['sessionId'], issue: 'sessionTypeMismatch' }
    }
  }
  const seqs = new Set<number>()
  const sourceIds = new Set<string>()
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]!
    const base = { collection: 'hands', index: i + 1, id: h.id } as const
    if (seqs.has(h.exportSeq)) return { ...base, code: 'duplicateExportSeq', path: ['exportSeq'], value: String(h.exportSeq) }
    seqs.add(h.exportSeq)
    if (h.source === 'gg' && h.sourceHandId !== null) {
      if (sourceIds.has(h.sourceHandId)) {
        return { ...base, code: 'duplicateSourceHandId', path: ['sourceHandId'], value: h.sourceHandId }
      }
      sourceIds.add(h.sourceHandId)
    }
  }
  return null
}

/** v2 10.2：匯入完成後的 lastHandSeq = max(檔案中的 lastHandSeq（沒有時為 0）, 檔案 hands 的最大 exportSeq) */
export function lastHandSeqAfterImport(backup: Pick<BackupFile, 'hands' | 'settings'>): number {
  return backup.hands.reduce((max, h) => Math.max(max, h.exportSeq), backup.settings.lastHandSeq ?? 0)
}
