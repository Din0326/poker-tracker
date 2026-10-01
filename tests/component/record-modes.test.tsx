// 5.6 草稿、5.7 編輯模式、Q6 清除
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RecordFormHandle } from '../../src/features/record/RecordForm'
import { renderRecordForm, setupDb } from './helpers/renderRecordForm'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('5.6 草稿', () => {
  it('與預設值不同時，輸入停止 500ms 後寫入 Settings.recordDraft（含版本號）；回到預設值時刪除', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    const cashOut = screen.getByLabelText('到手金額')
    await user.type(cashOut, '900')
    await waitFor(async () => {
      // v1.2：草稿版本 2，含出資者列（此處 0 列）
      expect(await s.repos.settings.get('recordDraft')).toMatchObject({
        version: 2,
        type: 'mtt',
        venueTouched: false,
        values: { cashOut: '900', backers: [] },
      })
    })
    await user.clear(cashOut)
    await waitFor(async () => expect(await s.repos.settings.get('recordDraft')).toBeUndefined())
  })

  // v1.2：此處寫入的是 v1.1 格式（version 1、沒有出資者）的草稿，仍可還原（出資者視為 0 列，5.6）
  it('進頁面時還原草稿；版本不符時丟棄', async () => {
    const s = await setupDb()
    await s.repos.settings.set('recordDraft', {
      version: 1,
      type: 'timed_mtt',
      venueTouched: false,
      values: {
        stakeId: '',
        buyIns: [
          { amount: '3400', fee: '400' },
          { amount: '3200', fee: '200' },
        ],
        cashOut: '9000',
        fieldSize: '',
        finishPlace: '',
        startDate: '2026-09-27',
        startHour: '19',
        durationH: '2',
        durationM: '30',
        venueId: '',
        name: 'Daily',
        note: '',
      },
    })
    const first = await renderRecordForm(s)
    expect(screen.getByRole('button', { name: /限時 MTT/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('record-preview').textContent).toBe('買入 $6,600（2 次）· 服務費 $600 · 盈利 +$2,400')
    expect((screen.getByLabelText('名稱') as HTMLInputElement).value).toBe('Daily')
    first.unmount()

    // 目前版本為 2，以未知的 99 測試版本不符
    await s.repos.settings.set('recordDraft', { version: 99, type: 'mtt', venueTouched: false, values: {} })
    await renderRecordForm(s)
    expect(screen.getByRole('button', { name: /現金桌/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('Q6 清除：刪除草稿並回到剛進頁面的預設值', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const ref: { current: RecordFormHandle | null } = { current: null }
    const onDirtyChange = vi.fn()
    const { user } = await renderRecordForm(s, { ref, onDirtyChange })
    await user.type(screen.getByLabelText('到手金額'), '900')
    await waitFor(async () => expect(await s.repos.settings.get('recordDraft')).toBeDefined())
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    act(() => ref.current?.clear())
    expect((screen.getByLabelText('到手金額') as HTMLInputElement).value).toBe('')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await waitFor(async () => expect(await s.repos.settings.get('recordDraft')).toBeUndefined())
  })
})

describe('5.7 編輯模式', () => {
  async function setupEdit() {
    const s = await setupDb({ stakes: [[50, 100]], venues: ['A 俱樂部'] })
    const [stake] = await s.repos.stakes.list()
    const [venue] = await s.repos.venues.list()
    const session = await s.repos.sessions.create({
      type: 'cash',
      startAt: '2026-09-27T20:00',
      durationMin: 185,
      buyIns: [{ amount: 10000, fee: 0 }],
      cashOut: 12000,
      stakeId: stake!.id,
      venueId: venue!.id,
      name: '週末局',
    })
    return { s, session }
  }

  it('類型選擇器停用並顯示提示，帶入場次全部欄位', async () => {
    const { s, session } = await setupEdit()
    await renderRecordForm(s, { mode: 'edit', initialSession: session })
    for (const name of [/現金桌/, /^MTT$/, /限時 MTT/]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByText('類型無法修改，如需更改請刪除後重新新增')).toBeTruthy()
    expect((screen.getByLabelText('盲注級別') as HTMLSelectElement).value).toBe(session.stakeId)
    expect((screen.getByLabelText('買入（含服務費）') as HTMLInputElement).value).toBe('10,000')
    expect((screen.getByLabelText('到手金額') as HTMLInputElement).value).toBe('12,000')
    expect((screen.getByLabelText('開始日期') as HTMLInputElement).value).toBe('2026-09-27')
    expect((screen.getByRole('combobox', { name: '時長（小時）' }) as HTMLSelectElement).value).toBe('3')
    expect((screen.getByRole('combobox', { name: '時長（分鐘）' }) as HTMLSelectElement).value).toBe('5')
    expect((screen.getByLabelText('場地') as HTMLSelectElement).value).toBe(session.venueId)
    expect((screen.getByLabelText('名稱') as HTMLInputElement).value).toBe('週末局')
  })

  it('不寫草稿、不更新 last* 設定；呼叫端可判斷 dirty；儲存後更新場次', async () => {
    const { s, session } = await setupEdit()
    const onDirtyChange = vi.fn()
    const onSaved = vi.fn()
    const { user } = await renderRecordForm(s, { mode: 'edit', initialSession: session, onDirtyChange, onSaved })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    const cashOut = screen.getByLabelText('到手金額')
    await user.clear(cashOut)
    await user.type(cashOut, '15000')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await wait(700)
    expect(await s.repos.settings.get('recordDraft')).toBeUndefined()

    await user.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const updated = await s.repos.sessions.get(session.id)
    expect(updated).toMatchObject({ id: session.id, cashOut: 15000, createdAt: session.createdAt, type: 'cash' })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await wait(700)
    expect(await s.repos.settings.get('recordDraft')).toBeUndefined()
    expect(await s.repos.settings.get('lastType')).toBeUndefined()
    expect(await s.repos.settings.get('lastVenueByType')).toBeUndefined()
    expect(await s.repos.settings.get('lastStakeId')).toBeUndefined()
  })

  it('開始時間不可是未來的規則同樣適用', async () => {
    const { s, session } = await setupEdit()
    const { user } = await renderRecordForm(s, { mode: 'edit', initialSession: session })
    await user.selectOptions(screen.getByRole('combobox', { name: '開始小時' }), '21 時')
    // 改到明天（現在 2026-09-28 20:30）
    fireEvent.change(screen.getByLabelText('開始日期'), { target: { value: '2026-09-29' } })
    await user.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(screen.getByText('開始時間不可是未來')).toBeTruthy())
  })
})
