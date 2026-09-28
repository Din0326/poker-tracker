// db 對外匯出
import type { RepoOptions } from './common'
import type { PokerDb } from './schema'
import { createSessionRepo } from './sessionRepo'
import { createSettingsRepo } from './settingsRepo'
import { createStakeRepo } from './stakeRepo'
import { createVenueRepo } from './venueRepo'

export * from './errors'
export * from './schema'
export { toIsoWithOffset, type MoveDirection, type RepoOptions } from './common'
export { createSessionRepo, normalizeName, normalizeNote, type SessionInput, type SessionPatch, type SessionRepo } from './sessionRepo'
export { createVenueRepo, type VenueRepo } from './venueRepo'
export { createStakeRepo, type StakeRepo } from './stakeRepo'
export { createSettingsRepo, type SettingsRepo } from './settingsRepo'

/** 一次建立四個 repository（共用同一個 DB 實例） */
export function createRepositories(db: PokerDb, options?: RepoOptions) {
  return {
    sessions: createSessionRepo(db, options),
    venues: createVenueRepo(db, options),
    stakes: createStakeRepo(db, options),
    settings: createSettingsRepo(db),
  }
}

export type Repositories = ReturnType<typeof createRepositories>
