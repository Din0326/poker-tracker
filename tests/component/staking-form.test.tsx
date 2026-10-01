// 5.2–5.7 賣股份區塊（v1.2）元件測試：收合 / 展開、上限、驗證規則、預覽、名稱建議、儲存、切換類型、編輯模式
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Backer } from '../../src/domain'
import { renderRecordForm, setupDb, type Setup } from './helpers/renderRecordForm'

const section = () => screen.getByTestId('staking-section')
const rows = () => screen.queryAllByTestId('backer-row')
const rowAt = (i: number) => within(rows()[i]!)
const saveButton = () => screen.getByRole('button', { name: '儲存' })
const addFirst = () => screen.getByRole('button', { name: '＋ 賣股份' })
const addMore = () => screen.getByRole('button', { name: '＋ 新增出資者' })
const nameInput = (i: number) => rowAt(i).getByLabelText('出資者名稱') as HTMLInputElement
const shareInput = (i: number) => rowAt(i).getByLabelText('比例') as HTMLInputElement
const markupInput = (i: number) => rowAt(i).getByLabelText('加價倍數') as HTMLInputElement
const totalError = () => document.getElementById('rf-backers-total-error')

function expectFieldError(el: HTMLElement, message: string) {
  expect(el.getAttribute('aria-invalid')).toBe('true')
  const ids = el.getAttribute('aria-describedby')?.split(' ') ?? []
  expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(message)
}

async function typeInto(user: UserEvent, el: HTMLElement, text: string) {
  await user.clear(el)
  if (text !== '') await user.type(el, text)
}

/** MTT 必填欄位：買入、到手、時長（C13：買入 10,000、到手 50,000） */
async function fillMtt(user: UserEvent, buyIn = '10000', cashOut = '50000') {
  await typeInto(user, screen.getByRole('textbox', { name: '第 1 次 買入（含服務費）' }), buyIn)
  await typeInto(user, screen.getByLabelText('到手金額'), cashOut)
  await user.selectOptions(screen.getByRole('combobox', { name: '時長（小時）' }), '2 時')
  await user.selectOptions(screen.getByRole('combobox', { name: '時長（分鐘）' }), '0 分')
}

/** 新增一列並填入名稱、比例、倍數 */
async function addBacker(user: UserEvent, name: string, share: string, markup?: string) {
  await user.click(rows().length === 0 ? addFirst() : addMore())
  const i = rows().length - 1
  if (name !== '') await user.type(nameInput(i), name)
  if (share !== '') await user.type(shareInput(i), share)
  if (markup !== undefined) await typeInto(user, markupInput(i), markup)
}

async function renderMtt(setup?: Setup) {
  const s = setup ?? (await setupDb({ lastType: 'mtt' }))
  const r = await renderRecordForm(s)
  return { s, ...r }
}

describe('5.3 賣股份區塊：收合 / 展開 / 上限', () => {
  it('預設收合：只有標題「賣股份」、「＋ 賣股份」與「沒有賣股可略過」；新增第 1 列後展開，按鈕改為「＋ 新增出資者」；刪到 0 列回到收合', async () => {
    const { user } = await renderMtt()
    expect(section().getAttribute('data-expanded')).toBe('false')
    expect(within(section()).getByRole('heading', { name: '賣股份' })).toBeTruthy()
    expect(within(section()).getByText('沒有賣股可略過')).toBeTruthy()
    expect(rows()).toHaveLength(0)

    await user.click(addFirst())
    expect(section().getAttribute('data-expanded')).toBe('true')
    expect(rows()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '＋ 賣股份' })).toBeNull()
    expect(addMore()).toBeTruthy()
    // 新增的列：名稱與比例空白、倍數預填 1.0；名稱 placeholder「出資者名稱」
    expect(nameInput(0).value).toBe('')
    expect(nameInput(0).placeholder).toBe('出資者名稱')
    expect(shareInput(0).value).toBe('')
    expect(markupInput(0).value).toBe('1.0')
    expect(shareInput(0).getAttribute('inputmode')).toBe('decimal')
    expect(markupInput(0).getAttribute('inputmode')).toBe('decimal')

    await user.click(addMore())
    expect(rows()).toHaveLength(2)
    // 每一列（含第 1 列）都有刪除鈕
    expect(screen.getAllByRole('button', { name: '刪除出資者' })).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: '刪除出資者' })[0]!)
    await user.click(screen.getByRole('button', { name: '刪除出資者' }))
    expect(rows()).toHaveLength(0)
    expect(section().getAttribute('data-expanded')).toBe('false')
  })

  it('P5.5 第 11 位出資者無法新增（達 10 列後「＋ 新增出資者」停用）', async () => {
    const { user } = await renderMtt()
    await user.click(addFirst())
    for (let i = 1; i < 10; i++) await user.click(addMore())
    expect(rows()).toHaveLength(10)
    expect((addMore() as HTMLButtonElement).disabled).toBe(true)
    await user.click(addMore())
    expect(rows()).toHaveLength(10)
  })

  it('比例、倍數輸入只接受數字與一個小數點：貼上時移除 %、×、x、空白', async () => {
    const { user } = await renderMtt()
    await user.click(addFirst())
    shareInput(0).focus()
    await user.paste(' 12.5 %')
    expect(shareInput(0).value).toBe('12.5')
    await user.clear(markupInput(0))
    markupInput(0).focus()
    await user.paste('×1.15x')
    expect(markupInput(0).value).toBe('1.15')
  })
})

describe('5.2 預覽列 / 5.3 摘要與每列金額', () => {
  it('P5.5 無出資者時預覽為一行且與 v1.1 相同', async () => {
    const s = await setupDb({ lastType: 'timed_mtt' })
    const { user } = await renderRecordForm(s)
    await typeInto(user, screen.getByRole('textbox', { name: '第 1 次 買入（含服務費）' }), '3400')
    await typeInto(user, screen.getByRole('textbox', { name: '第 1 次 服務費' }), '400')
    await user.click(screen.getByRole('button', { name: '＋ 再買入' }))
    await typeInto(user, screen.getByRole('textbox', { name: '第 2 次 買入（含服務費）' }), '3200')
    await typeInto(user, screen.getByRole('textbox', { name: '第 2 次 服務費' }), '200')
    await typeInto(user, screen.getByLabelText('到手金額'), '9000')
    const preview = screen.getByTestId('record-preview')
    expect(preview.getAttribute('data-lines')).toBe('1')
    expect(preview.textContent).toBe('買入 $6,600（2 次）· 服務費 $600 · 盈利 +$2,400')
    expect(screen.queryByTestId('record-preview-line2')).toBeNull()
  })

  it('P5.5 有出資者時兩行：以 C13 輸入顯示「全額 +$40,000」與「賣出 30% · 你的盈利 +$28,000」；摘要「已賣 30% · 你佔 70%」；每列「付你 · 分走」', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '10')
    await addBacker(user, 'B', '20')
    const preview = screen.getByTestId('record-preview')
    expect(preview.getAttribute('data-lines')).toBe('2')
    expect(screen.getByTestId('record-preview-line1').textContent).toBe('買入 $10,000（1 次）· 服務費 $0 · 全額 +$40,000')
    expect(screen.getByTestId('record-preview-line2').textContent).toBe('賣出 30% · 你的盈利 +$28,000')
    expect(screen.getByTestId('staking-summary').textContent).toBe('已賣 30% · 你佔 70%')
    expect(screen.getAllByTestId('backer-row-amounts').map((e) => e.textContent)).toEqual([
      '付你 $1,000 · 分走 $5,000',
      '付你 $2,000 · 分走 $10,000',
    ])
    // 改為加價 ×1.2：付款與你的盈利即時更新
    await typeInto(user, markupInput(0), '1.2')
    expect(screen.getAllByTestId('backer-row-amounts')[0]!.textContent).toBe('付你 $1,200 · 分走 $5,000')
    expect(screen.getByTestId('record-preview-line2').textContent).toBe('賣出 30% · 你的盈利 +$28,200')
  })

  it('有任一列比例或倍數無效時「你的盈利 —」，該列付你 / 分走皆為 —；到手無效時分走為 —', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '10')
    await user.click(addMore())
    expect(screen.getByTestId('record-preview-line2').textContent).toBe('賣出 10% · 你的盈利 —')
    expect(screen.getAllByTestId('backer-row-amounts')[1]!.textContent).toBe('付你 — · 分走 —')
    await typeInto(user, screen.getByLabelText('到手金額'), '')
    expect(screen.getAllByTestId('backer-row-amounts')[0]!.textContent).toBe('付你 $1,000 · 分走 —')
    expect(screen.getByTestId('record-preview-line1').textContent).toBe('買入 $10,000（1 次）· 服務費 $0 · 全額 —')
  })
})

describe('5.4 出資者驗證規則（每條一個元件測試）', () => {
  it('P5.5 規則 1 出資者名稱空白 → 請填寫出資者名稱（修改後即時重驗）', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, '', '10')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(nameInput(0), '請填寫出資者名稱'))
    // 失敗時 focus 第一個錯誤欄位
    expect(document.activeElement).toBe(nameInput(0))
    await user.type(nameInput(0), 'A')
    await waitFor(() => expect(nameInput(0).getAttribute('aria-invalid')).toBeNull())
  })

  it('P5.5 規則 2 名稱去除前後空白後超過 20 字 → 出資者名稱最多 20 字', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, '一二三四五六七八九十一二三四五六七八九十一', '10')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(nameInput(0), '出資者名稱最多 20 字'))
  })

  it('P5.5 規則 3 同一場名稱重複（不分大小寫）→ 出資者名稱重複', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'Alice', '10')
    await addBacker(user, ' ALICE ', '20')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(nameInput(1), '出資者名稱重複'))
    expect(nameInput(0).getAttribute('aria-invalid')).toBeNull()
    // 修改第 1 列的名稱後，第 2 列的重複錯誤即時消失
    await typeInto(user, nameInput(0), 'Bob')
    await waitFor(() => expect(nameInput(1).getAttribute('aria-invalid')).toBeNull())
  })

  it('P5.5 規則 4 比例空白或為 0 → 請填寫比例', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(shareInput(0), '請填寫比例'))
    await user.type(shareInput(0), '0')
    await waitFor(() => expectFieldError(shareInput(0), '請填寫比例'))
    await typeInto(user, shareInput(0), '10')
    await waitFor(() => expect(shareInput(0).getAttribute('aria-invalid')).toBeNull())
  })

  it('P5.5 規則 5 比例超過 1 位小數 → 比例最多到小數 1 位', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '12.55')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(shareInput(0), '比例最多到小數 1 位'))
  })

  it('P5.5 規則 6 比例大於 100 → 比例需介於 0.1% 到 100% 之間', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '100.5')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(shareInput(0), '比例需介於 0.1% 到 100% 之間'))
  })

  it('P5.5 規則 7 合計超過 100%：錯誤顯示在區塊標題下方「賣出比例合計不可超過 100%（目前 100.1%）」；任一比例修改後即時重驗；恰 100% 可儲存', async () => {
    const onSaved = vi.fn()
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s, { onSaved })
    await fillMtt(user)
    await addBacker(user, 'A', '60')
    await addBacker(user, 'B', '40.1')
    await user.click(saveButton())
    await waitFor(() => expect(totalError()?.textContent).toBe('賣出比例合計不可超過 100%（目前 100.1%）'))
    // 錯誤在區塊標題（摘要列）之後、出資者列之前
    const title = within(section()).getByRole('heading', { name: '賣股份' })
    expect(title.compareDocumentPosition(totalError()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(totalError()!.compareDocumentPosition(rows()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expectFieldError(shareInput(0), '賣出比例合計不可超過 100%（目前 100.1%）')
    expect(onSaved).not.toHaveBeenCalled()

    await typeInto(user, shareInput(1), '40')
    await waitFor(() => expect(totalError()).toBeNull())
    await user.click(saveButton())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const [saved] = await s.repos.sessions.list()
    expect(saved?.backers.map((b) => b.sharePermille)).toEqual([600, 400])
  })

  it('P5.5 規則 8 加價倍數空白 → 請填寫加價倍數', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '10', '')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(markupInput(0), '請填寫加價倍數'))
  })

  it('P5.5 規則 9 加價倍數超過 3 位小數 → 加價倍數最多到小數 3 位', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '10', '1.1255')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(markupInput(0), '加價倍數最多到小數 3 位'))
  })

  it('P5.5 規則 10 加價倍數小於 1.0 或大於 3.0 → 加價倍數需介於 1.0 到 3.0 之間', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await addBacker(user, 'A', '10', '0.9')
    await user.click(saveButton())
    await waitFor(() => expectFieldError(markupInput(0), '加價倍數需介於 1.0 到 3.0 之間'))
    await typeInto(user, markupInput(0), '3.5')
    await waitFor(() => expectFieldError(markupInput(0), '加價倍數需介於 1.0 到 3.0 之間'))
    await typeInto(user, markupInput(0), '3')
    await waitFor(() => expect(markupInput(0).getAttribute('aria-invalid')).toBeNull())
  })

  it('P5.5 空白列儲存時自動移除不報錯', async () => {
    const onSaved = vi.fn()
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s, { onSaved })
    await fillMtt(user)
    await user.click(addFirst())
    await addBacker(user, 'A', '10', '1.2')
    await user.click(addMore())
    await typeInto(user, markupInput(2), '')
    await user.click(saveButton())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const [saved] = await s.repos.sessions.list()
    expect(saved?.backers).toEqual([{ name: 'A', sharePermille: 100, markupPermille: 1200 }])
  })
})

describe('5.3 出資者名稱建議', () => {
  async function seedHistory(s: Setup) {
    const mk = (startAt: string, backers: Backer[]) =>
      s.repos.sessions.create({
        type: 'mtt',
        startAt,
        durationMin: 60,
        buyIns: [{ amount: 1000, fee: 0 }],
        cashOut: 0,
        backers,
      })
    const b = (name: string): Backer => ({ name, sharePermille: 10, markupPermille: 1000 })
    await mk('2026-09-01T10:00', [b('alice'), b('Bob')])
    await mk('2026-09-02T10:00', [b('Carol'), b('Dave'), b('Eve')])
    await mk('2026-09-03T10:00', [b('Frank'), b('Grace'), b('Heidi'), b('Ivan')])
    await mk('2026-09-10T10:00', [b('ALICE')])
  }

  it('P5.5 依最近使用排序、不分大小寫去重（保留最近寫法）、最多 8 筆；排除同表單已填名稱；點選填入並收起', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    await seedHistory(s)
    const { user } = await renderRecordForm(s)
    await user.click(addFirst())
    nameInput(0).focus()
    const list = await screen.findByTestId('backer-suggestions')
    const names = () => within(screen.getByTestId('backer-suggestions')).getAllByRole('button').map((b) => b.textContent)
    // 最近：ALICE（9/10）→ 9/3 的四位 → 9/2 的三位 → Bob（9/1）；alice 與 ALICE 去重；最多 8 筆
    expect(within(list).getAllByRole('button')).toHaveLength(8)
    expect(names()[0]).toBe('ALICE')
    expect(names()).not.toContain('alice')
    expect(names()).not.toContain('Bob')

    // 輸入時只列出包含該文字的名稱（部分符合、不分大小寫）
    await user.type(nameInput(0), 'a')
    expect(names()).toEqual(['ALICE', 'Frank', 'Grace', 'Ivan', 'Carol', 'Dave'])
    await user.click(screen.getByRole('button', { name: 'Grace' }))
    expect(nameInput(0).value).toBe('Grace')
    expect(screen.queryByTestId('backer-suggestions')).toBeNull()

    // 第 2 列：排除第 1 列已填的 Grace
    await user.click(addMore())
    nameInput(1).focus()
    await screen.findByTestId('backer-suggestions')
    expect(names()).not.toContain('Grace')
    expect(names()).toContain('Bob')
    // 沒有符合的名稱時不顯示清單
    await user.type(nameInput(1), 'zzz')
    expect(screen.queryByTestId('backer-suggestions')).toBeNull()
  })

  it('沒有任何歷史名稱時不顯示清單', async () => {
    const { user } = await renderMtt()
    await user.click(addFirst())
    nameInput(0).focus()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('backer-suggestions')).toBeNull()
    await user.type(nameInput(0), 'x')
    expect(screen.queryByTestId('backer-suggestions')).toBeNull()
  })
})

describe('5.5 儲存 / 5.1 切換類型', () => {
  it('儲存後提示「已儲存，你的盈利 +$28,000」，出資者列清空並收合；DB 寫入名稱（去除前後空白）、比例、倍數', async () => {
    const s = await setupDb({ lastType: 'mtt' })
    const { user } = await renderRecordForm(s)
    await fillMtt(user)
    await addBacker(user, ' A ', '10')
    await addBacker(user, 'B', '20')
    await user.click(saveButton())
    await waitFor(() => expect(screen.getByText('已儲存，你的盈利 +$28,000')).toBeTruthy())
    expect(rows()).toHaveLength(0)
    expect(section().getAttribute('data-expanded')).toBe('false')
    const [saved] = await s.repos.sessions.list()
    expect(saved?.backers).toEqual([
      { name: 'A', sharePermille: 100, markupPermille: 1000 },
      { name: 'B', sharePermille: 200, markupPermille: 1000 },
    ])
    // 出資者不存入任何 last* 設定
    expect(await s.repos.settings.get('lastType')).toBe('mtt')
  })

  it('沒有出資者時提示維持「已儲存，盈利 +$40,000」', async () => {
    const { user } = await renderMtt()
    await fillMtt(user)
    await user.click(saveButton())
    await waitFor(() => expect(screen.getByText('已儲存，盈利 +$40,000')).toBeTruthy())
  })

  it('切換類型時出資者列保留', async () => {
    const s = await setupDb({ lastType: 'mtt', stakes: [[50, 100]] })
    const { user } = await renderRecordForm(s)
    await addBacker(user, 'A', '10', '1.2')
    await user.click(screen.getByRole('button', { name: /限時 MTT/ }))
    expect(rows()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /現金桌/ }))
    expect(rows()).toHaveLength(1)
    expect(nameInput(0).value).toBe('A')
    expect(shareInput(0).value).toBe('10')
    expect(markupInput(0).value).toBe('1.2')
  })
})

describe('5.7 編輯模式', () => {
  it('P5.5 帶入出資者列（依儲存順序、區塊展開），可增刪修改並正確寫回；出資者變更算作未儲存變更', async () => {
    const s = await setupDb()
    const session = await s.repos.sessions.create({
      type: 'mtt',
      startAt: '2026-09-27T20:00',
      durationMin: 120,
      buyIns: [{ amount: 10000, fee: 0 }],
      cashOut: 50000,
      backers: [
        { name: 'A', sharePermille: 100, markupPermille: 1200 },
        { name: 'B', sharePermille: 200, markupPermille: 1200 },
      ],
    })
    const onDirtyChange = vi.fn()
    const onSaved = vi.fn()
    const { user } = await renderRecordForm(s, { mode: 'edit', initialSession: session, onDirtyChange, onSaved })
    expect(section().getAttribute('data-expanded')).toBe('true')
    expect(rows()).toHaveLength(2)
    expect([nameInput(0).value, shareInput(0).value, markupInput(0).value]).toEqual(['A', '10', '1.2'])
    expect([nameInput(1).value, shareInput(1).value, markupInput(1).value]).toEqual(['B', '20', '1.2'])
    expect(screen.getByTestId('record-preview-line2').textContent).toBe('賣出 30% · 你的盈利 +$28,600')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    // 修改 A 的比例、刪除 B、新增 C
    await typeInto(user, shareInput(0), '12.5')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await user.click(screen.getAllByRole('button', { name: '刪除出資者' })[1]!)
    await addBacker(user, 'C', '50', '1.15')
    await user.click(saveButton())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const updated = await s.repos.sessions.get(session.id)
    expect(updated?.backers).toEqual([
      { name: 'A', sharePermille: 125, markupPermille: 1200 },
      { name: 'C', sharePermille: 500, markupPermille: 1150 },
    ])
    expect(updated?.updatedAt).toBeDefined()
  })
})
