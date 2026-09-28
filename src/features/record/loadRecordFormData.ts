// 新增 / 編輯表單需要的資料：盲注、場地（含已封存）、last* 設定與草稿
import type { Repositories } from '../../db'
import type { RecordFormData } from './RecordForm'

export async function loadRecordFormData(repos: Repositories): Promise<RecordFormData> {
  const [stakes, venues, lastType, lastVenueByType, lastStakeId, draft] = await Promise.all([
    repos.stakes.list(),
    repos.venues.list(),
    repos.settings.get('lastType'),
    repos.settings.get('lastVenueByType'),
    repos.settings.get('lastStakeId'),
    repos.settings.get('recordDraft'),
  ])
  return { stakes, venues, settings: { lastType, lastVenueByType: lastVenueByType ?? {}, lastStakeId }, draft }
}
