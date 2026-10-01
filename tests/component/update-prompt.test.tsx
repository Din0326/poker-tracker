/// <reference types="vite-plugin-pwa/react" />
// 8.10 版本更新：按「重新載入」會先把新增頁尚未寫入的草稿立即寫入，再呼叫 updateServiceWorker(true)
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { UpdatePrompt } from '../../src/components/UpdatePrompt'
import { loadRecordFormData } from '../../src/features/record/loadRecordFormData'
import { RecordForm } from '../../src/features/record/RecordForm'
import { AppDataContext } from '../../src/lib/appData'
import { NOW, setupDb } from './helpers/renderRecordForm'
import { pwaMock } from './mocks/pwaRegister'

afterEach(() => {
  pwaMock.needRefresh = false
  pwaMock.updateServiceWorker = async () => undefined
})

describe('8.10 UpdatePrompt', () => {
  it('沒有新版本時不顯示', async () => {
    const s = await setupDb()
    render(
      <AppDataContext value={s}>
        <UpdatePrompt />
      </AppDataContext>,
    )
    expect(screen.queryByText('有新版本')).toBeNull()
  })

  it('按「重新載入」：先 flush 草稿（防抖 500ms 內的輸入也寫入），再 updateServiceWorker(true)', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const events: string[] = []
    let draftAtUpdate: unknown
    pwaMock.needRefresh = true
    pwaMock.updateServiceWorker = async (reloadPage) => {
      events.push(`update:${String(reloadPage)}`)
      draftAtUpdate = await s.repos.settings.get('recordDraft')
    }
    const data = await loadRecordFormData(s.repos)
    const user = userEvent.setup()
    render(
      <AppDataContext value={s}>
        <RecordForm mode="create" data={data} now={() => NOW} />
        <UpdatePrompt />
      </AppDataContext>,
    )
    expect(screen.getByText('有新版本')).toBeTruthy()

    await user.type(screen.getByLabelText('到手金額'), '900')
    // 防抖時間未到：草稿尚未寫入
    expect(await s.repos.settings.get('recordDraft')).toBeUndefined()

    await user.click(screen.getByRole('button', { name: '重新載入' }))
    await waitFor(() => expect(events).toEqual(['update:true']))
    // 呼叫 updateServiceWorker 時，草稿已寫入 DB
    expect(draftAtUpdate).toMatchObject({ version: 1, type: 'mtt', values: { cashOut: '900' } })
  })

  it('沒有新增表單時也能更新（沒有草稿要寫）', async () => {
    const s = await setupDb()
    const calls: (boolean | undefined)[] = []
    pwaMock.needRefresh = true
    pwaMock.updateServiceWorker = async (reloadPage) => {
      calls.push(reloadPage)
    }
    const user = userEvent.setup()
    render(
      <AppDataContext value={s}>
        <UpdatePrompt />
      </AppDataContext>,
    )
    await user.click(screen.getByRole('button', { name: '重新載入' }))
    await waitFor(() => expect(calls).toEqual([true]))
  })
})
