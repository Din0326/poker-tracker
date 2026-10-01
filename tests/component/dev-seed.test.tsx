/// <reference types="vite/client" />
// 開發用 seed 按鈕（SPEC-v2-hands 11.1、13 節 H0）：開發模式下產生 10,000 手測試手牌並寫入 hands 表，
// exportSeq 依 7.4 接續配發、lastHandSeq 同步更新（正式建置不含按鈕與產生器，見 E2E 與 dist 搜尋）
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DevSeedSection } from '../../src/features/settings/DevSeedSection'
import { AppDataContext } from '../../src/lib/appData'
import { setupDb } from './helpers/renderRecordForm'

describe('DevSeedSection：產生 10,000 手測試手牌', () => {
  it('寫入 10,000 手；已有 lastHandSeq 時接續配發 exportSeq 並更新 lastHandSeq', async () => {
    const s = await setupDb()
    await s.repos.settings.set('lastHandSeq', 41)
    const user = userEvent.setup()
    render(
      <AppDataContext value={s}>
        <DevSeedSection />
      </AppDataContext>,
    )
    await user.click(screen.getByRole('button', { name: '產生 10,000 手測試手牌' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已產生 10,000 手測試手牌'), { timeout: 60_000 })
    expect(await s.db.hands.count()).toBe(10_000)
    expect((await s.db.hands.orderBy('exportSeq').first())?.exportSeq).toBe(42)
    expect((await s.db.hands.orderBy('exportSeq').last())?.exportSeq).toBe(10_041)
    expect(await s.repos.settings.get('lastHandSeq')).toBe(10_041)
    await s.db.delete()
  }, 90_000)
})
