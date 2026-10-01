// v2 手牌紀錄的型別定義（SPEC-v2-hands 第 3 節）。純型別與常數，不含任何 UI 或 DB 相依。

/** 紀錄類型（3.9）：由 classifyHand 判定，不可由使用者直接設定 */
export const HAND_KINDS = ['simple', 'complete'] as const
export type HandKind = (typeof HAND_KINDS)[number]

/** 來源（3.1）：手動紀錄或 GG 匯入；建立後不可變更 */
export const HAND_SOURCES = ['manual', 'gg'] as const
export type HandSource = (typeof HAND_SOURCES)[number]

/** 牌局類型（0.2） */
export const HAND_GAME_TYPES = ['cash', 'tournament'] as const
export type HandGameType = (typeof HAND_GAME_TYPES)[number]

/** 金額單位（3.8）：由 deriveAmountUnit(source, gameType) 推導 */
export const AMOUNT_UNITS = ['yuan', 'cent', 'chip'] as const
export type AmountUnit = (typeof AMOUNT_UNITS)[number]

/** 街（下注回合），依序不可倒退（3.4） */
export const STREETS = ['preflop', 'flop', 'turn', 'river'] as const
export type Street = (typeof STREETS)[number]

/** 行動種類（3.4） */
export const ACTION_TYPES = ['fold', 'check', 'call', 'bet', 'raise'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/** 位置（3.7）；畫面顯示 UTG1 為 UTG+1 */
export const POSITIONS = ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'UTG3', 'LJ', 'HJ', 'CO'] as const
export type Position = (typeof POSITIONS)[number]

/** 牌面編碼（3.6）：點數 + 花色，例 `As`、`Td` */
export type Card = string

/** 座位（3.3），嵌入在 HandDetail 內；只記錄有玩家且被發牌的座位 */
export interface Seat {
  seatNo: number
  /** 起始籌碼（發牌前、放前注與盲注前），單位依 amountUnit */
  stack: number
  /** 0 或 2 張 */
  cards: Card[]
  /** 只有進入攤牌、沒有亮牌的對手可為 true */
  mucked: boolean
  /** 原站玩家名稱（GG 匯入）；手動紀錄為 null */
  name: string | null
}

/** 行動（3.4），嵌入在 HandDetail 內；前注、盲注、straddle 不存成 Action */
export interface Action {
  street: Street
  seatNo: number
  type: ActionType
  /** bet、raise：行動後該玩家這條街的累計投入（加注到）；其餘為 null */
  to: number | null
}

/** 收回（3.5）：玩家從某個底池拿到的金額（已扣抽水） */
export interface Collected {
  seatNo: number
  /** 0 = 主池，1 起為邊池（4.6 的切分順序） */
  potIndex: number
  amount: number
}

/** 牌局明細（3.2） */
export interface HandDetail {
  tableSize: number
  buttonSeat: number
  heroSeat: number
  sb: number
  bb: number
  ante: number
  /** 0 或恰為 2 × bb */
  straddle: number
  seats: Seat[]
  actions: Action[]
  rake: number
  collected: Collected[]
}

/** 手牌（3.1）；所有欄位都必須存在，選填未填時為 null（或空陣列） */
export interface Hand {
  id: string
  exportSeq: number
  kind: HandKind
  source: HandSource
  gameType: HandGameType
  amountUnit: AmountUnit
  sessionId: string | null
  /** 本地時間 `YYYY-MM-DDTHH:mm:ss`，不含時區 */
  playedAt: string
  bb: number | null
  heroCards: Card[]
  heroPosition: Position | null
  board: Card[]
  heroNet: number | null
  detail: HandDetail | null
  tags: string[]
  note: string | null
  sourceHandId: string | null
  rawText: string | null
  parserVersion: number | null
  /** ISO 8601 含時區偏移 */
  createdAt: string
  /** ISO 8601 含時區偏移 */
  updatedAt: string
}

/** 摘要欄位（3.1）：有 detail 時由 summarizeHand 推導 */
export type HandSummary = Pick<Hand, 'bb' | 'heroCards' | 'heroPosition' | 'heroNet'>

/**
 * Settings.lastHandSetup（3.10）：上次完整模式的牌局設定，新增手牌時預帶（5.3）。
 * 金額單位依 gameType 為元或籌碼（3.8）。
 */
export interface HandSetup {
  gameType: HandGameType
  tableSize: number
  sb: number
  bb: number
  ante: number
  straddle: number
  /** 預設籌碼 */
  defaultStack: number
  /** 你的座位 */
  heroSeat: number
}

/** Settings.handDraft（3.10、5.7）：內容由 H1 表單決定，資料層目前只要求為物件 */
export type HandDraft = Record<string, unknown>
