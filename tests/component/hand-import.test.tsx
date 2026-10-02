// SPEC-v2-hands 8.2、6.2、12.3 H4：匯入 GG 手牌頁（實驗功能標示、預覽摘要與原因分組、關聯場次只列現金桌、
// 寫入失敗整批還原的訊息）與匯入手牌詳情（實驗標示、原始文字）。GG 原文為非真實檔案（待真實檔案驗證，HQ15）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { HandDetailPage } from '../../src/features/hands/HandDetailPage'
import { HandImportPage } from '../../src/features/hands/HandImportPage'
import { handsTabMemory } from '../../src/features/hands/handsListMemory'
import { AppDataContext } from '../../src/lib/appData'
import { setupHandDb, type HandSetupDb } from './helpers/renderHandForm'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'hands', 'gg-example-1.txt')
const example = () => readFileSync(FIXTURE, 'utf8').trimEnd()
const withId = (id: string) => example().replace('Poker Hand #RC1000000001:', `Poker Hand #${id}:`)

function renderImport(setup: HandSetupDb) {
  const router = createMemoryRouter(
    [
      { path: '/hands/import', element: <HandImportPage /> },
      { path: '/hands', element: <p>hands list</p> },
    ],
    { initialEntries: ['/hands', '/hands/import'], initialIndex: 1 },
  )
  const utils = render(
    <AppDataContext value={setup}>
      <RouterProvider router={router} />
    </AppDataContext>,
  )
  return { ...utils, router, user: userEvent.setup() }
}

async function upload(user: ReturnType<typeof userEvent.setup>, contents: string[]) {
  const input = screen.getByTestId('import-file-input') as HTMLInputElement
  const files = contents.map((c, i) => new File([c], `gg-${i + 1}.txt`, { type: 'text/plain' }))
  await user.upload(input, files)
}

async function cashAndMttSessions(setup: HandSetupDb) {
  const stake = await setup.repos.stakes.create(1, 2)
  const cash = await setup.repos.sessions.create({ type: 'cash', startAt: '2026-09-20T20:00', durationMin: 60, buyIns: [{ amount: 1000, fee: 0 }], cashOut: 1500, stakeId: stake.id })
  const mtt = await setup.repos.sessions.create({ type: 'mtt', startAt: '2026-09-21T13:00', durationMin: 60, buyIns: [{ amount: 1000, fee: 0 }], cashOut: 0, name: 'Sunday' })
  return { cash, mtt }
}

describe('12.3 H4 匯入 GG 手牌頁（8.2）', () => {
  it('12.3 H4 匯入頁顯示「實驗功能」標示與 8.2 說明；選擇檔案按鈕與檔案選擇器（accept、multiple）', async () => {
    const setup = setupHandDb()
    renderImport(setup)
    expect((screen.getByRole('heading', { level: 1 })).textContent).toContain('匯入 GG 手牌')
    expect((screen.getByTestId('experimental-badge')).textContent).toContain('實驗功能')
    expect((screen.getByTestId('import-intro')).textContent).toContain('GG 手牌格式依公開資料撰寫，尚未以真實檔案驗證。不支援的手牌會略過並說明原因，匯入後請抽查結果。')
    expect(screen.getByRole('button', { name: '選擇檔案' })).toBeTruthy()
    const input = screen.getByTestId('import-file-input') as HTMLInputElement
    expect(input.accept).toBe('.txt,.zip,text/plain,application/zip')
    expect(input.multiple).toBe(true)
  })

  it('8.2 預覽：可匯入 / 重複略過 / 無法匯入，原因分組可展開前 20 筆明細；只列現金桌場次；匯入後 sessionId 正確並前往列表（來源 = GG）', async () => {
    const setup = setupHandDb()
    const { cash, mtt } = await cashAndMttSessions(setup)
    // 先匯入一手，讓同一手在第二次計為重複
    const { router, user } = renderImport(setup)
    const unknown = withId('RC2').replace('*** FLOP ***', 'Hero: says hi\n*** FLOP ***')
    await upload(user, [[withId('RC1'), withId('RC1'), unknown, withId('XX9')].join('\n\n\n')])
    await waitFor(() => expect((screen.getByTestId('import-summary')).textContent).toContain('可匯入 1 手 · 重複略過 1 手 · 無法匯入 2 手'))
    const groups = screen.getAllByTestId('import-reject-reason').map((el) => el.textContent)
    expect(groups).toEqual(['無法辨識的內容：1 手', '不支援的牌局類型（前綴 XX）：1 手'])
    const samples = screen.getAllByTestId('import-reject-sample').map((el) => el.textContent)
    expect(samples).toEqual(['RC2 · 無法辨識的內容：第 25 行', 'XX9 · 不支援的牌局類型（前綴 XX）'])

    // 關聯場次只列現金桌場次（3.11、HQ20）
    const select = screen.getByLabelText('關聯場次') as HTMLSelectElement
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(options).toContain(cash.id)
    expect(options).not.toContain(mtt.id)
    await user.selectOptions(select, cash.id)

    await user.click(screen.getByRole('button', { name: '匯入 1 手' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/hands'))
    const hands = await setup.repos.hands.list()
    expect(hands.map((h) => [h.sourceHandId, h.sessionId, h.source])).toEqual([['RC1', cash.id, 'gg']])
    expect(handsTabMemory.filters.source).toBe('gg')
  })

  it('8.2 可匯入 0 手時不顯示匯入按鈕，只顯示「返回」', async () => {
    const setup = setupHandDb()
    await setup.repos.hands.createMany([])
    const { user } = renderImport(setup)
    await upload(user, [withId('TM1')])
    await waitFor(() => expect((screen.getByTestId('import-summary')).textContent).toContain('可匯入 0 手 · 重複略過 0 手 · 無法匯入 1 手'))
    expect(screen.queryByRole('button', { name: /^匯入 \d/ })).toBeNull()
    expect(within(screen.getByRole('main')).getByRole('button', { name: '返回' })).toBeTruthy()
    expect(screen.getByText('錦標賽手牌暫不支援匯入：1 手')).toBeTruthy()
  })

  it('12.3 H4 寫入失敗整批還原：transaction 內模擬錯誤 → 顯示「匯入失敗，沒有任何手牌被寫入」，資料庫沒有任何手牌', async () => {
    const setup = setupHandDb()
    const { user } = renderImport(setup)
    await upload(user, [[withId('RC1'), withId('RC2'), withId('RC3')].join('\n\n')])
    await waitFor(() => expect((screen.getByTestId('import-summary')).textContent).toContain('可匯入 3 手'))
    let n = 0
    const failOnThird = () => {
      if (++n === 3) throw new Error('模擬寫入錯誤')
    }
    setup.db.hands.hook('creating', failOnThird)
    await user.click(screen.getByRole('button', { name: '匯入 3 手' }))
    expect((await screen.findByRole('alert')).textContent).toContain('匯入失敗，沒有任何手牌被寫入')
    setup.db.hands.hook('creating').unsubscribe(failOnThird)
    expect(await setup.db.hands.count()).toBe(0)
    // 可再按一次匯入
    await user.click(screen.getByRole('button', { name: '匯入 3 手' }))
    await waitFor(async () => expect(await setup.db.hands.count()).toBe(3))
  })

  it('8.1 錯誤：zip 解壓失敗顯示「無法解壓縮這個檔案」並可重新選擇', async () => {
    const setup = setupHandDb()
    const { user } = renderImport(setup)
    const input = screen.getByTestId('import-file-input') as HTMLInputElement
    await user.upload(input, new File(['not a zip'], 'PokerCraft.zip', { type: 'application/zip' }))
    expect((await screen.findByTestId('import-error')).textContent).toContain('無法解壓縮這個檔案')
    expect(screen.getByRole('button', { name: '重新選擇檔案' })).toBeTruthy()
  })
})

describe('12.3 H4 匯入手牌詳情（6.2）', () => {
  it('12.3 H4 匯入手牌詳情顯示 GG 與「實驗」標示、原站手牌編號；「原始文字」以等寬字型顯示 rawText', async () => {
    const setup = setupHandDb()
    const { user } = renderImport(setup)
    await upload(user, [withId('RC1')])
    await user.click(await screen.findByRole('button', { name: '匯入 1 手' }))
    await waitFor(async () => expect(await setup.db.hands.count()).toBe(1))
    const [hand] = await setup.repos.hands.list()
    const router = createMemoryRouter([{ path: '/hands/:id', element: <HandDetailPage /> }], { initialEntries: [`/hands/${hand!.id}`] })
    render(
      <AppDataContext value={setup}>
        <RouterProvider router={router} />
      </AppDataContext>,
    )
    await screen.findByTestId('detail-summary')
    expect(screen.getAllByTestId('detail-badge').map((b) => b.textContent)).toEqual(['GG', '實驗'])
    expect((screen.getByTestId('detail-source-hand-id')).textContent).toContain('原站手牌編號 RC1')
    await user.click(screen.getByRole('button', { name: '原始文字' }))
    const dialog = screen.getByRole('dialog', { name: '原始文字' })
    const pre = within(dialog).getByTestId('raw-text')
    expect(pre.textContent).toBe(withId('RC1'))
    expect(pre.className).toContain('font-mono')
    expect(pre.getAttribute('aria-label')).toBe('GG 原始手牌文字')
  })
})
