// 5.4 驗證規則：每條規則一個元件測試（DoD 10.3 P2）
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderRecordForm, setupDb } from './helpers/renderRecordForm'

const saveButton = () => screen.getByRole('button', { name: '儲存' })

/** 欄位標示為錯誤，且 aria-describedby 指向含該訊息的元素 */
function expectFieldError(el: HTMLElement, message: string) {
  expect(el.getAttribute('aria-invalid')).toBe('true')
  const ids = el.getAttribute('aria-describedby')?.split(' ') ?? []
  expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(message)
}

function expectNoFieldError(el: HTMLElement) {
  expect(el.getAttribute('aria-invalid')).toBeNull()
}

const buyIn = (n = 1) => screen.getByRole('textbox', { name: `第 ${n} 次 買入（含服務費）` })
const fee = (n = 1) => screen.getByRole('textbox', { name: `第 ${n} 次 服務費` })
const hours = () => screen.getByRole('combobox', { name: '時長（小時）' })
const minutes = () => screen.getByRole('combobox', { name: '時長（分鐘）' })

async function typeInto(user: UserEvent, el: HTMLElement, text: string) {
  await user.clear(el)
  await user.type(el, text)
}

describe('5.4 驗證規則', () => {
  it('5.4 現金桌未選盲注 → 請選擇盲注級別', async () => {
    const s = await setupDb({ stakes: [[50, 100]] })
    const { user } = await renderRecordForm(s)
    await user.click(saveButton())
    const stake = screen.getByLabelText('盲注級別')
    expectFieldError(stake, '請選擇盲注級別')
    // 失敗時 focus 第一個錯誤欄位（現金桌第一欄為盲注）
    expect(document.activeElement).toBe(stake)
    // 已顯示錯誤的欄位修改後即時重驗
    await user.selectOptions(stake, '50/100')
    await waitFor(() => expectNoFieldError(screen.getByLabelText('盲注級別')))
  })

  it('5.4 買入空白或為 0 → 請填寫買入金額', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    await user.click(saveButton())
    expectFieldError(buyIn(), '請填寫買入金額')
    expect(document.activeElement).toBe(buyIn())
    await typeInto(user, buyIn(), '0')
    await waitFor(() => expectFieldError(buyIn(), '請填寫買入金額'))
    await typeInto(user, buyIn(), '3400')
    await waitFor(() => expectNoFieldError(buyIn()))
  })

  it('5.4 服務費 > 該筆買入 → 服務費不可大於買入', async () => {
    const s = await setupDb({ lastType: 'timed_mtt' })
    const { user } = await renderRecordForm(s)
    await typeInto(user, buyIn(), '1000')
    await typeInto(user, fee(), '1001')
    await user.click(saveButton())
    expectFieldError(fee(), '服務費不可大於買入')
    // C6：fee = amount 為合法邊界
    await typeInto(user, fee(), '1000')
    await waitFor(() => expectNoFieldError(fee()))
  })

  it('5.4 到手金額空白 → 請填寫到手金額，沒拿回請填 0', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    await user.click(saveButton())
    const cashOut = screen.getByLabelText('到手金額')
    expectFieldError(cashOut, '請填寫到手金額，沒拿回請填 0')
    await typeInto(user, cashOut, '0')
    await waitFor(() => expectNoFieldError(screen.getByLabelText('到手金額')))
  })

  it('5.4 任一金額超過 99,999,999 → 金額超出上限', async () => {
    const s = await setupDb({ lastType: 'timed_mtt' })
    const { user } = await renderRecordForm(s)
    await typeInto(user, buyIn(), '100000000')
    await typeInto(user, fee(), '100000000')
    await typeInto(user, screen.getByLabelText('到手金額'), '100000000')
    await user.click(saveButton())
    expectFieldError(buyIn(), '金額超出上限')
    expectFieldError(fee(), '金額超出上限')
    expectFieldError(screen.getByLabelText('到手金額'), '金額超出上限')
    // 上限值本身合法
    await typeInto(user, buyIn(), '99999999')
    await waitFor(() => expectNoFieldError(buyIn()))
  })

  it('5.4 時長為 0 小時 0 分，或超過 72 小時 → 請選擇 5 分鐘到 72 小時之間的時長', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    const message = '請選擇 5 分鐘到 72 小時之間的時長'
    // 未選（—）也不可儲存（必填）
    await user.click(saveButton())
    expectFieldError(hours(), message)
    expectFieldError(minutes(), message)
    await user.selectOptions(hours(), '0 時')
    await user.selectOptions(minutes(), '0 分')
    await waitFor(() => expectFieldError(hours(), message))
    await user.selectOptions(hours(), '72 時')
    await user.selectOptions(minutes(), '5 分')
    await waitFor(() => expectFieldError(hours(), message))
    await user.selectOptions(minutes(), '0 分')
    await waitFor(() => expectNoFieldError(hours()))
    expectNoFieldError(minutes())
  })

  it('5.4 開始時間晚於現在（依小時比較） → 開始時間不可是未來', async () => {
    // 現在為 2026-09-28 20:30
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    const date = screen.getByLabelText('開始日期')
    const hour = screen.getByRole('combobox', { name: '開始小時' })
    expect((date as HTMLInputElement).value).toBe('2026-09-28')
    expect((hour as HTMLSelectElement).value).toBe('20')
    expect(date.getAttribute('max')).toBe('2026-09-28')
    expect(screen.getByTestId('start-at-display').textContent).toBe('2026/09/28 20 時')
    await user.selectOptions(hour, '21 時')
    await user.click(saveButton())
    expectFieldError(hour, '開始時間不可是未來')
    expectFieldError(date, '開始時間不可是未來')
    // 同一小時（20 時）不算未來
    await user.selectOptions(hour, '20 時')
    await waitFor(() => expectNoFieldError(screen.getByLabelText('開始日期')))
    // 明天任何小時都算未來
    fireEvent.change(screen.getByLabelText('開始日期'), { target: { value: '2026-09-29' } })
    await waitFor(() => expectFieldError(screen.getByLabelText('開始日期'), '開始時間不可是未來'))
  })

  it('5.4 參賽人數 < 2 → 參賽人數至少 2 人', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    const fieldSize = screen.getByLabelText('參賽人數')
    await typeInto(user, fieldSize, '1')
    await user.click(saveButton())
    expectFieldError(fieldSize, '參賽人數至少 2 人')
    await typeInto(user, fieldSize, '2')
    await waitFor(() => expectNoFieldError(screen.getByLabelText('參賽人數')))
  })

  it('5.4 填了名次未填參賽人數 → 填名次時請一併填寫參賽人數', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    await typeInto(user, screen.getByLabelText('名次'), '3')
    await user.click(saveButton())
    expectFieldError(screen.getByLabelText('名次'), '填名次時請一併填寫參賽人數')
    // 只填參賽人數、不填名次是允許的；填上參賽人數後名次錯誤即時消失
    await typeInto(user, screen.getByLabelText('參賽人數'), '100')
    await waitFor(() => expectNoFieldError(screen.getByLabelText('名次')))
  })

  it('5.4 名次 > 參賽人數或名次 < 1 → 名次需介於 1 到參賽人數之間', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    await typeInto(user, screen.getByLabelText('參賽人數'), '100')
    await typeInto(user, screen.getByLabelText('名次'), '101')
    await user.click(saveButton())
    const message = '名次需介於 1 到參賽人數之間'
    expectFieldError(screen.getByLabelText('名次'), message)
    await typeInto(user, screen.getByLabelText('名次'), '0')
    await waitFor(() => expectFieldError(screen.getByLabelText('名次'), message))
    await typeInto(user, screen.getByLabelText('名次'), '100')
    await waitFor(() => expectNoFieldError(screen.getByLabelText('名次')))
  })

  it('5.4 名稱超過 50 字、備註超過 500 字 → 字數超過上限（附字數計數，以 code point 計）', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    const name = screen.getByLabelText('名稱')
    const note = screen.getByLabelText('備註')
    // emoji 算 1 字：50 個 emoji 合法
    await user.click(name)
    await user.paste('😀'.repeat(50))
    expect(screen.getByText('50/50')).toBeTruthy()
    await user.click(note)
    await user.paste('a'.repeat(501))
    expect(screen.getByText('501/500')).toBeTruthy()
    await user.click(saveButton())
    expectNoFieldError(screen.getByLabelText('名稱'))
    expectFieldError(screen.getByLabelText('備註'), '字數超過上限')
    await user.click(screen.getByLabelText('名稱'))
    await user.paste('😀')
    expect(screen.getByText('51/50')).toBeTruthy()
    await waitFor(() => expectFieldError(screen.getByLabelText('名稱'), '字數超過上限'))
    // 計數也以 aria-describedby 關聯
    expect(screen.getByLabelText('名稱').getAttribute('aria-describedby')).toContain('rf-name-count')
  })
})

describe('驗證通過時寫入 DB', () => {
  it('現金桌全部填妥後儲存成功並顯示盈利提示', async () => {
    const s = await setupDb({ stakes: [[50, 100]] })
    const { user } = await renderRecordForm(s)
    await user.selectOptions(screen.getByLabelText('盲注級別'), '50/100')
    await typeInto(user, screen.getByLabelText('買入（含服務費）'), '10000')
    await typeInto(user, screen.getByLabelText('服務費'), '300')
    await typeInto(user, screen.getByLabelText('到手金額'), '12400')
    await user.selectOptions(hours(), '3 時')
    await user.selectOptions(minutes(), '30 分')
    expect(screen.getByTestId('record-preview').textContent).toBe('買入 $10,000 · 服務費 $300 · 盈利 +$2,400')
    await user.click(saveButton())
    await screen.findByText('已儲存，盈利 +$2,400')
    const [session] = await s.repos.sessions.list()
    expect(session).toMatchObject({
      type: 'cash',
      buyIns: [{ amount: 10000, fee: 300 }],
      cashOut: 12400,
      durationMin: 210,
      startAt: '2026-09-28T20:00',
      venueId: null,
      fieldSize: null,
      finishPlace: null,
      name: null,
      note: null,
    })
  })
})
