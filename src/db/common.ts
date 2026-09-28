// repository 共用工具：時間戳、UUID、Zod 驗證
import dayjs from 'dayjs'
import type { z } from 'zod'
import { ValidationError } from './errors'

/** 可注入的時鐘與 UUID 產生器（測試用）；預設為系統時間與 crypto.randomUUID() */
export interface RepoOptions {
  now?: () => Date
  uuid?: () => string
}

export interface RepoContext {
  now: () => Date
  uuid: () => string
}

export function resolveOptions(options: RepoOptions = {}): RepoContext {
  return {
    now: options.now ?? (() => new Date()),
    uuid: options.uuid ?? (() => crypto.randomUUID()),
  }
}

/** ISO 8601 含本地時區偏移，例 2026-09-28T21:05:00+08:00 */
export function toIsoWithOffset(date: Date): string {
  return dayjs(date).format('YYYY-MM-DDTHH:mm:ssZ')
}

/** 以 schema 驗證，失敗時丟出 ValidationError；回傳驗證後的資料 */
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw ValidationError.fromZod(r.error)
  return r.data
}

/** 依 sortOrder 由小到大排序（回傳新陣列） */
export function bySortOrder<T extends { sortOrder: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder)
}

/** A3：新增項目的 sortOrder = 目前最大值 + 1，無資料時為 0 */
export function nextSortOrder(items: readonly { sortOrder: number }[]): number {
  return items.length === 0 ? 0 : Math.max(...items.map((i) => i.sortOrder)) + 1
}

export type MoveDirection = 'up' | 'down'

/**
 * 找出與 id 相鄰（同一封存狀態）的項目，供上移 / 下移交換 sortOrder。
 * 已在最前或最後時回傳 null。
 */
export function findSwapTarget<T extends { id: string; archived: boolean; sortOrder: number }>(
  items: readonly T[],
  id: string,
  direction: MoveDirection,
): { current: T; neighbor: T } | null {
  const target = items.find((i) => i.id === id)
  if (!target) return null
  const group = bySortOrder(items.filter((i) => i.archived === target.archived))
  const idx = group.findIndex((i) => i.id === id)
  const neighbor = group[direction === 'up' ? idx - 1 : idx + 1]
  return neighbor ? { current: target, neighbor } : null
}
