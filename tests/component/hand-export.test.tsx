// SPEC-v2-hands 12.3 H3：匯出 sheet 四種狀態（簡易手牌略過說明、0 手、超過 10,000 手、GTO Wizard 提示），
// 「分享 / 下載」的 click 處理在呼叫 shareFile 前沒有 await（同步呼叫 navigator.share、click 中不讀 DB），
// NotAllowedError 的「再按一次」，以及手牌詳情的「匯出這手」「查看匯出文字」。
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalToast } from '../../src/components/GlobalToast'
import { exportPokerStars, type Hand } from '../../src/domain/hands'
import { HandDetailPage } from '../../src/features/hands/HandDetailPage'
import { HandExportSheet } from '../../src/features/hands/HandExportSheet'
import { exportRequestFor, type ExportRequest } from '../../src/features/hands/handExportModel'
import { AppDataContext } from '../../src/lib/appData'
import { hideGlobalToast } from '../../src/lib/globalToast'
import { hc9Hand, tenMaxHand } from '../unit/helpers/exportCases'
import { example79Hand } from '../unit/helpers/hands'
import { setupHandDb, type HandSetupDb } from './helpers/renderHandForm'

type ShareFn = (data: { files?: File[] }) => Promise<void>

function stubShare(share: ShareFn, canShare = true) {
  Object.defineProperty(navigator, 'canShare', { value: () => canShare, configurable: true })
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
}

beforeEach(() => hideGlobalToast())
afterEach(() => {
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  hideGlobalToast()
  vi.restoreAllMocks()
})

/** 以 repos 寫入（系統配發 exportSeq、推導 kind 與摘要） */
async function save(s: HandSetupDb, hand: Hand, playedAt = hand.playedAt): Promise<Hand> {
  return s.repos.hands.create({ source: hand.source, gameType: hand.gameType, playedAt, detail: hand.detail, board: hand.board })
}

async function saveMemo(s: HandSetupDb): Promise<Hand> {
  return s.repos.hands.create({ source: 'manual', gameType: 'cash', playedAt: '2026-09-29T20:00:00', detail: null, heroCards: ['Ah', 'Kd'] })
}

function renderSheet(s: HandSetupDb, request: ExportRequest, onClose = vi.fn()) {
  render(
    <AppDataContext value={s}>
      <HandExportSheet request={request} onClose={onClose} />
      <GlobalToast />
    </AppDataContext>,
  )
  return { onClose, sheet: () => screen.getByTestId('hand-export-sheet') }
}

const shareButton = () => screen.getByRole('button', { name: '分享 / 下載' })

describe('12.3 H3 匯出 sheet 四種狀態（7.1）', () => {
  it('12.3 H3 簡易手牌略過說明：「將匯出 N 手完整手牌」＋「簡易手牌 M 手無法匯出，已略過」', async () => {
    const s = setupHandDb()
    const complete = await save(s, example79Hand())
    const memos = [await saveMemo(s), await saveMemo(s)]
    const { sheet } = renderSheet(s, exportRequestFor([complete, ...memos]))
    expect(within(sheet()).getByTestId('export-preparing').textContent).toBe('準備中…')
    await waitFor(() => expect(sheet().dataset.status).toBe('ready'))
    expect(screen.getByTestId('export-count').textContent).toBe('將匯出 1 手完整手牌')
    expect(screen.getByTestId('export-skipped').textContent).toBe('簡易手牌 2 手無法匯出，已略過')
    expect(screen.getByRole('dialog', { name: '匯出手牌' })).toBeTruthy()
    expect(shareButton()).toBeTruthy()
  })

  it('12.3 H3 0 手：「沒有可匯出的完整手牌」，不顯示匯出按鈕（不讀 DB）', async () => {
    const s = setupHandDb()
    const memo = await saveMemo(s)
    const read = vi.spyOn(s.repos.hands, 'getMany')
    const { sheet } = renderSheet(s, exportRequestFor([memo]))
    expect(sheet().dataset.status).toBe('empty')
    expect(screen.getByTestId('export-none').textContent).toBe('沒有可匯出的完整手牌')
    expect(screen.getByTestId('export-skipped').textContent).toBe('簡易手牌 1 手無法匯出，已略過')
    expect(screen.queryByRole('button', { name: '分享 / 下載' })).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('12.3 H3 超過 10,000 手：「一次最多匯出 10,000 手，請縮小篩選範圍」，不顯示匯出按鈕（不讀 DB）', async () => {
    const s = setupHandDb()
    const read = vi.spyOn(s.repos.hands, 'getMany')
    const ids = Array.from({ length: 10_001 }, (_, i) => `id-${i}`)
    const { sheet } = renderSheet(s, { completeIds: ids, skippedSimple: 0, single: false })
    expect(sheet().dataset.status).toBe('tooMany')
    expect(screen.getByTestId('export-too-many').textContent).toBe('一次最多匯出 10,000 手，請縮小篩選範圍')
    expect(screen.queryByRole('button', { name: '分享 / 下載' })).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('12.3 H3 恰好 10,000 手不算超過上限（邊界）', async () => {
    const s = setupHandDb()
    const ids = Array.from({ length: 10_000 }, (_, i) => `id-${i}`)
    const { sheet } = renderSheet(s, { completeIds: ids, skippedSimple: 0, single: false })
    expect(sheet().dataset.status).toBe('preparing')
    // 讀不到任何手牌（id 不存在）時視為 0 手
    await waitFor(() => expect(sheet().dataset.status).toBe('empty'))
  })

  it('12.3 H3 GTO Wizard 提示：有不符合的手牌時顯示「其中 N 手…仍會一併匯出」，全部符合時不顯示', async () => {
    const s = setupHandDb()
    const ok = await save(s, example79Hand())
    const ten = await save(s, tenMaxHand(), '2026-09-28T20:00:00')
    const mtt = await save(s, hc9Hand(), '2026-09-27T20:00:00')
    renderSheet(s, exportRequestFor([ok, ten, mtt]))
    await waitFor(() => expect(screen.getByTestId('export-count').textContent).toBe('將匯出 3 手完整手牌'))
    expect(screen.getByTestId('export-gto-hint').textContent).toBe('其中 1 手的牌局格式（例如 9 人桌現金桌）GTO Wizard 可能無法分析，仍會一併匯出')
    expect(screen.queryByTestId('export-skipped')).toBeNull()
  })

  it('12.3 H3 GTO Wizard 提示：全部符合時不顯示', async () => {
    const s = setupHandDb()
    const ok = await save(s, example79Hand())
    renderSheet(s, exportRequestFor([ok]))
    await waitFor(() => expect(screen.getByTestId('export-count')).toBeTruthy())
    expect(screen.queryByTestId('export-gto-hint')).toBeNull()
  })
})

describe('12.3 H3 分享 / 下載：click 處理在呼叫 shareFile 前沒有 await（iOS 使用者手勢，7.1）', () => {
  it('12.3 H3 click 派發後、任何 microtask 之前 navigator.share 已被呼叫；檔案內容、檔名、MIME 正確', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    const b = await save(s, hc9Hand(), '2026-09-29T10:00:00')
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    const { onClose } = renderSheet(s, exportRequestFor([a, b]))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    fireEvent.click(shareButton())
    // 同步檢查：沒有 await 任何東西
    expect(share).toHaveBeenCalledTimes(1)
    const file = share.mock.calls[0]![0].files![0]!
    expect(file.name).toMatch(/^poker-hands-\d{8}-\d{4}\.txt$/)
    expect(file.type).toBe('text/plain')
    expect(await file.text()).toBe(exportPokerStars([a, b]))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByText('已匯出 2 手')).toBeTruthy()
  })

  it('12.3 H3 按下時不再讀 DB：click 的同步路徑中沒有任何手牌或設定讀取（資料在 sheet 開啟時預先組好）', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    renderSheet(s, exportRequestFor([a]))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    const reads = [
      vi.spyOn(s.repos.hands, 'getMany'),
      vi.spyOn(s.repos.hands, 'get'),
      vi.spyOn(s.repos.settings, 'get'),
      vi.spyOn(s.db.hands, 'bulkGet'),
      vi.spyOn(s.db.hands, 'toArray'),
      vi.spyOn(s.db.settings, 'get'),
    ]
    fireEvent.click(shareButton())
    expect(share).toHaveBeenCalledTimes(1)
    for (const r of reads) expect(r).not.toHaveBeenCalled()
  })

  it('12.3 H3 匯出這手（single）：檔名 poker-hand-<匯出編號>.txt', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    renderSheet(s, exportRequestFor([a], true))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    fireEvent.click(shareButton())
    expect(share.mock.calls[0]![0].files![0]!.name).toBe(`poker-hand-77${String(a.exportSeq).padStart(14, '0')}.txt`)
  })

  it('12.3 H3 使用設定頁的匯出名稱（handHeroName）', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    await s.repos.settings.set('handHeroName', 'Din_0326')
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    renderSheet(s, exportRequestFor([a]))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    fireEvent.click(shareButton())
    const text = await share.mock.calls[0]![0].files![0]!.text()
    expect(text).toContain('Dealt to Din_0326 [As Ks]')
    expect(text).not.toContain('Hero')
  })

  it('12.3 H3 NotAllowedError：提示「請再按一次」；再按一次即可完成', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    let calls = 0
    stubShare(async () => {
      calls++
      if (calls === 1) throw new DOMException('user activation required', 'NotAllowedError')
    })
    const { onClose } = renderSheet(s, exportRequestFor([a]))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    fireEvent.click(shareButton())
    await waitFor(() => expect(screen.getByTestId('export-notice').textContent).toBe('檔案已準備好，請再按一次「分享 / 下載」'))
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(shareButton().hasAttribute('disabled')).toBe(false))
    fireEvent.click(shareButton())
    expect(calls).toBe(2)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('12.3 H3 使用者取消分享（AbortError）不提示、sheet 不關閉；其他錯誤顯示匯出失敗', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    let error: DOMException = new DOMException('cancel', 'AbortError')
    stubShare(async () => {
      throw error
    })
    const { onClose } = renderSheet(s, exportRequestFor([a]))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    fireEvent.click(shareButton())
    await waitFor(() => expect(shareButton().hasAttribute('disabled')).toBe(false))
    expect(screen.queryByTestId('export-notice')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    error = new DOMException('boom', 'DataError')
    fireEvent.click(shareButton())
    await waitFor(() => expect(screen.getByTestId('export-notice').textContent).toBe('匯出失敗，請再試一次'))
  })

  it('12.3 H3 不支援分享時走 Blob 下載路徑（同步觸發 <a download>）', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    const createUrl = vi.fn(() => 'blob:hands')
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true })
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download)
    })
    const { onClose } = renderSheet(s, exportRequestFor([a], true))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    fireEvent.click(shareButton())
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([`poker-hand-77${String(a.exportSeq).padStart(14, '0')}.txt`])
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('匯出不改變任何資料（不更新 lastBackupAt、不更新手牌）', async () => {
    const s = setupHandDb()
    const a = await save(s, example79Hand())
    const before = await s.db.hands.toArray()
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    const { onClose } = renderSheet(s, exportRequestFor([a]))
    await waitFor(() => expect(shareButton()).toBeTruthy())
    fireEvent.click(shareButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await s.db.hands.toArray()).toEqual(before)
    expect(await s.repos.settings.get('lastBackupAt')).toBeUndefined()
  })
})

function renderDetail(s: HandSetupDb, id: string) {
  const router = createMemoryRouter([{ path: '/hands/:id', element: <HandDetailPage /> }], { initialEntries: [`/hands/${id}`] })
  return render(
    <AppDataContext value={s}>
      <RouterProvider router={router} />
    </AppDataContext>,
  )
}

describe('6.2 手牌詳情：匯出這手、查看匯出文字', () => {
  it('完整手牌顯示「匯出這手」「查看匯出文字」；簡易手牌不顯示', async () => {
    const s = setupHandDb()
    const memo = await saveMemo(s)
    renderDetail(s, memo.id)
    await screen.findByTestId('detail-result')
    expect(screen.queryByRole('button', { name: '匯出這手' })).toBeNull()
    expect(screen.queryByRole('button', { name: '查看匯出文字' })).toBeNull()
  })

  it('查看匯出文字：等寬字型顯示這手的 PokerStars 文字（使用匯出名稱），「複製」在 click 中同步呼叫剪貼簿', async () => {
    const s = setupHandDb()
    const hand = await save(s, example79Hand())
    await s.repos.settings.set('handHeroName', 'Din_0326')
    renderDetail(s, hand.id)
    const button = await screen.findByRole('button', { name: '查看匯出文字' })
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: '匯出文字' })
    const pre = within(dialog).getByTestId('export-text')
    expect(pre.tagName).toBe('PRE')
    expect(pre.className).toContain('font-mono')
    expect(pre.className).toContain('overflow-auto')
    expect(pre.textContent).toBe(exportPokerStars([hand], 'Din_0326'))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    fireEvent.click(within(dialog).getByRole('button', { name: '複製' }))
    expect(writeText).toHaveBeenCalledWith(exportPokerStars([hand], 'Din_0326'))
    await waitFor(() => expect(within(dialog).getByTestId('export-copy-status').textContent).toBe('已複製'))
  })

  it('複製失敗時顯示「複製失敗，請再試一次」', async () => {
    const s = setupHandDb()
    const hand = await save(s, example79Hand())
    renderDetail(s, hand.id)
    fireEvent.click(await screen.findByRole('button', { name: '查看匯出文字' }))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true })
    const dialog = screen.getByRole('dialog', { name: '匯出文字' })
    fireEvent.click(within(dialog).getByRole('button', { name: '複製' }))
    await waitFor(() => expect(within(dialog).getByTestId('export-copy-status').textContent).toBe('複製失敗，請再試一次'))
  })

  it('匯出這手：開啟「匯出手牌」sheet，不符合 GTO Wizard 格式時同樣顯示提示', async () => {
    const s = setupHandDb()
    const hand = await save(s, tenMaxHand())
    renderDetail(s, hand.id)
    fireEvent.click(await screen.findByRole('button', { name: '匯出這手' }))
    await waitFor(() => expect(screen.getByTestId('export-count').textContent).toBe('將匯出 1 手完整手牌'))
    expect(screen.getByTestId('export-gto-hint').textContent).toContain('其中 1 手的牌局格式')
  })
})
