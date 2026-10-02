// SPEC-v2-hands 12.3 H2「詳情逐街呈現：7.9 範例的每一區底池、每行動文字、結果區與 6.2 範例相符（元件測試）」
import { render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { HandDetail } from '../../src/domain/hands'
import { HandDetailPage } from '../../src/features/hands/HandDetailPage'
import { AppDataContext } from '../../src/lib/appData'
import { setupHandDb, type HandSetupDb } from './helpers/renderHandForm'

const seat = (seatNo: number, stack: number, cards: string[] = []) => ({ seatNo, stack, cards, mucked: false, name: null })

/** 7.9 範例的 detail（collected 由系統計算） */
function example79(): HandDetail {
  return {
    tableSize: 6,
    buttonSeat: 4,
    heroSeat: 4,
    sb: 100,
    bb: 200,
    ante: 0,
    straddle: 0,
    seats: [seat(1, 20000), seat(2, 20000), seat(3, 20000), seat(4, 20000, ['As', 'Ks']), seat(5, 24000), seat(6, 17100, ['Kd', 'Qs'])],
    actions: [
      { street: 'preflop', seatNo: 1, type: 'fold', to: null },
      { street: 'preflop', seatNo: 2, type: 'fold', to: null },
      { street: 'preflop', seatNo: 3, type: 'fold', to: null },
      { street: 'preflop', seatNo: 4, type: 'raise', to: 500 },
      { street: 'preflop', seatNo: 5, type: 'fold', to: null },
      { street: 'preflop', seatNo: 6, type: 'call', to: null },
      { street: 'flop', seatNo: 6, type: 'check', to: null },
      { street: 'flop', seatNo: 4, type: 'bet', to: 700 },
      { street: 'flop', seatNo: 6, type: 'call', to: null },
      { street: 'turn', seatNo: 6, type: 'check', to: null },
      { street: 'turn', seatNo: 4, type: 'bet', to: 1600 },
      { street: 'turn', seatNo: 6, type: 'raise', to: 15900 },
      { street: 'turn', seatNo: 4, type: 'call', to: null },
    ],
    rake: 400,
    collected: [],
  }
}

function renderDetail(setup: HandSetupDb, id: string) {
  const router = createMemoryRouter([{ path: '/hands/:id', element: <HandDetailPage /> }], { initialEntries: [`/hands/${id}`] })
  return render(
    <AppDataContext value={setup}>
      <RouterProvider router={router} />
    </AppDataContext>,
  )
}

const texts = (els: HTMLElement[]) => els.map((el) => el.textContent)

describe('12.3 H2 手牌詳情逐街文字呈現（6.2）', () => {
  it('7.9 範例：頂部、座位、各街標題底池與每行動文字、結果區', async () => {
    const setup = setupHandDb()
    const hand = await setup.repos.hands.create({
      source: 'manual',
      gameType: 'cash',
      playedAt: '2026-09-30T21:15:00',
      detail: example79(),
      board: ['Kh', '7d', '2c', '9s', '3h'],
      tags: ['3bet'],
      note: '第一行\n第二行',
    })
    expect(hand.kind).toBe('complete')
    renderDetail(setup, hand.id)

    expect((await screen.findByTestId('detail-result')).textContent).toContain('+84.0 bb')
    expect((screen.getByTestId('detail-result-amount')).textContent).toContain('+$16,800')
    expect((screen.getByTestId('detail-summary')).textContent).toContain('現金桌 · 6-max · $100/$200 · 有效 100.0 bb')
    expect((screen.getByTestId('detail-position')).textContent).toContain('BTN')
    expect((screen.getByTestId('detail-time')).textContent).toContain('2026/09/30 21:15')
    expect((screen.getByTestId('detail-session')).textContent).toContain('獨立手牌')

    // 座位區：座位號、位置、起始籌碼（金額與 bb）、「你」標示；攤牌亮牌者顯示手牌
    const seats = screen.getAllByTestId('detail-seat')
    expect(seats).toHaveLength(6)
    expect(seats[3]!.textContent).toContain('座位 4 · BTN你')
    expect((within(seats[3]!).getByTestId('seat-stack')).textContent).toContain('$20,000 · 100.0 bb')
    expect(seats[5]!.textContent).toContain('方塊 K')
    expect(seats[0]!.textContent).not.toContain('黑桃')

    // 各街標題：街名、公牌（textContent 含符號與螢幕閱讀器用的完整名稱）、該街開始時的底池；自動發完的街加註
    const title = (street: string) => within(screen.getByTestId(`detail-street-${street}`)).getByTestId('street-title')
    expect((title('preflop')).textContent).toContain('翻前· 底池 $300')
    expect((title('flop')).textContent).toContain('翻牌K♥紅心 K7♦方塊 72♣梅花 2· 底池 $1,100')
    expect((title('turn')).textContent).toContain('轉牌9♠黑桃 9· 底池 $2,500')
    expect((title('river')).textContent).toContain('河牌3♥紅心 3· 底池 $34,300（全下，自動發牌）')

    const lines = (street: string) => texts(within(screen.getByTestId(`detail-street-${street}`)).queryAllByTestId('street-line'))
    expect(lines('preflop')).toEqual([
      'SB（5）小盲 $100',
      'BB（6）大盲 $200',
      'UTG（1）棄牌',
      'HJ（2）棄牌',
      'CO（3）棄牌',
      '你 BTN（4）加注到 $500',
      'SB（5）棄牌',
      'BB（6）跟注 $300',
    ])
    expect(lines('flop')).toEqual(['BB（6）過牌', '你 BTN（4）下注 $700', 'BB（6）跟注 $700'])
    expect(lines('turn')).toEqual(['BB（6）過牌', '你 BTN（4）下注 $1,600', 'BB（6）加注到 $15,900 全下', '你 BTN（4）跟注 $14,300'])
    expect(lines('river')).toEqual([])

    // 結果區：攤牌者手牌與中文牌型、底池與贏家、抽水、每位玩家淨輸贏
    const result = screen.getByTestId('detail-result-section')
    expect(texts(within(result).getAllByTestId('result-showdown'))).toEqual(['你A♠黑桃 AK♠黑桃 K一對 K', 'BB（6）K♦方塊 KQ♠黑桃 Q一對 K'])
    expect(texts(within(result).getAllByTestId('result-pot'))).toEqual(['主池 $34,300 → 你'])
    expect((within(result).getByTestId('result-rake')).textContent).toContain('抽水 $400')
    const nets = within(result).getAllByTestId('result-net')
    expect(texts(nets)).toEqual(['UTG（1）$0', 'HJ（2）$0', 'CO（3）$0', '你+$16,800', 'SB（5）−$100', 'BB（6）−$17,100'])
    expect((nets[3]!.lastElementChild)?.className).toContain('text-(--color-gain)')
    expect((nets[5]!.lastElementChild)?.className).toContain('text-(--color-loss)')

    // 其他區塊：標籤、備註全文（保留換行）、時間戳
    expect(texts(screen.getAllByTestId('detail-tag'))).toEqual(['3bet'])
    expect(screen.getByTestId('detail-note').textContent).toBe('第一行\n第二行')
    expect((screen.getByTestId('detail-timestamps')).textContent).toContain('建立時間')
    // 完整手牌沒有「補齊」按鈕（簡易手牌才有）；匯出（H3）尚未提供
    expect(screen.queryByText('補齊為完整手牌')).toBeNull()
    expect(screen.queryByText('繼續補齊')).toBeNull()
    expect((screen.getByRole('link', { name: '編輯' })).getAttribute('href')).toBe(`/hands/${hand.id}/edit`)
  })

  it('未完成的手牌：顯示到目前為止的內容，最後一行「（尚未完成）」與「繼續補齊」', async () => {
    const setup = setupHandDb()
    const d = example79()
    const hand = await setup.repos.hands.create({
      source: 'manual',
      gameType: 'cash',
      playedAt: '2026-09-30T21:15:00',
      detail: { ...d, rake: 0, seats: d.seats.map((s) => (s.seatNo === 6 ? { ...s, cards: [] } : s)), actions: d.actions.slice(0, 7) },
      board: ['Kh', '7d', '2c'],
    })
    expect(hand.kind).toBe('simple')
    renderDetail(setup, hand.id)
    expect((await screen.findByTestId('detail-unfinished')).textContent).toContain('（尚未完成）')
    expect((screen.getByRole('link', { name: '繼續補齊' })).getAttribute('href')).toBe(`/hands/${hand.id}/edit`)
    expect((screen.getByTestId('detail-result')).textContent).toContain('—')
    expect(screen.queryByTestId('detail-result-section')).toBeNull()
    expect(texts(within(screen.getByTestId('detail-street-flop')).getAllByTestId('street-line'))).toEqual(['BB（6）過牌'])
    expect(screen.getAllByTestId('detail-badge').map((b) => b.textContent)).toEqual(['未完成'])
  })

  it('簡易備忘手牌：依序顯示位置、手牌、公牌、大盲、結果，沒有值的欄位不顯示；有「補齊為完整手牌」', async () => {
    const setup = setupHandDb()
    const hand = await setup.repos.hands.create({
      source: 'manual',
      gameType: 'cash',
      playedAt: '2026-09-30T21:15:00',
      detail: null,
      heroCards: ['Ah', 'Kd'],
      heroPosition: 'CO',
      bb: 100,
      heroNet: -1250,
    })
    renderDetail(setup, hand.id)
    const memo = await screen.findByTestId('detail-memo')
    expect(within(memo).getAllByRole('term').map((el) => el.textContent)).toEqual(['位置', '手牌', '大盲', '結果'])
    expect((within(memo).getByTestId('memo-result')).textContent).toContain('−12.5 bb')
    expect((screen.getByTestId('detail-summary')).textContent).toMatch(/^現金桌$/)
    expect((screen.getByRole('link', { name: '補齊為完整手牌' })).getAttribute('href')).toBe(`/hands/${hand.id}/edit?complete=1`)
    expect(screen.queryByTestId('detail-tags')).toBeNull()
    expect(screen.queryByTestId('detail-note')).toBeNull()
  })
})
