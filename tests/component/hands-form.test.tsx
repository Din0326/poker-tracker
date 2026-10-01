// SPEC-v2-hands 第 5 節新增 / 編輯手牌頁的元件測試：8.10 更新前寫入手牌草稿、5.7 編輯不寫草稿、
// HC31 金額輸入框（只接受整數、保留小數點交由驗證）、5.6 標籤建議、5.3 暫存為簡易的限制
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { finalizeHandContent, type Hand } from '../../src/domain/hands'
import { HandAmountInput } from '../../src/features/hands/HandAmountInput'
import { handToValues } from '../../src/features/hands/handFormModel'
import { flushPendingDrafts } from '../../src/lib/draftFlush'
import { useGlobalToast } from '../../src/lib/globalToast'
import { at79 } from './helpers/handValues'
import { entryValues, renderHandForm, setupHandDb } from './helpers/renderHandForm'

function memo(id: string, tags: string[], playedAt: string): Hand {
  return {
    id,
    exportSeq: Number.parseInt(id.slice(-4), 16),
    createdAt: '2026-09-28T23:00:00+08:00',
    updatedAt: '2026-09-28T23:00:00+08:00',
    ...finalizeHandContent({
      source: 'manual',
      gameType: 'cash',
      sessionId: null,
      playedAt,
      bb: null,
      heroCards: [],
      heroPosition: null,
      board: [],
      heroNet: null,
      detail: null,
      tags,
      note: 'n',
      sourceHandId: null,
      rawText: null,
      parserVersion: null,
    }),
  }
}

describe('5.7 / 8.10 手牌草稿', () => {
  it('8.10 版本更新前（flushPendingDrafts）立即寫入 500ms 防抖期間內的手牌草稿', async () => {
    const s = setupHandDb()
    const { user } = await renderHandForm(s)
    await user.type(screen.getByLabelText('備註'), 'abc')
    // 防抖期間尚未寫入
    expect(await s.repos.settings.get('handDraft')).toBeUndefined()
    await act(() => flushPendingDrafts())
    expect(await s.repos.settings.get('handDraft')).toMatchObject({ version: 1, values: { note: 'abc' } })
  })

  it('回到預帶值時刪除草稿', async () => {
    const s = setupHandDb()
    const { user } = await renderHandForm(s)
    await user.type(screen.getByLabelText('備註'), 'a')
    await act(() => flushPendingDrafts())
    expect(await s.repos.settings.get('handDraft')).toBeDefined()
    await user.clear(screen.getByLabelText('備註'))
    await act(() => flushPendingDrafts())
    expect(await s.repos.settings.get('handDraft')).toBeUndefined()
  })

  it('編輯模式不讀寫草稿', async () => {
    const s = setupHandDb()
    const hand = await s.repos.hands.create({ source: 'manual', gameType: 'cash', playedAt: '2026-09-27T21:15:00', detail: null, note: 'x' })
    const values = handToValues(hand, undefined)
    const { user } = await renderHandForm(s, { mode: 'edit', hand, initial: values })
    await user.type(screen.getByLabelText('備註'), 'yz')
    await act(() => flushPendingDrafts())
    expect(await s.repos.settings.get('handDraft')).toBeUndefined()
  })
})

describe('HC31 金額輸入框（3.8）', () => {
  function Harness({ initial = '' }: { initial?: string }) {
    const [value, setValue] = useState(initial)
    return (
      <>
        <label htmlFor="amt">金額</label>
        <HandAmountInput id="amt" value={value} onValueChange={setValue} />
        <output data-testid="raw">{value}</output>
      </>
    )
  }

  it('inputmode="numeric"；千分位即時顯示、存值去除逗號；$ 與文字自動移除', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('金額') as HTMLInputElement
    expect(input.getAttribute('inputmode')).toBe('numeric')
    await user.type(input, '$1,000abc')
    expect(input.value).toBe('1,000')
    expect(screen.getByTestId('raw').textContent).toBe('1000')
  })

  it('小數點不被默默移除（12.5 不會變成 125），交由驗證顯示「金額必須是整數」', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('金額') as HTMLInputElement
    await user.type(input, '12.5')
    expect(input.value).toBe('12.5')
    expect(screen.getByTestId('raw').textContent).toBe('12.5')
  })
})

describe('5.6 標籤建議', () => {
  it('聚焦時列出所有手牌的標籤（依最近使用、去重不分大小寫、排除本手已加），點選加入', async () => {
    const s = setupHandDb()
    await s.db.hands.bulkAdd([
      memo('00000000-0000-4000-8000-000000000a01', ['Bluff', '3bet'], '2026-09-01T20:00:00'),
      memo('00000000-0000-4000-8000-000000000a02', ['bluff', 'river'], '2026-09-20T20:00:00'),
    ])
    const { user } = await renderHandForm(s, { initial: entryValues({ tags: ['RIVER'] }) })
    await user.click(screen.getByLabelText('新增標籤'))
    const list = await screen.findByTestId('tag-suggestions')
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['bluff', '3bet'])
    await user.type(screen.getByLabelText('新增標籤'), '3')
    expect(within(screen.getByTestId('tag-suggestions')).getAllByRole('button').map((b) => b.textContent)).toEqual(['3bet'])
    await user.click(screen.getByRole('button', { name: '3bet' }))
    expect(screen.getAllByTestId('tag-chip').map((c) => c.textContent)).toEqual(['RIVER', '3bet'])
    expect(screen.queryByTestId('tag-suggestions')).toBeNull()
    // chip 的刪除鈕
    await user.click(screen.getByRole('button', { name: '刪除標籤 RIVER' }))
    expect(screen.getAllByTestId('tag-chip').map((c) => c.textContent)).toEqual(['3bet'])
  })
})

describe('5.3 暫存為簡易', () => {
  function ToastProbe() {
    const toast = useGlobalToast()
    return <p data-testid="probe">{toast?.text ?? ''}</p>
  }

  it('步驟 1 尚未通過時提示「牌局設定還沒完成，無法暫存」，不寫入', async () => {
    const s = setupHandDb()
    render(<ToastProbe />)
    const { user } = await renderHandForm(s, { initial: entryValues({ mode: 'complete' }) })
    await user.click(screen.getByRole('button', { name: '更多操作' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '暫存為簡易' }))
    expect(screen.getByTestId('probe').textContent).toBe('牌局設定還沒完成，無法暫存')
    expect(await s.repos.hands.list()).toEqual([])
  })

  it('翻牌行動中暫存：存為 simple 且帶 detail，Settings.lastHandSetup 更新、草稿刪除', async () => {
    const s = setupHandDb()
    let saved: Hand | null = null
    const { user } = await renderHandForm(s, { initial: at79(7, { boardSteps: [3], board: ['Kh', '7d', '2c', null, null] }), onSaved: (h) => (saved = h) })
    await user.click(screen.getByRole('button', { name: '更多操作' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '暫存為簡易' }))
    await expect.poll(() => saved).not.toBeNull()
    const [hand] = await s.repos.hands.list()
    expect(hand).toMatchObject({ kind: 'simple', heroNet: null, board: ['Kh', '7d', '2c'], heroCards: ['As', 'Ks'], heroPosition: 'BTN' })
    expect(hand!.detail!.actions).toHaveLength(7)
    expect(await s.repos.settings.get('lastHandSetup')).toEqual({ gameType: 'cash', tableSize: 6, sb: 100, bb: 200, ante: 0, straddle: 0, defaultStack: 20000, heroSeat: 4 })
    expect(await s.repos.settings.get('handDraft')).toBeUndefined()
  })
})

describe('5.8 儲存失敗', () => {
  function ToastProbe() {
    const toast = useGlobalToast()
    return <p data-testid="probe">{toast?.text ?? ''}</p>
  }

  it('寫入失敗：顯示「儲存失敗，請再試一次」，表單內容不清空', async () => {
    const s = setupHandDb()
    render(<ToastProbe />)
    let saved = false
    const { user } = await renderHandForm(s, { initial: entryValues({ heroCards: ['As', 'Kd'], note: '保留' }), onSaved: () => (saved = true) })
    // 關閉資料庫且不自動重開，模擬寫入失敗
    s.db.close({ disableAutoOpen: true })
    await user.click(screen.getByRole('button', { name: '儲存' }))
    await expect.poll(() => screen.getByTestId('probe').textContent).toBe('儲存失敗，請再試一次')
    expect(saved).toBe(false)
    expect((screen.getByLabelText('備註') as HTMLTextAreaElement).value).toBe('保留')
    expect(screen.getByRole('button', { name: '儲存' })).toBeTruthy()
  })
})
