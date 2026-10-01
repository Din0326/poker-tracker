// 以獨立的 fake-indexeddb 資料庫渲染新增 / 編輯手牌表單（data router：HandForm 內的 Page 需要 router context）
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { createDb, createRepositories, type PokerDb, type Repositories } from '../../../src/db'
import type { Hand } from '../../../src/domain/hands'
import { HandForm } from '../../../src/features/hands/HandForm'
import { createEntryValues, type HandFormValues } from '../../../src/features/hands/handFormModel'
import { loadHandFormData } from '../../../src/features/hands/loadHandFormData'
import { AppDataContext } from '../../../src/lib/appData'

let seq = 0

/** 測試固定的「現在」：2026-10-01 12:00（本地時間） */
export const NOW = new Date(2026, 9, 1, 12, 0, 0)

export interface HandSetupDb {
  db: PokerDb
  repos: Repositories
}

export function setupHandDb(): HandSetupDb {
  const db = createDb(`hand-component-${Date.now()}-${++seq}`)
  return { db, repos: createRepositories(db, { now: () => NOW }) }
}

/** 新增模式的預帶值（可覆寫部分欄位作為初始值） */
export function entryValues(patch: Partial<HandFormValues> = {}): HandFormValues {
  return { ...createEntryValues({ now: NOW, lastHandSetup: undefined, session: null, stake: null }), ...patch }
}

export async function renderHandForm(
  setup: HandSetupDb,
  props: { initial?: HandFormValues; mode?: 'create' | 'edit'; hand?: Hand; onSaved?: (hand: Hand) => void } = {},
) {
  const loaded = await loadHandFormData(setup.repos)
  const baseline = entryValues()
  const user = userEvent.setup()
  const element = (
    <HandForm
      mode={props.mode ?? 'create'}
      data={loaded.data}
      initial={props.initial ?? baseline}
      baseline={props.mode === 'edit' && props.initial ? props.initial : baseline}
      makeEntry={() => entryValues()}
      hand={props.hand}
      title="test"
      backTo="/"
      onSaved={props.onSaved ?? (() => undefined)}
      now={() => NOW}
    />
  )
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] })
  const result = render(
    <AppDataContext value={setup}>
      <RouterProvider router={router} />
    </AppDataContext>,
  )
  return { ...result, user }
}
