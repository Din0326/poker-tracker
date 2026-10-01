// 手牌 repository（SPEC-v2-hands 3.1、3.11、5.8、6.4、7.4）
import { isSessionTypeCompatible } from '../domain/backup'
import { finalizeHandContent, handSchema, verifyHand, type HandContent } from '../domain/hands'
import type { Card, Hand, HandDetail, HandGameType, HandSource, Position } from '../domain/hands/types'
import { resolveOptions, toIsoWithOffset, validate, type RepoOptions } from './common'
import {
  AlreadyExistsError,
  HandLockedError,
  HandVerificationError,
  RecordNotFoundError,
  ReferenceNotFoundError,
  SessionTypeMismatchError,
  TypeImmutableError,
} from './errors'
import type { PokerDb } from './schema'

/**
 * 新增手牌的輸入。id、exportSeq、kind、amountUnit、createdAt、updatedAt 由系統產生；
 * detail 不為 null 時，摘要欄位（bb、heroCards、heroPosition、heroNet）由 detail 推導，輸入的值會被忽略；
 * 手動紀錄的 collected 由 4.7、4.8 自動計算，輸入的值會被忽略。
 */
export interface HandInput {
  source: HandSource
  gameType: HandGameType
  playedAt: string
  detail: HandDetail | null
  sessionId?: string | null
  board?: Card[]
  tags?: string[]
  note?: string | null
  /** 以下為簡易備忘（detail 為 null）的欄位 */
  bb?: number | null
  heroCards?: Card[]
  heroPosition?: Position | null
  heroNet?: number | null
  /** 以下只有 source 為 gg 時使用 */
  sourceHandId?: string | null
  rawText?: string | null
  parserVersion?: number | null
}

/** 編輯手牌：只帶要變更的欄位；source 不可變更 */
export type HandPatch = Partial<Omit<HandInput, 'source'>>

/** 匯入的手牌（gg）只能修改這些欄位（5.8） */
const GG_EDITABLE = new Set<keyof HandPatch>(['sessionId', 'tags', 'note'])

/** 3.1：標籤儲存去除前後空白後的值；note 空字串視為 null */
function toContent(input: HandInput): HandContent {
  return {
    source: input.source,
    gameType: input.gameType,
    sessionId: input.sessionId ?? null,
    playedAt: input.playedAt,
    bb: input.bb ?? null,
    heroCards: [...(input.heroCards ?? [])],
    heroPosition: input.heroPosition ?? null,
    board: [...(input.board ?? [])],
    heroNet: input.heroNet ?? null,
    detail: input.detail,
    tags: (input.tags ?? []).map((t) => t.trim()),
    note: input.note === undefined || input.note === null || input.note === '' ? null : input.note,
    sourceHandId: input.sourceHandId ?? null,
    rawText: input.rawText ?? null,
    parserVersion: input.parserVersion ?? null,
  }
}

function inputOf(hand: Hand): HandInput {
  return {
    source: hand.source,
    gameType: hand.gameType,
    playedAt: hand.playedAt,
    detail: hand.detail,
    sessionId: hand.sessionId,
    board: hand.board,
    tags: hand.tags,
    note: hand.note,
    bb: hand.bb,
    heroCards: hand.heroCards,
    heroPosition: hand.heroPosition,
    heroNet: hand.heroNet,
    sourceHandId: hand.sourceHandId,
    rawText: hand.rawText,
    parserVersion: hand.parserVersion,
  }
}

/** Zod（3.1–3.6）+ 3.9 結構驗證、kind、摘要一致；失敗丟出 ValidationError / HandVerificationError */
export function validateHand(value: unknown): Hand {
  const hand = validate(handSchema, value)
  const r = verifyHand(hand)
  if (!r.ok) throw new HandVerificationError(r.error)
  return hand
}

export interface HandCounts {
  total: number
  complete: number
  simple: number
}

export function createHandRepo(db: PokerDb, options?: RepoOptions) {
  const ctx = resolveOptions(options)

  /** 3.11：sessionId 必須參照存在的場次，且類型相容 */
  async function assertSession(hand: Pick<Hand, 'sessionId' | 'gameType'>): Promise<void> {
    if (hand.sessionId === null) return
    const session = await db.sessions.get(hand.sessionId)
    if (!session) throw new ReferenceNotFoundError('sessionId', hand.sessionId)
    if (!isSessionTypeCompatible(hand.gameType, session.type)) throw new SessionTypeMismatchError(hand.gameType, session.type)
  }

  /**
   * 7.4 配發 exportSeq：next = max(Settings.lastHandSeq, hands 表最大 exportSeq) + 1，並更新 lastHandSeq。
   * 必須在包含 hands 與 settings 的 rw transaction 內呼叫，與手牌寫入同一個 transaction。
   */
  async function allocateExportSeqs(count: number): Promise<number[]> {
    const last = (await db.settings.get('lastHandSeq'))?.value
    const maxInTable = (await db.hands.orderBy('exportSeq').last())?.exportSeq ?? 0
    const start = Math.max(typeof last === 'number' ? last : 0, maxInTable) + 1
    const seqs = Array.from({ length: count }, (_, i) => start + i)
    if (count > 0) await db.settings.put({ key: 'lastHandSeq', value: seqs[seqs.length - 1] })
    return seqs
  }

  async function getOrThrow(id: string): Promise<Hand> {
    const h = await db.hands.get(id)
    if (!h) throw new RecordNotFoundError('hand', id)
    return h
  }

  function build(input: HandInput, fixed: Pick<Hand, 'id' | 'exportSeq' | 'createdAt' | 'updatedAt'>): Hand {
    return validateHand({ ...fixed, ...finalizeHandContent(toContent(input)) })
  }

  /** 一次新增多手（同一個 transaction；任何錯誤整批還原） */
  async function createMany(inputs: readonly HandInput[]): Promise<Hand[]> {
    const ts = toIsoWithOffset(ctx.now())
    // 先以暫時的 exportSeq 驗證內容（exportSeq 不影響其他欄位），避免在 transaction 內做大量計算
    const drafts = inputs.map((input) => build(input, { id: ctx.uuid(), exportSeq: 1, createdAt: ts, updatedAt: ts }))
    return db.transaction('rw', db.hands, db.sessions, db.settings, async () => {
      const checked = new Set<string>()
      for (const h of drafts) {
        const key = `${h.sessionId}|${h.gameType}`
        if (h.sessionId === null || checked.has(key)) continue
        checked.add(key)
        await assertSession(h)
      }
      const seqs = await allocateExportSeqs(drafts.length)
      const hands = drafts.map((h, i) => ({ ...h, exportSeq: seqs[i]! }))
      await db.hands.bulkAdd(hands)
      return hands
    })
  }

  return {
    /** 新增一手：推導系統欄位、驗證、檢查關聯場次，配發 exportSeq 與寫入在同一個 transaction（5.8） */
    async create(input: HandInput): Promise<Hand> {
      const [hand] = await createMany([input])
      return hand!
    },

    /** 一次新增多手。供 GG 匯入（H4）與開發用 seed */
    createMany,

    /**
     * 編輯：id、exportSeq、createdAt、source 不變，更新 updatedAt，重新判定 kind 與摘要（5.8）。
     * 匯入的手牌只能修改關聯場次、標籤、備註；有 detail 時 gameType 不可變更（變更需同時清除 detail）。
     */
    async update(id: string, patch: HandPatch): Promise<Hand> {
      return db.transaction('rw', db.hands, db.sessions, async () => {
        const existing = await getOrThrow(id)
        if (existing.source === 'gg') {
          for (const key of Object.keys(patch) as (keyof HandPatch)[]) {
            if (!GG_EDITABLE.has(key) && JSON.stringify(patch[key]) !== JSON.stringify(inputOf(existing)[key])) {
              throw new HandLockedError(key)
            }
          }
        }
        const merged: HandInput = { ...inputOf(existing), ...patch, source: existing.source }
        if (existing.detail !== null && merged.detail !== null && merged.gameType !== existing.gameType) {
          throw new TypeImmutableError(existing.gameType, merged.gameType)
        }
        const hand = build(merged, {
          id: existing.id,
          exportSeq: existing.exportSeq,
          createdAt: existing.createdAt,
          updatedAt: toIsoWithOffset(ctx.now()),
        })
        await assertSession(hand)
        await db.hands.put(hand)
        return hand
      })
    },

    async get(id: string): Promise<Hand | undefined> {
      return db.hands.get(id)
    },

    /** 全部手牌（未排序） */
    async list(): Promise<Hand[]> {
      return db.hands.toArray()
    },

    /** 某場次底下的手牌（以 sessionId 索引查詢） */
    async listBySession(sessionId: string): Promise<Hand[]> {
      return db.hands.where('sessionId').equals(sessionId).toArray()
    },

    /** 10.6 資料量：手牌數（完整 / 簡易）；kind 不建索引（3.12），在記憶體內計數 */
    async counts(): Promise<HandCounts> {
      let complete = 0
      let simple = 0
      await db.hands.each((h) => {
        if (h.kind === 'complete') complete++
        else simple++
      })
      return { total: complete + simple, complete, simple }
    },

    /** 實體刪除，回傳原資料供復原（6.4）；exportSeq 不重用（lastHandSeq 不變） */
    async delete(id: string): Promise<Hand> {
      return db.transaction('rw', db.hands, async () => {
        const existing = await getOrThrow(id)
        await db.hands.delete(id)
        return existing
      })
    },

    /**
     * 復原（6.4）：以原始 id、exportSeq、createdAt、updatedAt 及所有欄位原封不動寫回；
     * 原本關聯的場次在這段時間內被刪除時，sessionId 改為 null 後寫回。
     */
    async restore(hand: Hand): Promise<Hand> {
      return db.transaction('rw', db.hands, db.sessions, async () => {
        if (await db.hands.get(hand.id)) throw new AlreadyExistsError('hand', hand.id)
        const sessionGone = hand.sessionId !== null && !(await db.sessions.get(hand.sessionId))
        const h = validateHand(sessionGone ? { ...hand, sessionId: null } : hand)
        await assertSession(h)
        await db.hands.add(h)
        return h
      })
    },
  }
}

export type HandRepo = ReturnType<typeof createHandRepo>
