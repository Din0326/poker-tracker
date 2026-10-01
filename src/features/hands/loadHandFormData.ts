// 新增 / 編輯手牌頁需要的資料：場次（關聯場次選單）、盲注（帶入場次盲注）、Settings.lastHandSetup
import type { Repositories } from '../../db'
import { sortReverseChronological, type Session, type Stake } from '../../domain'
import { strings } from '../../strings'
import { buildLookup, rowDate, sessionTitle } from '../sessions/sessionView'
import type { HandFormData } from './HandForm'

export interface LoadedHandFormData {
  data: HandFormData
  sessions: Session[]
  stakes: Stake[]
}

export async function loadHandFormData(repos: Repositories): Promise<LoadedHandFormData> {
  const [sessions, venues, stakes, lastHandSetup] = await Promise.all([
    repos.sessions.list(),
    repos.venues.list(),
    repos.stakes.list(),
    repos.settings.get('lastHandSetup'),
  ])
  const lookup = buildLookup(venues, stakes)
  const sorted = sortReverseChronological(sessions)
  return {
    data: {
      // 5.2 關聯場次選項「09/27 · 標題」（標題規則同 v1 7.1），依 startAt 新到舊
      sessions: sorted.map((s) => ({ id: s.id, type: s.type, label: strings.hands.sessionOption(rowDate(s), sessionTitle(s, lookup)) })),
      sessionsById: new Map(sessions.map((s) => [s.id, s])),
      lastHandSetup,
    },
    sessions,
    stakes,
  }
}
