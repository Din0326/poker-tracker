// 8.4 匯出方式：canShare 為 true 時呼叫 navigator.share；分享取消（AbortError）不更新 lastBackupAt、不顯示錯誤；
// 其他錯誤顯示「匯出失敗，請再試一次」。CSV 匯出不更新 lastBackupAt（8.6）。
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  // 等 liveQuery 快照就緒（匯出按鈕可按）
  await waitFor(() => expect(exportJsonButton().hasAttribute('disabled')).toBe(false))
  return { user, onChanged }
}

const exportJsonButton = () => screen.getByRole('button', { name: '匯出備份（JSON）' })
const exportCsvButton = () => screen.getByRole('button', { name: '匯出 CSV' })

describe('iOS 使用者手勢：navigator.share 在 click 事件的同步路徑中呼叫', () => {
  it('JSON：click 派發後、任何 microtask 之前 share 已被呼叫', async () => {
    const s = await setupDb({ stakes: [[50, 100]] })
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    await renderSection(s)
    fireEvent.click(exportJsonButton())
    // 同步檢查：沒有 await 任何東西
    expect(share).toHaveBeenCalledTimes(1)
    const file = share.mock.calls[0]![0].files![0]!
    expect(file.name).toMatch(/^poker-backup-\d{8}-\d{4}\.json$/)
    await waitFor(() => expect(screen.getByText('已匯出備份')).toBeTruthy())
  })

  it('CSV：click 派發後、任何 microtask 之前 share 已被呼叫', async () => {
    const s = await setupDb()
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    await renderSection(s)
    fireEvent.click(exportCsvButton())
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0]![0].files![0]!.name).toMatch(/^poker-sessions-\d{8}\.csv$/)
    await waitFor(() => expect(screen.getByText('已匯出 CSV')).toBeTruthy())
  })

  it('按下匯出時不再讀 DB：click 的同步路徑中沒有任何資料表讀取', async () => {
    const s = await setupDb()
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    await renderSection(s)
    const reads = [vi.spyOn(s.db.sessions, 'toArray'), vi.spyOn(s.db.settings, 'toArray')]
    fireEvent.click(exportJsonButton())
    expect(share).toHaveBeenCalledTimes(1)
    for (const r of reads) expect(r).not.toHaveBeenCalled()
    for (const r of reads) r.mockRestore()
  })

  it('快照就緒前匯出按鈕停用並顯示準備中', async () => {
    const s = await setupDb()
    render(
      <AppDataContext value={s}>
        <BackupSection lastBackupAt={undefined} onChanged={() => undefined} />
      </AppDataContext>,
    )
    const preparing = screen.getAllByRole('button', { name: '準備中…' })
    expect(preparing).toHaveLength(2)
    for (const b of preparing) expect(b.hasAttribute('disabled')).toBe(true)
    await waitFor(() => expect(exportJsonButton().hasAttribute('disabled')).toBe(false))
  })

  it('NotAllowedError：提示「檔案已準備好，請再按一次匯出」，不更新 lastBackupAt；再按一次即可完成', async () => {
    const s = await setupDb()
    let calls = 0
    stubShare(async () => {
      calls++
      if (calls === 1) throw new DOMException('user activation required', 'NotAllowedError')
    })
    const { user } = await renderSection(s)
    await user.click(exportJsonButton())
    await waitFor(() => expect(screen.getByText('檔案已準備好，請再按一次匯出')).toBeTruthy())
    expect(screen.queryByText('匯出失敗，請再試一次')).toBeNull()
    expect(await s.repos.settings.get('lastBackupAt')).toBeUndefined()
    await waitFor(() => expect(exportJsonButton().hasAttribute('disabled')).toBe(false))
    await user.click(exportJsonButton())
    await waitFor(() => expect(screen.getByText('已匯出備份')).toBeTruthy())
    expect(await s.repos.settings.get('lastBackupAt')).toBeTruthy()
  })

  it('資料變更後（新增一筆場次、新增場地）匯出內容包含新資料', async () => {
    const s = await setupDb({ stakes: [[50, 100]] })
    const shared: File[] = []
    stubShare(async ({ files }) => {
      shared.push(...(files ?? []))
    })
    await renderSection(s)
    const card = screen.getByTestId('backup-card')
    expect(card.getAttribute('data-snapshot-sessions')).toBe('0')
    const [stake] = await s.repos.stakes.list()
    const created = await s.repos.sessions.create({
      type: 'cash',
      startAt: '2026-09-27T20:00',
      durationMin: 60,
      buyIns: [{ amount: 1000, fee: 0 }],
      cashOut: 1500,
      stakeId: stake!.id,
    })
    await s.repos.venues.create('新場地')
    await waitFor(() => expect(card.getAttribute('data-snapshot-sessions')).toBe('1'))
    await waitFor(() => expect(exportJsonButton().hasAttribute('disabled')).toBe(false))
    fireEvent.click(exportJsonButton())
    await waitFor(() => expect(shared).toHaveLength(1))
    const backup = JSON.parse(await shared[0]!.text())
    expect(backup.sessions.map((x: { id: string }) => x.id)).toEqual([created.id])
    await waitFor(async () => {
      // 場地的新增也反映在快照（liveQuery 可能分兩次更新，必要時再匯出一次）
      const last = JSON.parse(await shared[shared.length - 1]!.text())
      if (!last.venues.some((v: { name: string }) => v.name === '新場地')) {
        fireEvent.click(exportJsonButton())
        throw new Error('venue not yet in snapshot')
      }
    })
  })
})

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
    // v1.2：備份 schemaVersion 2
    expect(backup).toMatchObject({ app: 'poker-tracker', schemaVersion: 2 })
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
      throw new DOMException('write failed', 'DataError')
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
