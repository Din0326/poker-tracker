// SPEC-v2-hands 12.3 H1：5.5 每條驗證規則各有一個元件測試；HC31 的輸入部分（金額輸入框只接受整數）
import { cleanup, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { HandFormValues } from '../../src/features/hands/handFormModel'
import { ACTIONS_79, BOARD_79, at79, result79, seatRows, setup79 } from './helpers/handValues'
import { entryValues, renderHandForm, setupHandDb } from './helpers/renderHandForm'

const save = () => screen.getByRole('button', { name: '儲存' })
const startPreflop = () => screen.getByRole('button', { name: '開始翻前' })

/** 簡易模式：以初始值渲染後按「儲存」，回傳畫面上的錯誤訊息是否出現 */
async function simpleSave(values: Partial<HandFormValues>, message: string) {
  cleanup()
  const s = setupHandDb()
  const { user } = await renderHandForm(s, { initial: entryValues(values) })
  await user.click(save())
  expect(await screen.findByText(message)).toBeTruthy()
  // 儲存失敗時不寫入
  expect(await s.repos.hands.list()).toEqual([])
  return { s, user }
}

async function setupStart(values: HandFormValues, message: string) {
  cleanup()
  const s = setupHandDb()
  const { user } = await renderHandForm(s, { initial: values })
  await user.click(startPreflop())
  expect(await screen.findByText(message)).toBeTruthy()
  // 未通過時停留在步驟 1
  expect(screen.getByTestId('setup-step')).toBeTruthy()
}

const filled = { heroCards: ['As', 'Kd'] }

describe('5.5 共通（簡易、完整）', () => {
  it('時間晚於現在（依分鐘比較）→ 時間不可是未來', async () => {
    await simpleSave({ ...filled, hour: '12', minute: '5' }, '時間不可是未來')
  })

  it('現金桌手牌關聯錦標賽場次 → 現金桌手牌只能關聯現金桌場次；錦標賽手牌關聯現金桌場次 → 錦標賽手牌只能關聯錦標賽場次', async () => {
    const s = setupHandDb()
    const stake = await s.repos.stakes.create(50, 100)
    const cash = await s.repos.sessions.create({ type: 'cash', startAt: '2026-09-27T20:00', durationMin: 60, buyIns: [{ amount: 10000, fee: 0 }], cashOut: 0, stakeId: stake.id })
    const mtt = await s.repos.sessions.create({ type: 'mtt', startAt: '2026-09-26T20:00', durationMin: 60, buyIns: [{ amount: 3000, fee: 0 }], cashOut: 0 })
    const a = await renderHandForm(s, { initial: entryValues({ ...filled, sessionId: mtt.id, gameType: 'cash' }) })
    await a.user.click(save())
    expect(await screen.findByText('現金桌手牌只能關聯現金桌場次')).toBeTruthy()
    a.unmount()
    const b = await renderHandForm(s, { initial: entryValues({ ...filled, sessionId: cash.id, gameType: 'tournament' }) })
    await b.user.click(save())
    expect(await screen.findByText('錦標賽手牌只能關聯錦標賽場次')).toBeTruthy()
  })

  it('手牌只選 1 張 → 手牌需選 2 張或不選', async () => {
    await simpleSave({ heroCards: ['As', null] }, '手牌需選 2 張或不選')
  })

  it('公牌張數為 1 或 2 → 公牌需為 0、3、4 或 5 張', async () => {
    await simpleSave({ board: ['Kh', null, null, null, null] }, '公牌需為 0、3、4 或 5 張')
    await simpleSave({ board: ['Kh', '7d', null, null, null] }, '公牌需為 0、3、4 或 5 張')
  })

  it('同一張牌出現兩次（草稿還原等）→ 同一張牌不可重複出現', async () => {
    await simpleSave({ heroCards: ['As', 'Kd'], board: ['As', '7d', '2c', null, null] }, '同一張牌不可重複出現')
  })

  it('HC31 現金桌金額有小數（12.5）→ 金額必須是整數（以元為單位）', async () => {
    await simpleSave({ ...filled, bb: '12.5' }, '金額必須是整數（以元為單位）')
  })

  it('HC31 錦標賽金額有小數（12.5）→ 錦標賽籌碼必須是整數', async () => {
    await simpleSave({ ...filled, gameType: 'tournament', bb: '12.5' }, '錦標賽籌碼必須是整數')
  })

  it('任一金額超過 99,999,999 → 金額超出上限', async () => {
    await simpleSave({ ...filled, result: 'win', resultAmount: '100000000' }, '金額超出上限')
  })

  it('標籤去除前後空白後超過 20 字 → 標籤最多 20 字（不加入）', async () => {
    const s = setupHandDb()
    const { user } = await renderHandForm(s)
    await user.type(screen.getByLabelText('新增標籤'), `  ${'a'.repeat(21)}  `)
    await user.click(screen.getByRole('button', { name: '新增' }))
    expect(screen.getByText('標籤最多 20 字')).toBeTruthy()
    expect(screen.queryAllByTestId('tag-chip')).toHaveLength(0)
    // 20 字可以加入（儲存去除前後空白後的值）
    await user.clear(screen.getByLabelText('新增標籤'))
    await user.type(screen.getByLabelText('新增標籤'), ` ${'b'.repeat(20)} {Enter}`)
    expect(screen.getAllByTestId('tag-chip').map((c) => c.textContent)).toEqual(['b'.repeat(20)])
  })

  it('同一手標籤重複（不分大小寫）→ 標籤重複', async () => {
    const s = setupHandDb()
    const { user } = await renderHandForm(s)
    await user.type(screen.getByLabelText('新增標籤'), '3bet{Enter}')
    await user.type(screen.getByLabelText('新增標籤'), ' 3BET {Enter}')
    expect(screen.getByText('標籤重複')).toBeTruthy()
    expect(screen.getAllByTestId('tag-chip')).toHaveLength(1)
  })

  it('標籤超過 10 個 → 最多 10 個標籤', async () => {
    const s = setupHandDb()
    const tags = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const { user } = await renderHandForm(s, { initial: entryValues({ tags }) })
    await user.type(screen.getByLabelText('新增標籤'), 'eleven{Enter}')
    expect(screen.getByText('最多 10 個標籤')).toBeTruthy()
    expect(screen.getAllByTestId('tag-chip')).toHaveLength(10)
  })

  it('草稿還原的標籤不合法時，儲存仍會檢查（標籤重複）', async () => {
    await simpleSave({ ...filled, tags: ['abc', 'ABC'] }, '標籤重複')
  })

  it('備註超過 1,000 字 → 字數超過上限（輸入框附字數計數）', async () => {
    await simpleSave({ ...filled, note: 'x'.repeat(1001) }, '字數超過上限')
    expect(screen.getByText('1001/1000')).toBeTruthy()
  })
})

describe('5.5 簡易模式', () => {
  it('手牌、公牌、結果、備註、標籤都沒填 → 請至少填寫手牌、公牌、結果、備註或標籤其中一項', async () => {
    await simpleSave({}, '請至少填寫手牌、公牌、結果、備註或標籤其中一項')
  })

  it('大盲填 0 → 大盲需大於 0', async () => {
    await simpleSave({ ...filled, bb: '0' }, '大盲需大於 0')
  })

  it('已顯示錯誤的欄位修改後即時重新驗證', async () => {
    const { user } = await simpleSave({ ...filled, bb: '0' }, '大盲需大於 0')
    const input = screen.getByLabelText('大盲')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain('hand-bb-error')
    await user.type(input, '{Backspace}200')
    expect(screen.queryByText('大盲需大於 0')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })
})

describe('5.5 完整模式：牌局設定（按「開始翻前」）', () => {
  it('有玩家的座位少於 2 個 → 至少需要 2 位玩家', async () => {
    await setupStart(setup79({ tableSize: 2, seats: seatRows({}, [2]), buttonSeat: 1, heroSeat: 1 }), '至少需要 2 位玩家')
  })

  it('按鈕在空位 → 按鈕必須在有玩家的座位', async () => {
    await setupStart(setup79({ seats: seatRows({ 5: '24000', 6: '17100' }, [4]), heroSeat: 1 }), '按鈕必須在有玩家的座位')
  })

  it('「你」在空位或未選 → 請選擇你的座位', async () => {
    await setupStart(setup79({ heroSeat: null }), '請選擇你的座位')
    await setupStart(setup79({ seats: seatRows({}, [3]), heroSeat: 3 }), '請選擇你的座位')
  })

  it('小盲或大盲空白或為 0 → 請填寫盲注', async () => {
    await setupStart(setup79({ sb: '' }), '請填寫盲注')
    await setupStart(setup79({ setupBb: '0' }), '請填寫盲注')
  })

  it('大盲小於小盲 → 大盲不可小於小盲', async () => {
    await setupStart(setup79({ sb: '300' }), '大盲不可小於小盲')
  })

  it('開啟 straddle 但玩家少於 3 位 → 3 人以上才能 straddle', async () => {
    await setupStart(setup79({ tableSize: 2, buttonSeat: 1, heroSeat: 1, straddle: true }), '3 人以上才能 straddle')
  })

  it('某座位籌碼空白或為 0 → 請填寫籌碼', async () => {
    await setupStart(setup79({ seats: seatRows({ 2: '' }) }), '請填寫籌碼')
    await setupStart(setup79({ seats: seatRows({ 2: '0' }) }), '請填寫籌碼')
  })

  it('某座位籌碼 ≤ 該座位的前注 + 盲注（或 straddle）→ 籌碼需大於要放的盲注與前注', async () => {
    // 按鈕座位 4 → 座位 6 為大盲 200；ante 50 時需 > 250
    await setupStart(setup79({ ante: '50', seats: seatRows({ 6: '250' }) }), '籌碼需大於要放的盲注與前注')
    // straddle 玩家（座位 1，UTG）放 400
    await setupStart(setup79({ straddle: true, seats: seatRows({ 1: '400' }) }), '籌碼需大於要放的盲注與前注')
  })

  it('你的手牌未選滿 2 張 → 請選擇你的 2 張手牌', async () => {
    await setupStart(setup79({ heroCards: ['As', null] }), '請選擇你的 2 張手牌')
  })

  it('HC31 盲注有小數 → 金額必須是整數（以元為單位）／錦標賽籌碼必須是整數', async () => {
    await setupStart(setup79({ sb: '12.5' }), '金額必須是整數（以元為單位）')
    await setupStart(setup79({ gameType: 'tournament', sb: '12.5' }), '錦標賽籌碼必須是整數')
  })

  it('驗證失敗時欄位 aria-invalid、aria-describedby 關聯錯誤訊息', async () => {
    await setupStart(setup79({ sb: '300' }), '大盲不可小於小盲')
    const bb = screen.getByLabelText('大盲')
    expect(bb.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(bb.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toBe('大盲不可小於小盲')
  })
})

describe('5.5 完整模式：行動與公牌', () => {
  /** 開啟下注 / 加注 sheet，輸入金額後按「確定」 */
  async function submitBet(values: HandFormValues, kind: '下注' | '加注', amount: string, message: string) {
    const s = setupHandDb()
    const { user } = await renderHandForm(s, { initial: values })
    await user.click(within(screen.getByTestId('action-bar')).getByRole('button', { name: kind }))
    const sheet = screen.getByRole('dialog')
    if (amount !== '') await user.type(within(sheet).getByLabelText(kind === '下注' ? '下注到' : '加注到'), amount)
    await user.click(within(sheet).getByRole('button', { name: '確定' }))
    expect(within(sheet).getByText(message)).toBeTruthy()
    return { user, sheet }
  }

  it('下注金額 < 大盲且不是全下 → 最少要下注 $200', async () => {
    // 翻牌：BB 先行動，無人下注
    await submitBet(at79(6, { boardSteps: [3], board: [...BOARD_79.slice(0, 3), null, null] }), '下注', '150', '最少要下注 $200')
  })

  it('加注到 < B + L 且不是全下 → 最少要加注到 $400（HC3 同理）', async () => {
    // 翻前 3 人棄牌後輪到 Hero：B 200、L 200
    await submitBet(at79(3), '加注', '300', '最少要加注到 $400')
  })

  it('金額超過可用籌碼（A + S）→ 金額超過可用籌碼 $20,000', async () => {
    await submitBet(at79(3), '加注', '20001', '金額超過可用籌碼 $20,000')
  })

  it('下注 / 加注金額空白 → 請填寫金額；HC31 小數 → 金額必須是整數（以元為單位）', async () => {
    const { user, sheet } = await submitBet(at79(3), '加注', '', '請填寫金額')
    await user.type(within(sheet).getByLabelText('加注到'), '500.5')
    await user.click(within(sheet).getByRole('button', { name: '確定' }))
    expect(within(sheet).getByText('金額必須是整數（以元為單位）')).toBeTruthy()
  })

  it('全下金額即使不足最小加注仍合法（不顯示錯誤，送出行動）', async () => {
    // 翻前 3 人棄牌後 Hero 只有 300：全下到 300 < B + L 400 仍可送出
    const s = setupHandDb()
    const { user } = await renderHandForm(s, { initial: at79(3, { seats: seatRows({ 4: '300', 5: '24000', 6: '17100' }) }) })
    await user.click(within(screen.getByTestId('action-bar')).getByRole('button', { name: '加注' }))
    await user.type(within(screen.getByRole('dialog')).getByLabelText('加注到'), '300')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確定' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('to-act').textContent).toContain('SB（座位 5）')
  })

  it('公牌未選滿就要開始該街行動 → 請選擇翻牌 3 張 / 請選擇轉牌 / 請選擇河牌', async () => {
    const s = setupHandDb()
    const flop = await renderHandForm(s, { initial: at79(6, { boardSteps: [], board: ['Kh', '7d', null, null, null] }) })
    await flop.user.click(screen.getByRole('button', { name: '開始翻牌' }))
    expect(screen.getByText('請選擇翻牌 3 張')).toBeTruthy()
    flop.unmount()
    const turn = await renderHandForm(s, { initial: at79(9, { boardSteps: [3], board: ['Kh', '7d', '2c', null, null] }) })
    await turn.user.click(screen.getByRole('button', { name: '開始轉牌' }))
    expect(screen.getByText('請選擇轉牌')).toBeTruthy()
    turn.unmount()
    // 河牌（自動發完的剩餘公牌）
    const river = await renderHandForm(s, { initial: setup79({ setupDone: true, actions: ACTIONS_79, boardSteps: [3, 4], board: [...BOARD_79.slice(0, 4), null] }) })
    await river.user.click(screen.getByRole('button', { name: '確認公牌' }))
    expect(screen.getByText('請選擇河牌')).toBeTruthy()
  })
})

describe('5.5 完整模式：結果（按「儲存」）', () => {
  it('攤牌對手沒選手牌也沒勾蓋牌 → 請選擇這位玩家的手牌，或標記為蓋牌', async () => {
    const s = setupHandDb()
    const { user } = await renderHandForm(s, { initial: result79() })
    await user.click(save())
    expect(screen.getByText('請選擇這位玩家的手牌，或標記為蓋牌')).toBeTruthy()
    expect(await s.repos.hands.list()).toEqual([])
  })

  it('某個池的資格者都沒有手牌 → 這個底池至少需要一位玩家亮牌才能判定輸贏', async () => {
    // 3 人：Hero（座位 1，按鈕）全下 1000；座位 2 全下 3000、座位 3 跟注全下 → 邊池只有座位 2、3 有資格，兩人都蓋牌
    const values = setup79({
      tableSize: 3,
      seats: seatRows({ 1: '1000', 2: '3000', 3: '3000' }),
      buttonSeat: 1,
      heroSeat: 1,
      setupDone: true,
      actions: [
        { street: 'preflop', seatNo: 1, type: 'raise', to: 1000 },
        { street: 'preflop', seatNo: 2, type: 'raise', to: 3000 },
        { street: 'preflop', seatNo: 3, type: 'call', to: null },
      ],
      boardSteps: [5],
      board: [...BOARD_79],
      showdown: { '2': { cards: [null, null], mucked: true }, '3': { cards: [null, null], mucked: true } },
    })
    const s = setupHandDb()
    const { user } = await renderHandForm(s, { initial: values })
    await user.click(save())
    expect(screen.getByText('這個底池至少需要一位玩家亮牌才能判定輸贏')).toBeTruthy()
  })

  it('抽水大於底池 → 抽水不可大於底池', async () => {
    const s = setupHandDb()
    const { user } = await renderHandForm(s, {
      initial: result79({ showdown: { '6': { cards: ['Kd', 'Qs'], mucked: false } }, rake: '34301' }),
    })
    await user.click(save())
    expect(screen.getByText('抽水不可大於底池')).toBeTruthy()
  })
})
