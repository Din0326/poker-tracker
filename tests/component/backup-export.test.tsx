// 8.4 匯出方式：canShare 為 true 時呼叫 navigator.share；分享取消（AbortError）不更新 lastBackupAt、不顯示錯誤；
// 其他錯誤顯示「匯出失敗，請再試一次」。CSV 匯出不更新 lastBackupAt（8.6）。
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalToast } from '../../src/components/GlobalToast'
import { BackupSection } from '../../src/features/settings/BackupSection'
import { AppDataContext } from '../../src/lib/appData'
import { hideGlobalToast } from '../../src/lib/globalToast'
import { setupDb, type Setup } from './helpers/renderRecordForm'

type ShareFn = (data: { files?: File[] }) => Promise<void>

function stubShare(share: ShareFn, canShare = true) {
  Object.defineProperty(navigator, 'canShare', { value: () => canShare, configurable: true })
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
}

beforeEach(() => hideGlobalToast())
afterEach(() => {
  // 還原為不支援分享
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  hideGlobalToast()
})

async function renderSection(s: Setup) {
  const onChanged = vi.fn()
  const user = userEvent.setup()
  render(
    <AppDataContext value={s}>
      <BackupSection lastBackupAt={undefined} onChanged={onChanged} />
      <GlobalToast />
    </AppDataContext>,
  )
  return { user, onChanged }
}

describe('8.4 匯出 JSON：分享選單', () => {
  it('canShare 為 true：以 navigator.share 分享備份檔；完成後 lastBackupAt = exportedAt 並提示「已匯出備份」', async () => {
    const s = await setupDb({ stakes: [[50, 100]], venues: ['A 場'] })
    const shared: File[] = []
    stubShare(async ({ files }) => {
      shared.push(...(files ?? []))
    })
    const { user, onChanged } = await renderSection(s)
    await user.click(screen.getByRole('button', { name: '匯出備份（JSON）' }))
    await waitFor(() => expect(screen.getByText('已匯出備份')).toBeTruthy())
    expect(shared).toHaveLength(1)
    const file = shared[0]!
    expect(file.name).toMatch(/^poker-backup-\d{8}-\d{4}\.json$/)
    const backup = JSON.parse(await file.text())
    expect(backup).toMatchObject({ app: 'poker-tracker', schemaVersion: 1 })
    expect(backup.venues).toHaveLength(1)
    expect(backup.stakes).toHaveLength(1)
    expect(await s.repos.settings.get('lastBackupAt')).toBe(backup.exportedAt)
    expect(onChanged).toHaveBeenCalled()
  })

  it('分享選單按取消（AbortError）：不更新 lastBackupAt、不顯示錯誤', async () => {
    const s = await setupDb()
    const share = vi.fn<ShareFn>(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })
    stubShare(share)
    const { user, onChanged } = await renderSection(s)
    await user.click(screen.getByRole('button', { name: '匯出備份（JSON）' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    // 按鈕恢復可按（匯出流程已結束）
    await waitFor(() => expect(screen.getByRole('button', { name: '匯出備份（JSON）' }).hasAttribute('disabled')).toBe(false))
    expect(await s.repos.settings.get('lastBackupAt')).toBeUndefined()
    expect(screen.queryByText('匯出失敗，請再試一次')).toBeNull()
    expect(screen.queryByText('已匯出備份')).toBeNull()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('分享發生其他錯誤：顯示「匯出失敗，請再試一次」，不更新 lastBackupAt', async () => {
    const s = await setupDb()
    stubShare(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    const { user } = await renderSection(s)
    await user.click(screen.getByRole('button', { name: '匯出備份（JSON）' }))
    await waitFor(() => expect(screen.getByText('匯出失敗，請再試一次')).toBeTruthy())
    expect(await s.repos.settings.get('lastBackupAt')).toBeUndefined()
  })

  it('CSV 匯出同樣走分享，但不更新 lastBackupAt', async () => {
    const s = await setupDb()
    const shared: File[] = []
    stubShare(async ({ files }) => {
      shared.push(...(files ?? []))
    })
    const { user } = await renderSection(s)
    await user.click(screen.getByRole('button', { name: '匯出 CSV' }))
    await waitFor(() => expect(screen.getByText('已匯出 CSV')).toBeTruthy())
    expect(shared[0]!.name).toMatch(/^poker-sessions-\d{8}\.csv$/)
    expect(await s.repos.settings.get('lastBackupAt')).toBeUndefined()
  })
})

describe('8.4 匯出 JSON：不支援分享時下載', () => {
  it('canShare 不存在：以 Blob + <a download> 下載，並更新 lastBackupAt', async () => {
    const s = await setupDb()
    const created: Blob[] = []
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob)
      return 'blob:test'
    })
    const clicks: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download)
    })
    try {
      const { user } = await renderSection(s)
      await user.click(screen.getByRole('button', { name: '匯出備份（JSON）' }))
      await waitFor(() => expect(screen.getByText('已匯出備份')).toBeTruthy())
      expect(clicks).toHaveLength(1)
      expect(clicks[0]).toMatch(/^poker-backup-\d{8}-\d{4}\.json$/)
      expect(created).toHaveLength(1)
      expect(await s.repos.settings.get('lastBackupAt')).toBeTruthy()
    } finally {
      createObjectURL.mockRestore()
      click.mockRestore()
    }
  })
})
