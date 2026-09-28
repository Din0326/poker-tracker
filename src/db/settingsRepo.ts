// 設定 repository（3.5，key-value）
import type { z } from 'zod'
import { settingSchemas } from '../domain/schemas'
import type { SettingKey, Settings } from '../domain/types'
import { validate } from './common'
import type { PokerDb } from './schema'

export function createSettingsRepo(db: PokerDb) {
  return {
    /** 讀取設定；未設定時回傳 undefined（寫入時已驗證，讀取不再驗證） */
    async get<K extends SettingKey>(key: K): Promise<Settings[K] | undefined> {
      const row = await db.settings.get(key)
      return row === undefined ? undefined : (row.value as Settings[K])
    },

    /** 寫入設定；值先以 3.5 對應的 schema 驗證，失敗丟出 ValidationError */
    async set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
      const schema: z.ZodType<Settings[K]> = settingSchemas[key]
      await db.settings.put({ key, value: validate(schema, value) })
    },

    async delete(key: SettingKey): Promise<void> {
      await db.settings.delete(key)
    },
  }
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>
