// 第 3 節資料模型的型別定義（純型別，不含任何 UI 或 DB 相依）

/** 場次類型（3.1）；建立後不可變更 */
export const SESSION_TYPES = ['cash', 'mtt', 'timed_mtt'] as const
export type SessionType = (typeof SESSION_TYPES)[number]

/** 錦標賽類型（標準 MTT 與限時 MTT），買入可多筆 */
export const TOURNAMENT_TYPES = ['mtt', 'timed_mtt'] as const satisfies readonly SessionType[]
export type TournamentType = (typeof TOURNAMENT_TYPES)[number]

/** 買入（3.2），嵌入在 Session 內；amount 含服務費 */
export interface BuyIn {
  amount: number
  fee: number
}

/** 場次（3.1）；該類型不使用的欄位必須為 null */
export interface Session {
  id: string
  type: SessionType
  /** 本地時間 `YYYY-MM-DDTHH:00`，不含時區 */
  startAt: string
  durationMin: number
  /** 陣列順序即買入順序，第 1 筆為首次進場 */
  buyIns: BuyIn[]
  cashOut: number
  /** 僅 cash 使用（必填）；mtt、timed_mtt 為 null */
  stakeId: string | null
  venueId: string | null
  /** 選填；未填為 null（A1） */
  name: string | null
  /** 選填；未填為 null（A1） */
  note: string | null
  /** 僅 mtt 使用 */
  fieldSize: number | null
  /** 僅 mtt 使用 */
  finishPlace: number | null
  /** ISO 8601 含時區偏移 */
  createdAt: string
  /** ISO 8601 含時區偏移 */
  updatedAt: string
}

/** 場地（3.3） */
export interface Venue {
  id: string
  name: string
  archived: boolean
  sortOrder: number
}

/** 盲注級別（3.4）；顯示名稱 `sb/bb` 由 stakeLabel() 產生，不存 DB */
export interface Stake {
  id: string
  sb: number
  bb: number
  archived: boolean
  sortOrder: number
}

export const PROFIT_COLOR_SCHEMES = ['redGain', 'greenGain'] as const
export type ProfitColorScheme = (typeof PROFIT_COLOR_SCHEMES)[number]

/**
 * 新增頁草稿（5.6）。欄位內容由 P2 表單決定，資料層目前只要求為物件。
 */
export type RecordDraft = Record<string, unknown>

/** 設定（3.5，key-value） */
export interface Settings {
  lastType: SessionType
  /** null 代表「不指定」（A4） */
  lastVenueByType: Partial<Record<SessionType, string | null>>
  lastStakeId: string
  /** ISO 8601 含時區偏移 */
  lastBackupAt: string
  recordDraft: RecordDraft
  profitColorScheme: ProfitColorScheme
}

export type SettingKey = keyof Settings
export const SETTING_KEYS = [
  'lastType',
  'lastVenueByType',
  'lastStakeId',
  'lastBackupAt',
  'recordDraft',
  'profitColorScheme',
] as const satisfies readonly SettingKey[]

/** 單場結果判定（4.1）：平不算贏 */
export type SessionResult = 'win' | 'loss' | 'even'
