// 場地 repository（3.3、3.6、8.1）
import { venueSchema } from '../domain/schemas'
import type { Venue } from '../domain/types'
import { bySortOrder, findSwapTarget, nextSortOrder, resolveOptions, validate, type MoveDirection, type RepoOptions } from './common'
import { DuplicateNameError, InUseError, RecordNotFoundError } from './errors'
import type { PokerDb } from './schema'

/** 名稱比對鍵：去除前後空白、不分大小寫（3.3） */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

export function createVenueRepo(db: PokerDb, options?: RepoOptions) {
  const ctx = resolveOptions(options)

  async function getOrThrow(id: string): Promise<Venue> {
    const v = await db.venues.get(id)
    if (!v) throw new RecordNotFoundError('venue', id)
    return v
  }

  /** 與其他場地（含已封存）比對名稱是否重複 */
  async function assertUniqueName(name: string, exceptId: string | null): Promise<void> {
    const key = nameKey(name)
    const all = await db.venues.toArray()
    if (all.some((v) => v.id !== exceptId && nameKey(v.name) === key)) throw new DuplicateNameError(name)
  }

  async function usageCount(id: string): Promise<number> {
    return db.sessions.where('venueId').equals(id).count()
  }

  async function setArchived(id: string, archived: boolean): Promise<Venue> {
    return db.transaction('rw', db.venues, async () => {
      const v = await getOrThrow(id)
      const next = { ...v, archived }
      await db.venues.put(next)
      return next
    })
  }

  return {
    /** 全部場地（含已封存），依 sortOrder 排序 */
    async list(): Promise<Venue[]> {
      return bySortOrder(await db.venues.toArray())
    },

    /** 未封存的場地，依 sortOrder 排序。archived 為 boolean 無法用索引查詢，以 filter 篩選 */
    async listActive(): Promise<Venue[]> {
      return bySortOrder(await db.venues.filter((v) => !v.archived).toArray())
    },

    async get(id: string): Promise<Venue | undefined> {
      return db.venues.get(id)
    },

    /** 新增場地：名稱去除前後空白、不可重複；sortOrder 排最後（A3） */
    async create(name: string): Promise<Venue> {
      return db.transaction('rw', db.venues, async () => {
        const trimmed = name.trim()
        const all = await db.venues.toArray()
        const venue = validate(venueSchema, {
          id: ctx.uuid(),
          name: trimmed,
          archived: false,
          sortOrder: nextSortOrder(all),
        })
        await assertUniqueName(trimmed, null)
        await db.venues.add(venue)
        return venue
      })
    },

    /** 改名：規則同新增；場地被參照後仍可改名（3.6） */
    async rename(id: string, name: string): Promise<Venue> {
      return db.transaction('rw', db.venues, async () => {
        const v = await getOrThrow(id)
        const next = validate(venueSchema, { ...v, name: name.trim() })
        await assertUniqueName(next.name, id)
        await db.venues.put(next)
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
      return db.transaction('rw', db.venues, async () => {
        await getOrThrow(id)
        const pair = findSwapTarget(await db.venues.toArray(), id, direction)
        if (!pair) return false
        await db.venues.bulkPut([
          { ...pair.current, sortOrder: pair.neighbor.sortOrder },
          { ...pair.neighbor, sortOrder: pair.current.sortOrder },
        ])
        return true
      })
    },

    /** 實體刪除：僅在沒有任何場次參照時允許（3.6），否則丟出 InUseError */
    async delete(id: string): Promise<void> {
      await db.transaction('rw', db.venues, db.sessions, async () => {
        await getOrThrow(id)
        const count = await usageCount(id)
        if (count > 0) throw new InUseError('venue', id, count)
        await db.venues.delete(id)
      })
    },

    /** 參照此場地的場次數 */
    usageCount,
  }
}

export type VenueRepo = ReturnType<typeof createVenueRepo>
