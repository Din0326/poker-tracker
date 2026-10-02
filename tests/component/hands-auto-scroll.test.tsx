// SPEC-v2-hands 5.3「自動捲動」（v2.4，12.3 P7）的元件測試：
// - HandForm：新增行動、復原上一步、確認公牌、進入結果步驟後，以「最新一筆行動」與「底池資訊」呼叫 revealLatest，
//   reducedMotion 依 prefers-reduced-motion；操作當下不在底部附近（往上回看）時不呼叫
// - lib/autoScroll：revealDelta 的位置計算、scrollWindowBy 在 reduced-motion 時以 behavior 'auto' 直接跳到位置、
//   否則 200ms（≤ 250ms）動畫，使用者觸控時停止
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as autoScroll from '../../src/lib/autoScroll'
import { OBSCURES_BOTTOM_ATTR } from '../../src/lib/viewport'
import { at79, setup79 } from './helpers/handValues'
import { renderHandForm, setupHandDb } from './helpers/renderHandForm'

vi.mock('../../src/lib/autoScroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/autoScroll')>()
  return { ...actual, revealLatest: vi.fn(), isNearPageBottom: vi.fn(() => true) }
})

const reveal = vi.mocked(autoScroll.revealLatest)
const nearBottom = vi.mocked(autoScroll.isNearPageBottom)

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion: reduce'), media: query }) as MediaQueryList,
  )
}

beforeEach(() => {
  reveal.mockClear()
  nearBottom.mockReset()
  nearBottom.mockReturnValue(true)
  mockReducedMotion(false)
})
afterEach(() => vi.restoreAllMocks())

const action = (name: string) => within(screen.getByRole('group', { name: '行動' })).getByRole('button', { name })
const lastCall = () => reveal.mock.calls[reveal.mock.calls.length - 1]!

describe('5.3 自動捲動：HandForm 呼叫 revealLatest 的時機與參數', () => {
  it('5.3 新增一筆行動後：top 為最新一筆行動（行動紀錄最後一行）、bottom 為「底池 / 目前下注額」那一行，reducedMotion false', async () => {
    const s = setupHandDb()
    await renderHandForm(s, { initial: at79(0) })
    fireEvent.click(action('棄牌'))
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1))
    const [top, bottom, options] = lastCall()
    const lines = screen.getAllByTestId('log-line')
    expect(top).toBe(lines[lines.length - 1])
    expect(top.textContent).toContain('棄牌')
    expect(bottom).toBe(screen.getByTestId('pot-line'))
    expect(options).toEqual({ reducedMotion: false })
  })

  it('5.3 prefers-reduced-motion: reduce 時以 reducedMotion true 呼叫（直接跳到位置）', async () => {
    mockReducedMotion(true)
    const s = setupHandDb()
    await renderHandForm(s, { initial: at79(0) })
    fireEvent.click(action('棄牌'))
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1))
    expect(lastCall()[2]).toEqual({ reducedMotion: true })
  })

  it('5.3 回看時不自動捲：操作當下距底部超過可視高度 1/3（isNearPageBottom 為 false）時不呼叫', async () => {
    nearBottom.mockReturnValue(false)
    const s = setupHandDb()
    await renderHandForm(s, { initial: at79(0) })
    fireEvent.click(action('棄牌'))
    // 等兩個 frame 以上，確認沒有延遲呼叫
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.getAllByTestId('log-line')).toHaveLength(1)
    expect(reveal).not.toHaveBeenCalled()
    expect(nearBottom).toHaveBeenCalledTimes(1)
  })

  it('5.3 復原上一步後：top 為復原後的最後一行，bottom 為底池那一行', async () => {
    const s = setupHandDb()
    await renderHandForm(s, { initial: at79(4) })
    fireEvent.click(screen.getByRole('button', { name: '復原上一步' }))
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1))
    const [top, bottom] = lastCall()
    const lines = screen.getAllByTestId('log-line')
    expect(lines).toHaveLength(3)
    expect(top).toBe(lines[2])
    expect(bottom).toBe(screen.getByTestId('pot-line'))
  })

  it('5.3 確認公牌（開始翻牌）後：top 為新的一條街（翻牌區塊，含公牌），bottom 為底池那一行', async () => {
    const s = setupHandDb()
    // 翻前結束、翻牌已選但尚未按「開始翻牌」
    await renderHandForm(s, { initial: at79(6, { board: ['Kh', '7d', '2c', null, null], boardSteps: [] }) })
    fireEvent.click(screen.getByRole('button', { name: '開始翻牌' }))
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1))
    const [top, bottom] = lastCall()
    expect(top).toBe(screen.getByTestId('log-flop'))
    expect(bottom).toBe(screen.getByTestId('pot-line'))
  })

  it('5.3 行動使回合結束、進入選公牌階段：bottom 為公牌牌位欄位', async () => {
    const s = setupHandDb()
    await renderHandForm(s, { initial: at79(5) })
    fireEvent.click(action('跟注 $300'))
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1))
    const [top, bottom] = lastCall()
    const lines = screen.getAllByTestId('log-line')
    expect(top).toBe(lines[lines.length - 1])
    expect(bottom.contains(screen.getByTestId('street-board-slots'))).toBe(true)
  })

  it('5.3 進入結果步驟後（其他人都棄牌）：bottom 為「底池與贏家」清單', async () => {
    const s = setupHandDb()
    // 7.9 轉牌：座位 6 加注到 15900 後輪到你（座位 4）→ 棄牌，手牌結束
    await renderHandForm(s, { initial: at79(12) })
    fireEvent.click(action('棄牌'))
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('result-step')).toBeTruthy()
    const [top, bottom] = lastCall()
    const lines = screen.getAllByTestId('log-line')
    expect(top).toBe(lines[lines.length - 1])
    expect(screen.getByTestId('result-pots').contains(bottom)).toBe(true)
    expect(bottom.tagName).toBe('UL')
  })

  it('5.3 其他操作不自動捲：開始翻前不呼叫', async () => {
    const s = setupHandDb()
    await renderHandForm(s, { initial: setup79() })
    fireEvent.click(screen.getByRole('button', { name: '開始翻前' }))
    await screen.findByTestId('street-step-preflop')
    await new Promise((r) => setTimeout(r, 100))
    expect(reveal).not.toHaveBeenCalled()
  })
})

describe('5.3 自動捲動：lib/autoScroll 的位置計算與捲動方式', () => {
  const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  let cleanupEls: Element[] = []
  afterEach(() => {
    for (const el of cleanupEls) el.remove()
    cleanupEls = []
  })

  /** 固定的標題列（bottom 60）與底部固定列（top 600）；innerHeight 800、頁面高 3000 */
  function layout() {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(window, 'visualViewport', { value: null, configurable: true })
    const header = document.createElement('header')
    header.getBoundingClientRect = () => rect(0, 60)
    const bar = document.createElement('div')
    bar.setAttribute(OBSCURES_BOTTOM_ATTR, '')
    bar.getBoundingClientRect = () => rect(600, 800)
    document.body.append(header, bar)
    cleanupEls.push(header, bar)
  }
  const el = (top: number, bottom: number) => {
    const e = document.createElement('div')
    e.getBoundingClientRect = () => rect(top, bottom)
    return e
  }

  it('5.3 revealDelta：被固定列遮住時往下捲到「區塊底部 + 12px = 固定列頂部」；已完整可見時為 0', () => {
    layout()
    expect(autoScroll.revealDelta(el(500, 520), el(560, 640))).toBe(640 - 600 + 12)
    expect(autoScroll.revealDelta(el(300, 320), el(340, 360))).toBe(0)
  })

  it('5.3 revealDelta：區塊比可見範圍高時以最新一筆行動對齊上緣（標題列下 12px）', () => {
    layout()
    // 上緣 400、下緣 1200：往下捲 400 − 60 − 12 = 328，而不是 1200 − 600 + 12
    expect(autoScroll.revealDelta(el(400, 420), el(1180, 1200))).toBe(328)
  })

  it('5.3 scrollWindowBy：reduced-motion 時以 window.scrollTo({ behavior: "auto" }) 直接跳到位置', () => {
    layout()
    Object.defineProperty(window, 'scrollY', { value: 100, configurable: true })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    autoScroll.scrollWindowBy(52, true)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 152, behavior: 'auto' })
  })

  it('5.3 scrollWindowBy：一般情況以 200ms（≤ 250ms）動畫逐步捲到目標，最後一步等於目標', async () => {
    layout()
    Object.defineProperty(window, 'scrollY', { value: 100, configurable: true })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    expect(autoScroll.AUTO_SCROLL_DURATION_MS).toBeLessThanOrEqual(250)
    const started = performance.now()
    autoScroll.scrollWindowBy(300, false)
    expect(scrollTo).not.toHaveBeenCalled()
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: 'auto' }), { timeout: 1000 })
    expect(performance.now() - started).toBeLessThan(600)
    const tops = scrollTo.mock.calls.map((c) => (c[0] as ScrollToOptions).top!)
    expect(tops.length).toBeGreaterThan(1)
    expect([...tops].sort((a, b) => a - b)).toEqual(tops)
  })

  it('5.3 scrollWindowBy：動畫期間使用者觸控即停止，不與使用者搶捲動', async () => {
    layout()
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    autoScroll.scrollWindowBy(500, false)
    window.dispatchEvent(new Event('touchstart'))
    await new Promise((r) => setTimeout(r, 300))
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 500, behavior: 'auto' })
  })

  it('5.3 isNearPageBottom：距底部 ≤ 可視高度 1/3 為 true，超過為 false', () => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, configurable: true })
    const actual = vi.importActual<typeof import('../../src/lib/autoScroll')>('../../src/lib/autoScroll')
    return actual.then(({ isNearPageBottom }) => {
      Object.defineProperty(window, 'scrollY', { value: 3000 - 900 - 300, configurable: true })
      expect(isNearPageBottom()).toBe(true)
      Object.defineProperty(window, 'scrollY', { value: 3000 - 900 - 301, configurable: true })
      expect(isNearPageBottom()).toBe(false)
    })
  })
})
