// 盲注級別 repository（3.4、3.6、8.2）
// 顯示名稱 `sb/bb` 由 domain/format.ts 的 stakeLabel() 產生，不存 DB
import { stakeSchema } from '../domain/schemas'
import type { Stake } from '../domain/types'
import { bySortOrder, findSwapTarget, nextSortOrder, resolveOptions, validate, type MoveDirection, type RepoOptions } from './common'
import { DuplicateStakeError, InUseError, RecordNotFoundError } from './errors'
import type { PokerDb } from './schema'

export function createStakeRepo(db: PokerDb, options?: RepoOptions) {
  const ctx = resolveOptions(options)

  async function getOrThrow(id: string): Promise<Stake> {
    const s = await db.stakes.get(id)
    if (!s) throw new RecordNotFoundError('stake', id)
    return s
  }

  /** 同一組 sb、bb 不可重複（與其他盲注比對，含已封存） */
  async function assertUnique(sb: number, bb: number, exceptId: string | null): Promise<void> {
    const all = await db.stakes.toArray()
    if (all.some((s) => s.id !== exceptId && s.sb === sb && s.bb === bb)) throw new DuplicateStakeError(sb, bb)
  }

  async function usageCount(id: string): Promise<number> {
    return db.sessions.where('stakeId').equals(id).count()
  }

  async function setArchived(id: string, archived: boolean): Promise<Stake> {
    return db.transaction('rw', db.stakes, async () => {
      const s = await getOrThrow(id)
      const next = { ...s, archived }
      await db.stakes.put(next)
      return next
    })
  }

  return {
    /** 全部盲注（含已封存），依 sortOrder 排序 */
    async list(): Promise<Stake[]> {
      return bySortOrder(await db.stakes.toArray())
    },

    /** 未封存的盲注，依 sortOrder 排序。archived 為 boolean 無法用索引查詢，以 filter 篩選 */
    async listActive(): Promise<Stake[]> {
      return bySortOrder(await db.stakes.filter((s) => !s.archived).toArray())
    },

    async get(id: string): Promise<Stake | undefined> {
      return db.stakes.get(id)
    },

    /** 新增盲注：sortOrder 排最後（A3） */
    async create(sb: number, bb: number): Promise<Stake> {
      return db.transaction('rw', db.stakes, async () => {
        const stake = validate(stakeSchema, {
          id: ctx.uuid(),
          sb,
          bb,
          archived: false,
          sortOrder: nextSortOrder(await db.stakes.toArray()),
        })
        await assertUnique(sb, bb, null)
        await db.stakes.add(stake)
        return stake
      })
    },

    /** 修改 sb、bb：僅在未被任何場次參照時允許（3.6），否則丟出 InUseError */
    async update(id: string, sb: number, bb: number): Promise<Stake> {
      return db.transaction('rw', db.stakes, db.sessions, async () => {
        const s = await getOrThrow(id)
        const count = await usageCount(id)
        if (count > 0) throw new InUseError('stake', id, count)
        const next = validate(stakeSchema, { ...s, sb, bb })
        await assertUnique(sb, bb, id)
        await db.stakes.put(next)
        return next
      })
    },

    archive: (id: string) => setArchived(id, true),
    unarchive: (id: string) => setArchived(id, false),

    /**
     * 上移 / 下移：與同一封存狀態中相鄰的項目交換 sortOrder。
     * 已在最前或最後時不變動，回傳 false。
     */
    async move(id: string, direction: MoveDirection): Promise<boolean> {
      return db.transaction('rw', db.stakes, async () => {
        await getOrThrow(id)
        const pair = findSwapTarget(await db.stakes.toArray(), id, direction)
        if (!pair) return false
        await db.stakes.bulkPut([
          { ...pair.current, sortOrder: pair.neighbor.sortOrder },
          { ...pair.neighbor, sortOrder: pair.current.sortOrder },
        ])
        return true
      })
    },

    /** 實體刪除：僅在未被任何場次參照時允許（3.6），否則丟出 InUseError */
    async delete(id: string): Promise<void> {
      await db.transaction('rw', db.stakes, db.sessions, async () => {
        await getOrThrow(id)
        const count = await usageCount(id)
        if (count > 0) throw new InUseError('stake', id, count)
        await db.stakes.delete(id)
      })
    },

    /** 參照此盲注的場次數 */
    usageCount,
  }
}

export type StakeRepo = ReturnType<typeof createStakeRepo>
