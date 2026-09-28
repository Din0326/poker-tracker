// 以獨立的 fake-indexeddb 資料庫渲染新增 / 編輯表單
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, createRepositories, type PokerDb, type Repositories } from '../../../src/db'
import type { Session, SessionType } from '../../../src/domain'
import { loadRecordFormData } from '../../../src/features/record/loadRecordFormData'
import { RecordForm, type RecordFormHandle } from '../../../src/features/record/RecordForm'
import { AppDataContext } from '../../../src/lib/appData'

let seq = 0

/** 測試固定的「現在」：2026-09-28 20:30（本地時間） */
export const NOW = new Date(2026, 8, 28, 20, 30, 0)

export interface Setup {
  db: PokerDb
  repos: Repositories
}

export async function setupDb(
  options: { stakes?: [number, number][]; venues?: string[]; lastType?: SessionType } = {},
): Promise<Setup> {
  const db = createDb(`component-${Date.now()}-${++seq}`)
  const repos = createRepositories(db, { now: () => NOW })
  for (const [sb, bb] of options.stakes ?? []) await repos.stakes.create(sb, bb)
  for (const name of options.venues ?? []) await repos.venues.create(name)
  if (options.lastType) await repos.settings.set('lastType', options.lastType)
  return { db, repos }
}

export async function renderRecordForm(
  setup: Setup,
  props: {
    mode?: 'create' | 'edit'
    initialSession?: Session
    onDirtyChange?: (dirty: boolean) => void
    onSaved?: (session: Session) => void
    ref?: { current: RecordFormHandle | null }
  } = {},
) {
  const data = await loadRecordFormData(setup.repos)
  const user = userEvent.setup()
  const result = render(
    <AppDataContext value={setup}>
      <RecordForm
        mode={props.mode ?? 'create'}
        data={data}
        now={() => NOW}
        {...(props.initialSession ? { initialSession: props.initialSession } : {})}
        {...(props.onDirtyChange ? { onDirtyChange: props.onDirtyChange } : {})}
        {...(props.onSaved ? { onSaved: props.onSaved } : {})}
        {...(props.ref ? { ref: props.ref } : {})}
      />
    </AppDataContext>,
  )
  return { ...result, user }
}
