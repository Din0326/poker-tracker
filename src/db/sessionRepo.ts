// 場次 repository（3.1、3.6、5.7、7.5）
import { sessionSchema } from '../domain/schemas'
import type { Backer, BuyIn, Session, SessionType } from '../domain/types'
import { resolveOptions, toIsoWithOffset, validate, type RepoOptions } from './common'
import { AlreadyExistsError, RecordNotFoundError, ReferenceNotFoundError, TypeImmutableError } from './errors'
import type { PokerDb } from './schema'

/**
 * 新增場次的輸入。id、createdAt、updatedAt 由系統產生。
 * 選填欄位可省略；該類型不使用的欄位即使有值也會被強制存成 null（3.1）。
 */
export interface SessionInput {
  type: SessionType
  startAt: string
  durationMin: number
  buyIns: BuyIn[]
  cashOut: number
  stakeId?: string | null
  venueId?: string | null
  name?: string | null
  note?: string | null
  fieldSize?: number | null
  finishPlace?: number | null
  /** 出資者（3.8）；省略視為沒有賣股（[]）。名稱儲存去除前後空白後的值 */
  backers?: Backer[]
}

/** 編輯場次的輸入：只帶要變更的欄位；type 不可變更 */
export type SessionPatch = Partial<SessionInput>

/** A1：name 去除前後空白，空字串視為 null */
export function normalizeName(name: string | null | undefined): string | null {
  const t = name?.trim() ?? ''
  return t === '' ? null : t
}

/** A1：note 原樣保留，空字串視為 null */
export function normalizeNote(note: string | null | undefined): string | null {
  return note === undefined || note === null || note === '' ? null : note
}

/** 正規化成可儲存的場次欄位：不使用的欄位強制 null、name / note 依 A1 處理 */
function normalize(input: SessionInput): Omit<Session, 'id' | 'createdAt' | 'updatedAt'> {
  const isCash = input.type === 'cash'
  const isMtt = input.type === 'mtt'
  return {
    type: input.type,
    startAt: input.startAt,
    durationMin: input.durationMin,
    buyIns: input.buyIns.map((b) => ({ amount: b.amount, fee: b.fee })),
    cashOut: input.cashOut,
    stakeId: isCash ? (input.stakeId ?? null) : null,
    venueId: input.venueId ?? null,
    name: normalizeName(input.name),
    note: normalizeNote(input.note),
    fieldSize: isMtt ? (input.fieldSize ?? null) : null,
    finishPlace: isMtt ? (input.finishPlace ?? null) : null,
    backers: (input.backers ?? []).map((b) => ({
      name: b.name.trim(),
      sharePermille: b.sharePermille,
      markupPermille: b.markupPermille,
    })),
  }
}

export function createSessionRepo(db: PokerDb, options?: RepoOptions) {
  const ctx = resolveOptions(options)

  /** 確認場次參照的場地與盲注存在（已封存的仍視為存在） */
  async function assertReferences(s: Pick<Session, 'venueId' | 'stakeId'>): Promise<void> {
    if (s.venueId !== null && !(await db.venues.get(s.venueId))) {
      throw new ReferenceNotFoundError('venueId', s.venueId)
    }
    if (s.stakeId !== null && !(await db.stakes.get(s.stakeId))) {
      throw new ReferenceNotFoundError('stakeId', s.stakeId)
    }
  }

  async function getOrThrow(id: string): Promise<Session> {
    const s = await db.sessions.get(id)
    if (!s) throw new RecordNotFoundError('session', id)
    return s
  }

  return {
    /** 新增場次：產生 UUID 與時間戳、Zod 驗證、檢查參照後寫入 */
    async create(input: SessionInput): Promise<Session> {
      const ts = toIsoWithOffset(ctx.now())
      const session = validate(sessionSchema, {
        id: ctx.uuid(),
        ...normalize(input),
        createdAt: ts,
        updatedAt: ts,
      })
      return db.transaction('rw', db.sessions, db.venues, db.stakes, async () => {
        await assertReferences(session)
        await db.sessions.add(session)
        return session
      })
    },

    /** 編輯場次：type 不可變更；保留 id、createdAt，更新 updatedAt */
    async update(id: string, patch: SessionPatch): Promise<Session> {
      return db.transaction('rw', db.sessions, db.venues, db.stakes, async () => {
        const existing = await getOrThrow(id)
        if (patch.type !== undefined && patch.type !== existing.type) {
          throw new TypeImmutableError(existing.type, patch.type)
        }
        const merged: SessionInput = { ...existing, ...patch, type: existing.type }
        const session = validate(sessionSchema, {
          id: existing.id,
          ...normalize(merged),
          createdAt: existing.createdAt,
          updatedAt: toIsoWithOffset(ctx.now()),
        })
        await assertReferences(session)
        await db.sessions.put(session)
        return session
      })
    },

    async get(id: string): Promise<Session | undefined> {
      return db.sessions.get(id)
    },

    /** 全部場次（未排序；排序請用 domain/sort.ts） */
    async list(): Promise<Session[]> {
      return db.sessions.toArray()
    },

    /** 實體刪除，回傳被刪除的原資料供復原（7.5） */
    async delete(id: string): Promise<Session> {
      return db.transaction('rw', db.sessions, async () => {
        const existing = await getOrThrow(id)
        await db.sessions.delete(id)
        return existing
      })
    },

    /** 復原：以原始 id、createdAt、updatedAt 原封不動寫回（7.5） */
    async restore(session: Session): Promise<Session> {
      const s = validate(sessionSchema, session)
      return db.transaction('rw', db.sessions, db.venues, db.stakes, async () => {
        if (await db.sessions.get(s.id)) throw new AlreadyExistsError('session', s.id)
        await assertReferences(s)
        await db.sessions.add(s)
        return s
      })
    },
  }
}

export type SessionRepo = ReturnType<typeof createSessionRepo>
