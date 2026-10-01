// SPEC-v2-hands 12.3 H1：合法行動按鈕（4.3、5.3）與快捷金額按鈕（4.11、HC15）的元件測試
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Action, EngineConfig, EngineState } from '../../src/domain/hands'
import { ActionBar, type ActionChoice } from '../../src/features/hands/ActionBar'
import { replayActions } from '../../src/features/hands/handFormModel'

const seats = (stacks: number[]) => stacks.map((stack, i) => ({ seatNo: i + 1, stack }))

function stateOf(config: EngineConfig, actions: Action[]): EngineState {
  const r = replayActions(config, actions)
  if (!r.ok) throw new Error('replay failed')
  return r.state
}

function renderBar(state: EngineState, heroSeat = 99) {
  const choices: ActionChoice[] = []
  const user = userEvent.setup()
  render(<ActionBar state={state} heroSeat={heroSeat} unit="yuan" gameType="cash" onAction={(c) => choices.push(c)} />)
  const names = () => within(screen.getByRole('group', { name: '行動' })).getAllByRole('button').map((b) => b.textContent)
  return { user, choices, names }
}

const pf = (seatNo: number, type: Action['type'], to: number | null = null): Action => ({ street: 'preflop', seatNo, type, to })
const flop = (seatNo: number, type: Action['type'], to: number | null = null): Action => ({ street: 'flop', seatNo, type, to })
const turn = (seatNo: number, type: Action['type'], to: number | null = null): Action => ({ street: 'turn', seatNo, type, to })

describe('12.3 H1 合法行動按鈕（4.3）', () => {
  const config79: EngineConfig = { seats: seats([20000, 20000, 20000, 20000, 24000, 17100]), buttonSeat: 4, sb: 100, bb: 200, ante: 0, straddle: 0 }

  it('toCall > 0 時無「過牌」（翻前 UTG 面對大盲）', () => {
    const { names } = renderBar(stateOf(config79, []))
    expect(names()).toEqual(['棄牌', '跟注 $200', '加注'])
  })

  it('toCall = 0 時無「棄牌」與「跟注」（翻牌無人下注）', () => {
    const state = stateOf(config79, [pf(1, 'fold'), pf(2, 'fold'), pf(3, 'fold'), pf(4, 'raise', 500), pf(5, 'fold'), pf(6, 'call')])
    const { names } = renderBar(state, 4)
    expect(names()).toEqual(['過牌', '下注'])
  })

  it('翻前大盲的 option：其他人都只跟注時大盲可過牌或加注，無「棄牌」「跟注」', () => {
    const state = stateOf(config79, [pf(1, 'call'), pf(2, 'fold'), pf(3, 'fold'), pf(4, 'fold'), pf(5, 'call')])
    expect(renderBar(state).names()).toEqual(['過牌', '加注'])
  })

  it('HC4：A 下注 1000、B 加注到 3000、C 全下到 4000、A 跟注後輪到 B：沒有「加注」，只能棄牌或跟注', () => {
    // 3 人：座位 1 = A（小盲）、2 = B（大盲）、3 = C（按鈕，籌碼 4200）；翻前都跟注 200
    const config: EngineConfig = { seats: seats([20000, 20000, 4200]), buttonSeat: 3, sb: 100, bb: 200, ante: 0, straddle: 0 }
    const preflop = [pf(3, 'call'), pf(1, 'call'), pf(2, 'check')]
    const toA = stateOf(config, [...preflop, flop(1, 'bet', 1000), flop(2, 'raise', 3000), flop(3, 'raise', 4000)])
    // 輪到 A：面對 3000 ≥ L 2000 → 可加注
    const a = renderBar(toA)
    expect(screen.getByTestId('to-act').textContent).toContain('座位 1')
    expect(a.names()).toEqual(['棄牌', '跟注 $3,000', '加注'])
    cleanup()

    const toB = stateOf(config, [...preflop, flop(1, 'bet', 1000), flop(2, 'raise', 3000), flop(3, 'raise', 4000), flop(1, 'call')])
    const b = renderBar(toB)
    expect(screen.getByTestId('to-act').textContent).toContain('座位 2')
    expect(b.names()).toEqual(['棄牌', '跟注 $1,000'])
  })

  // HC32–HC34（TDA Rule 47 例 1）：盲注 50 / 100，5 人 A–E（座位 1–5，按鈕 5），B 225、D 300；翻前平跟進翻牌
  const configTda: EngineConfig = { seats: seats([10000, 225, 10000, 300, 10000]), buttonSeat: 5, sb: 50, bb: 100, ante: 0, straddle: 0 }
  const limp = [pf(3, 'call'), pf(4, 'call'), pf(5, 'call'), pf(1, 'call'), pf(2, 'check')]
  const tdaFlop = [flop(1, 'bet', 100), flop(2, 'raise', 125), flop(3, 'call'), flop(4, 'raise', 200), flop(5, 'call')]

  it('HC32：兩次不完整全下累計後輪回 A：有「加注」（面對 100 ≥ L 100）', () => {
    const { names } = renderBar(stateOf(configTda, [...limp, ...tdaFlop]))
    expect(screen.getByTestId('to-act').textContent).toContain('座位 1')
    expect(names()).toEqual(['棄牌', '跟注 $100', '加注'])
  })

  it('HC33（TDA 例 1-A）：A 只跟注到 200 後輪到 C：沒有「加注」（面對 75 < 100）', () => {
    const { names } = renderBar(stateOf(configTda, [...limp, ...tdaFlop, flop(1, 'call')]))
    expect(screen.getByTestId('to-act').textContent).toContain('座位 3')
    expect(names()).toEqual(['棄牌', '跟注 $75'])
  })

  it('跟注不足時顯示「跟注 $X 全下」', () => {
    // 翻前 UTG（座位 1）全下 1000 > 座位 2（籌碼 600）
    const config: EngineConfig = { seats: seats([5000, 600, 5000, 5000]), buttonSeat: 4, sb: 100, bb: 200, ante: 0, straddle: 0 }
    // 4 人：按鈕 4 → 座位 1 SB、2 BB、3 CO 先行動
    const state = stateOf(config, [pf(3, 'raise', 1000), pf(4, 'fold'), pf(1, 'fold')])
    expect(renderBar(state).names()).toEqual(['棄牌', '跟注 $400 全下'])
  })

  it('按下行動按鈕送出對應的行動', async () => {
    const { user, choices } = renderBar(stateOf(config79, []))
    await user.click(screen.getByRole('button', { name: '跟注 $200' }))
    await user.click(screen.getByRole('button', { name: '棄牌' }))
    expect(choices).toEqual([
      { type: 'call', to: null },
      { type: 'fold', to: null },
    ])
  })
})

describe('12.3 H1 快捷金額按鈕（4.11、HC15：元單位，盲注 25 / 50）', () => {
  async function quickTexts(state: EngineState, kind: '下注' | '加注') {
    const { user } = renderBar(state)
    await user.click(screen.getByRole('button', { name: kind }))
    const sheet = screen.getByRole('dialog')
    return { user, sheet, texts: within(within(sheet).getByTestId('quick-sizes')).getAllByRole('button').map((b) => b.textContent) }
  }

  it('翻牌底池 550、無人下注 → 最小 $50、½ 池 $275、⅔ 池 $367、底池 $550', async () => {
    // 2 人：按鈕（小盲）加注到 275、大盲跟注 → 翻牌底池 550，大盲先行動
    const config: EngineConfig = { seats: seats([100000, 100000]), buttonSeat: 1, sb: 25, bb: 50, ante: 0, straddle: 0 }
    const state = stateOf(config, [pf(1, 'raise', 275), pf(2, 'call')])
    const { texts } = await quickTexts(state, '下注')
    expect(texts).toEqual(['最小 $50', '½ 池 $275', '⅔ 池 $367', '底池 $550', '全下 $99,725'])
  })

  it('翻牌底池 275、無人下注 → 最小 $50、½ 池 $138、⅔ 池 $183、底池 $275', async () => {
    // 3 人：按鈕加注到 125、小盲棄牌（25）、大盲跟注 → 底池 275
    const config: EngineConfig = { seats: seats([100000, 100000, 100000]), buttonSeat: 1, sb: 25, bb: 50, ante: 0, straddle: 0 }
    const state = stateOf(config, [pf(1, 'raise', 125), pf(2, 'fold'), pf(3, 'call')])
    const { texts } = await quickTexts(state, '下注')
    expect(texts).toEqual(['最小 $50', '½ 池 $138', '⅔ 池 $183', '底池 $275', '全下 $99,875'])
  })

  it('轉牌 P 2,050、B 800、L 800、C 800 → 最小 $1,600、½ 池 $2,225、⅔ 池 $2,700、底池 $3,650', async () => {
    // 2 人：翻前加注到 625 跟注（底池 1250）、翻牌都過牌、轉牌大盲下注 800 後輪到按鈕
    const config: EngineConfig = { seats: seats([100000, 100000]), buttonSeat: 1, sb: 25, bb: 50, ante: 0, straddle: 0 }
    const state = stateOf(config, [pf(1, 'raise', 625), pf(2, 'call'), flop(2, 'check'), flop(1, 'check'), turn(2, 'bet', 800)])
    const { texts } = await quickTexts(state, '加注')
    expect(texts).toEqual(['最小 $1,600', '½ 池 $2,225', '⅔ 池 $2,700', '底池 $3,650', '全下 $99,375'])
  })

  it('夾限後等於全下時按鈕文字改為「全下 $X」；點快捷按鈕填入「下注到」', async () => {
    // 2 人、盲注 25 / 50：翻牌底池 550，大盲只剩 300：½ 池 275 不變；⅔ 池 367、底池 550 ≥ 全下金額 → 夾限為全下 300
    const config: EngineConfig = { seats: seats([100000, 575]), buttonSeat: 1, sb: 25, bb: 50, ante: 0, straddle: 0 }
    const state = stateOf(config, [pf(1, 'raise', 275), pf(2, 'call')])
    const { user, sheet, texts } = await quickTexts(state, '下注')
    expect(texts).toEqual(['最小 $50', '½ 池 $275', '全下 $300', '全下 $300', '全下 $300'])
    await user.click(within(sheet).getByTestId('quick-half'))
    expect((within(sheet).getByLabelText('下注到') as HTMLInputElement).value).toBe('275')
  })
})
