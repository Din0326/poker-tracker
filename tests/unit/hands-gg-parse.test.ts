// SPEC-v2-hands 第 8 節、12.3 H4：GG 方言解析器（parse/gg.ts，建立在 parse/core.ts 之上）。
// HC19：8.8 範例逐欄比對；HC20：8.5 不支援情況表每一列各一手、白名單與重播驗證的拒絕原因；文字照 8.5 / 第 8 節。
// 所有 GG 原文都是非真實檔案，依規格 8.8 與公開格式撰寫，待以真實 PokerCraft 匯出驗證（14 節 HQ15）。
import { describe, expect, it } from 'vitest'
import {
  GG_PARSER_VERSION,
  buildGgImportPreview,
  classifyHand,
  formatHandAmount,
  formatHandBb,
  formatSignedHandAmount,
  ggAmountToCents,
  parseGgHand,
  parseGgText,
  splitGgHands,
  type GgHandResult,
  type GgImportItem,
  type GgRejectReason,
  type ParsedGgHand,
} from '../../src/domain/hands'
import { ggReasonText } from '../../src/features/hands/ggImportText'
import { SHOWDOWN_HAND, SIDE_POT_HAND, ggExample, insertLine, withHandId } from './helpers/ggText'

const base = () => ggExample().trimEnd()

function parsedOf(text: string): ParsedGgHand {
  const r = parseGgHand(text)
  if (!r.ok) throw new Error(`解析失敗：${JSON.stringify(r.reason)}`)
  return r.hand
}

function reasonOf(text: string): GgRejectReason {
  const r = parseGgHand(text)
  if (r.ok) throw new Error('預期被拒絕，但解析成功')
  return r.reason
}

/** 拒絕原因的畫面文字（照 8.5） */
const reasonTextOf = (text: string) => ggReasonText(reasonOf(text))

describe('HC19 GG 範例：8.8 原文解析結果與 8.8 表格逐欄相同', () => {
  const hand = parsedOf(splitGgHands(ggExample())[0]!.rawText)

  it('HC19 source / parserVersion / sourceHandId = gg / 1 / RC1000000001', () => {
    expect(hand.source).toBe('gg')
    expect(GG_PARSER_VERSION).toBe(1)
    expect(hand.sourceHandId).toBe('RC1000000001')
  })

  it('HC19 gameType / amountUnit / playedAt = cash / cent / 2026-09-20T22:05:13（原文時間，不換算，HQ16）', () => {
    expect(hand.gameType).toBe('cash')
    expect(hand.amountUnit).toBe('cent')
    expect(hand.playedAt).toBe('2026-09-20T22:05:13')
  })

  it('HC19 tableSize / buttonSeat / heroSeat = 6 / 1 / 2；sb / bb / ante / straddle = 10 / 25 / 0 / 0', () => {
    const d = hand.detail
    expect([d.tableSize, d.buttonSeat, d.heroSeat]).toEqual([6, 1, 2])
    expect([d.sb, d.bb, d.ante, d.straddle]).toEqual([10, 25, 0, 0])
    expect(hand.bb).toBe(25)
  })

  it('HC19 seats（seatNo: stack, name）：Hero 的 name 為 null，其餘沿用原站匿名名稱', () => {
    expect(hand.detail.seats.map((s) => [s.seatNo, s.stack, s.name])).toEqual([
      [1, 2500, '7f3a9c21'],
      [2, 2500, null],
      [3, 3120, 'b04e5d18'],
      [4, 2500, '2c8e6f07'],
      [5, 1840, 'e91d4a3b'],
      [6, 2500, '5a6b7c8d'],
    ])
    expect(hand.detail.seats.every((s) => !s.mucked)).toBe(true)
    expect(hand.detail.seats.filter((s) => s.seatNo !== 2).every((s) => s.cards.length === 0)).toBe(true)
  })

  it('HC19 heroCards / heroPosition = ["Qh","Qd"] / SB', () => {
    expect(hand.heroCards).toEqual(['Qh', 'Qd'])
    expect(hand.heroPosition).toBe('SB')
    expect(hand.heroName).toBe('Hero')
  })

  it('HC19 actions：preflop 4 fold、5 raise to 65、6 fold、1 fold、2 raise to 225、3 fold、5 call；flop 2 bet 150、5 call；turn 2 bet 375、5 fold', () => {
    expect(hand.detail.actions).toEqual([
      { street: 'preflop', seatNo: 4, type: 'fold', to: null },
      { street: 'preflop', seatNo: 5, type: 'raise', to: 65 },
      { street: 'preflop', seatNo: 6, type: 'fold', to: null },
      { street: 'preflop', seatNo: 1, type: 'fold', to: null },
      { street: 'preflop', seatNo: 2, type: 'raise', to: 225 },
      { street: 'preflop', seatNo: 3, type: 'fold', to: null },
      { street: 'preflop', seatNo: 5, type: 'call', to: null },
      { street: 'flop', seatNo: 2, type: 'bet', to: 150 },
      { street: 'flop', seatNo: 5, type: 'call', to: null },
      { street: 'turn', seatNo: 2, type: 'bet', to: 375 },
      { street: 'turn', seatNo: 5, type: 'fold', to: null },
    ])
  })

  it('HC19 board = ["8s","4h","2d","Jc"]', () => {
    expect(hand.board).toEqual(['8s', '4h', '2d', 'Jc'])
  })

  it('HC19 未跟注退回：轉牌 375 退回座位 2（與原文一致；改成其他金額即拒絕）', () => {
    expect(reasonOf(base().replace('Uncalled bet ($3.75) returned to Hero', 'Uncalled bet ($3.5) returned to Hero'))).toEqual({ code: 'illegalAction', line: 31 })
    expect(reasonOf(base().replace('Uncalled bet ($3.75) returned to Hero\n', ''))).toMatchObject({ code: 'illegalAction' })
  })

  it('HC19 底池總額 775 ＝ 原文 Total pot $7.75；rake 44（Rake 39 + Jackpot 5 + Bingo 0 + Fortune 0 + Tax 0）；collected [{2, 0, 731}]', () => {
    expect(hand.detail.rake).toBe(44)
    expect(hand.detail.collected).toEqual([{ seatNo: 2, potIndex: 0, amount: 731 }])
    expect(731 + 44).toBe(775)
  })

  it('HC19 heroNet = 731 − 375 = 356（`+$3.56`、`+14.2 bb`）；kind complete', () => {
    expect(hand.heroNet).toBe(356)
    expect(formatSignedHandAmount(356, 'cent')).toBe('+$3.56')
    expect(formatHandBb(356, 25)).toBe('+14.2 bb')
    expect(classifyHand({ source: 'gg', detail: hand.detail, board: hand.board })).toBe('complete')
  })

  it('HC19 rawText 為該手原文（已正規化換行為 \\n、去除 BOM 與前後空白行）', () => {
    expect(hand.rawText).toBe(base())
    const bomCrlf = String.fromCharCode(0xfeff) + `\r\n\r\n${base().replaceAll('\n', '\r\n')}\r\n\r\n`
    const [r] = parseGgText(bomCrlf)
    expect(r!.ok && r!.hand.rawText).toBe(base())
  })
})

describe('8.3 白名單解析與金額', () => {
  it('8.3 金額換算成分：$0.1 → 10、$25 → 2500、$1,000.5 → 100050、$0.05 → 5', () => {
    expect(ggAmountToCents('0.1')).toBe(10)
    expect(ggAmountToCents('25')).toBe(2500)
    expect(ggAmountToCents('1,000.5')).toBe(100050)
    expect(ggAmountToCents('0.05')).toBe(5)
  })

  it('8.3 千分位逗號金額可解析（需驗證：GG 是否輸出千分位）', () => {
    const text = base()
      .replace('Seat 3: b04e5d18 ($31.2 in chips)', 'Seat 3: b04e5d18 ($1,031.2 in chips)')
    expect(parsedOf(text).detail.seats[2]!.stack).toBe(103120)
  })

  it('8.3 拆手：以行首 `Poker Hand #` 為開頭，第一手之前的雜訊忽略；多手各自解析', () => {
    const text = `some noise\nPokerCraft export\n\n${withHandId(base(), 'RC11')}\n\n\n${withHandId(base(), 'HD22')}\n`
    const results = parseGgText(text)
    expect(results.map((r) => r.ok && r.hand.sourceHandId)).toEqual(['RC11', 'HD22'])
    expect(splitGgHands(text).map((c) => c.index)).toEqual([1, 2])
  })

  it('8.3 攤牌標記 `*** SHOWDOWN ***` / `*** SHOW DOWN ***` 可有可無（需驗證）', () => {
    expect(parseGgHand(SHOWDOWN_HAND).ok).toBe(true)
    expect(parseGgHand(SHOWDOWN_HAND.replace('*** SHOWDOWN ***', '*** SHOW DOWN ***')).ok).toBe(true)
    expect(parseGgHand(SHOWDOWN_HAND.replace('*** SHOWDOWN ***\n', '')).ok).toBe(true)
    expect(parseGgHand(base().replace('*** SHOWDOWN ***\n', '')).ok).toBe(true)
  })

  it('8.3 攤牌：收回者為 4.7 判定的贏家時可匯入；亮牌描述忽略；Hero 名稱不必是 Hero', () => {
    const h = parsedOf(SHOWDOWN_HAND)
    expect(h.detail.collected).toEqual([{ seatNo: 2, potIndex: 0, amount: 48 }])
    expect(h.detail.seats[2]!.cards).toEqual(['Kc', 'Kd'])
    expect(h.heroNet).toBe(48 - 25)
    const renamed = SHOWDOWN_HAND.replaceAll('Hero', 'Din0326')
    const r = parsedOf(renamed)
    expect(r.heroName).toBe('Din0326')
    expect(r.detail.heroSeat).toBe(2)
    expect(r.detail.seats[1]!.name).toBeNull()
  })

  it('8.3 有攤牌且收回者與 4.7 的贏家不符 → 輸贏與牌力判定不符', () => {
    const text = SHOWDOWN_HAND.replace('Hero collected $0.48 from pot', 'bbbb2222 collected $0.48 from pot')
    expect(reasonOf(text)).toEqual({ code: 'winnerMismatch' })
    expect(reasonTextOf(text)).toBe('輸贏與牌力判定不符')
  })

  it('8.3 有蓋牌者時，收回者必須是亮牌者中牌力最高者（含平手）', () => {
    const mucked = SHOWDOWN_HAND.replace('bbbb2222: shows [Kc Kd] (a pair of Kings)', 'bbbb2222: mucks hand')
    const h = parsedOf(mucked)
    expect(h.detail.seats[2]).toMatchObject({ mucked: true, cards: [] })
    // 蓋牌者收回：收回者不是亮牌者中牌力最高者
    expect(reasonOf(mucked.replace('Hero collected $0.48 from pot', 'bbbb2222 collected $0.48 from pot'))).toEqual({ code: 'winnerMismatch' })
  })

  it('8.3 Total pot 的附加費用（Jackpot、Bingo、Fortune、Tax）計入 rake', () => {
    const text = SHOWDOWN_HAND.replace('Total pot $0.5 | Rake $0.02', 'Total pot $0.5 | Rake $0.01 | Tax $0.01').replace('Hero collected $0.48', 'Hero collected $0.48')
    expect(parsedOf(text).detail.rake).toBe(2)
    expect(reasonOf(SHOWDOWN_HAND.replace('| Rake $0.02', '| Rake $0.02 | Jackpot $0.01'))).toEqual({ code: 'potMismatch' })
  })

  it('8.3 前注：每位玩家相同金額時可匯入；金額不同拒絕', () => {
    const lines = SHOWDOWN_HAND.split('\n')
    const antes = ['aaaa1111: posts the ante $0.05', 'Hero: posts the ante $0.05', 'bbbb2222: posts the ante $0.05']
    lines.splice(5, 0, ...antes)
    let text = lines.join('\n').replace('Total pot $0.5 | Rake $0.02', 'Total pot $0.65 | Rake $0.02').replace('Hero collected $0.48', 'Hero collected $0.63')
    const h = parsedOf(text)
    expect(h.detail.ante).toBe(5)
    text = text.replace('Hero: posts the ante $0.05', 'Hero: posts the ante $0.04')
    expect(reasonOf(text)).toMatchObject({ code: 'illegalAction' })
  })

  it('8.3 Hero 判定：帶牌的 Dealt to 為 0 行或 2 行以上 → 無法判定你的座位', () => {
    expect(reasonTextOf(base().replace('Dealt to Hero [Qh Qd]', 'Dealt to Hero '))).toBe('無法判定你的座位')
    expect(reasonTextOf(base().replace('Dealt to 5a6b7c8d ', 'Dealt to 5a6b7c8d [Ac Kc]'))).toBe('無法判定你的座位')
  })

  it('8.3 名稱比對：行動中的名稱不在座位行 → 拒絕；座位行名稱重複 → 拒絕', () => {
    expect(reasonOf(base().replace('5a6b7c8d: folds', 'zzzz9999: folds'))).toEqual({ code: 'unrecognizedLine', line: 20 })
    expect(reasonOf(base().replace('Seat 6: 5a6b7c8d ($25 in chips)', 'Seat 6: 7f3a9c21 ($25 in chips)'))).toMatchObject({ code: 'unrecognizedLine', line: 8 })
  })

  it('8.3 行動對應：跟注金額、加注增量、全下標記與重播不一致 → 行動不合法：第 N 行', () => {
    expect(reasonTextOf(base().replace('e91d4a3b: calls $1.6', 'e91d4a3b: calls $1.5'))).toBe('行動不合法：第 24 行')
    expect(reasonTextOf(base().replace('Hero: raises $1.6 to $2.25', 'Hero: raises $1.7 to $2.25'))).toBe('行動不合法：第 22 行')
    expect(reasonTextOf(base().replace('Hero: bets $1.5', 'Hero: bets $1.5 and is all-in'))).toBe('行動不合法：第 26 行')
    // 重播為全下但沒有標記也拒絕：座位 5 籌碼改成剛好在轉牌前用完
    expect(reasonTextOf(base().replace('Seat 5: e91d4a3b ($18.4 in chips)', 'Seat 5: e91d4a3b ($3.75 in chips)'))).toBe('行動不合法：第 27 行')
    // 不是輪到的玩家行動
    expect(reasonTextOf(base().replace('2c8e6f07: folds\n', ''))).toBe('行動不合法：第 18 行')
  })

  it('8.3 盲注座位與 4.1 推導不一致 → 拒絕', () => {
    expect(reasonOf(base().replace('Hero: posts small blind $0.1', '7f3a9c21: posts small blind $0.1'))).toEqual({ code: 'illegalAction', line: 9 })
  })

  it('8.3 公牌：轉牌行前段與翻牌不同、摘要 Board 與各街不一致 → 拒絕', () => {
    expect(reasonOf(base().replace('*** TURN *** [8s 4h 2d] [Jc]', '*** TURN *** [8s 4h 3d] [Jc]'))).toEqual({ code: 'unrecognizedLine', line: 28 })
    expect(reasonOf(base().replace('Board [8s 4h 2d Jc]', 'Board [8s 4h 2d Jd]'))).toEqual({ code: 'unrecognizedLine', line: 36 })
  })

  it('3.1 rawText 超過 20,000 字元 → 手牌內容過長', () => {
    const text = `${base()}\nSeat 7: ${'x'.repeat(20_000)}`
    expect(reasonTextOf(text)).toBe('手牌內容過長')
  })

  it('HQ23 `is sitting out` 等資訊行目前一律以「無法辨識的內容」拒絕（真實檔案驗證後再決定）', () => {
    expect(reasonTextOf(insertLine(base(), 11, '5a6b7c8d: is sitting out'))).toBe('無法辨識的內容：第 11 行')
  })

  it('HQ29 牌面 `10h` 等非 3.6 編碼 → 無法辨識的內容', () => {
    expect(reasonTextOf(base().replace('*** FLOP *** [8s 4h 2d]', '*** FLOP *** [8s 4h 10d]'))).toBe('無法辨識的內容：第 25 行')
  })
})

describe('HC20 GG 不支援：以 8.8 範例為底插入或修改出 8.5 每一種情況，全部被拒且原因文字與 8.5 相同', () => {
  const header = (h: string) => base().replace(/^.*$/m, h)

  it('HC20 8.5 Omaha / PLO：標頭含 Omaha 或 PLO', () => {
    expect(reasonTextOf(header("Poker Hand #RC1000000001: Omaha Pot Limit ($0.1/$0.25) - 2026/09/20 22:05:13"))).toBe('不支援 Omaha（PLO），第一版只支援無限注德州撲克')
    expect(reasonTextOf(header('Poker Hand #RC1000000001: PLO ($0.1/$0.25) - 2026/09/20 22:05:13'))).toBe('不支援 Omaha（PLO），第一版只支援無限注德州撲克')
  })

  it('HC20 8.5 短牌：標頭含 Short Deck 或 6+', () => {
    expect(reasonTextOf(header("Poker Hand #RC1000000001: Hold'em Short Deck ($0.1/$0.25) - 2026/09/20 22:05:13"))).toBe('不支援短牌（Short Deck）')
    expect(reasonTextOf(header("Poker Hand #RC1000000001: 6+ Hold'em ($0.1/$0.25) - 2026/09/20 22:05:13"))).toBe('不支援短牌（Short Deck）')
  })

  it('HC20 8.5 非無限注：標頭不含 Hold\'em No Limit', () => {
    expect(reasonTextOf(header("Poker Hand #RC1000000001: Hold'em Limit ($0.1/$0.25) - 2026/09/20 22:05:13"))).toBe('只支援無限注德州撲克')
  })

  it('HC20 8.5 錦標賽：前綴 TM，或標頭含 Tournament', () => {
    expect(reasonTextOf(withHandId(base(), 'TM1000000001'))).toBe('錦標賽手牌暫不支援匯入')
    expect(reasonTextOf(header("Poker Hand #RC1000000001: Tournament #123, Hold'em No Limit ($0.1/$0.25) - 2026/09/20 22:05:13"))).toBe('錦標賽手牌暫不支援匯入')
  })

  it('HC20 8.5 未知前綴：前綴不是 RC、HD → 不支援的牌局類型（前綴 XX）', () => {
    expect(reasonOf(withHandId(base(), 'XX1000000001'))).toEqual({ code: 'unknownPrefix', prefix: 'XX' })
    expect(reasonTextOf(withHandId(base(), 'XX1000000001'))).toBe('不支援的牌局類型（前綴 XX）')
    expect(parseGgHand(withHandId(base(), 'HD1000000001')).ok).toBe(true)
  })

  it.each([
    ['*** FIRST FLOP *** [8s 4h 2d]'],
    ['*** FIRST TURN *** [8s 4h 2d] [Jc]'],
    ['*** FIRST RIVER *** [8s 4h 2d Jc] [5s]'],
    ['*** SECOND FLOP *** [9s 5h 3d]'],
    ['*** SECOND TURN *** [9s 5h 3d] [Ts]'],
    ['*** SECOND RIVER *** [9s 5h 3d Ts] [Kd]'],
    ['Hero: Chooses to Run it twice'],
    ['Hand was run two times'],
  ])('HC20 8.5 Run It Twice：%s', (line) => {
    expect(reasonTextOf(insertLine(base(), 32, line))).toBe('不支援 Run It Twice（發兩次牌）')
  })

  it.each([['Hero: Cashout $5'], ['Hero: Cash Out at $5 (EV)']])('HC20 8.5 EV Cashout：%s', (line) => {
    expect(reasonTextOf(insertLine(base(), 32, line))).toBe('不支援 EV Cashout')
  })

  it('HC20 8.5 保險：Insurance', () => {
    expect(reasonTextOf(insertLine(base(), 32, 'Hero: Pays Insurance $0.5'))).toBe('不支援保險')
  })

  it.each([['Bomb Pot'], ['BombPot']])('HC20 8.5 Bomb Pot：%s', (word) => {
    expect(reasonTextOf(insertLine(base(), 2, `${word} ($0.5)`))).toBe('不支援 Bomb Pot')
  })

  it('HC20 8.5 straddle：插入 1 個 `Hero: straddle $0.5` 行', () => {
    expect(reasonTextOf(insertLine(base(), 11, 'Hero: straddle $0.5'))).toBe('不支援 straddle（待真實檔案確認格式）')
  })

  it.each([['7f3a9c21: posts missed blind $0.25'], ['7f3a9c21: posts dead blind $0.1'], ['7f3a9c21: posts small & big blind $0.35']])(
    'HC20 8.5 補盲：%s',
    (line) => {
      expect(reasonTextOf(insertLine(base(), 11, line))).toBe('不支援補盲（missed / dead blind）')
    },
  )

  it('HC20 8.5 籌碼不足以支付盲注或前注（重播檢查 4.3）', () => {
    const text = base().replace('Seat 3: b04e5d18 ($31.2 in chips)', 'Seat 3: b04e5d18 ($0.25 in chips)')
    expect(reasonTextOf(text)).toBe('不支援玩家籌碼不足以支付盲注或前注的手牌')
  })

  it('HC20 8.5 邊池：1 手會切出邊池的手牌（重播檢查 8.3，HQ21）', () => {
    expect(reasonTextOf(SIDE_POT_HAND)).toBe('包含邊池，第一版暫不支援匯入')
  })

  it('HC20 8.5 人數超出：tableSize 不在 2–10、或座位數不在 2–tableSize', () => {
    expect(reasonTextOf(base().replace("Table 'RushAndCash100' 6-max", "Table 'RushAndCash100' 11-max"))).toBe('不支援的牌桌人數')
    expect(reasonTextOf(base().replace("Table 'RushAndCash100' 6-max", "Table 'RushAndCash100' 5-max"))).toBe('不支援的牌桌人數')
  })

  it('HC20 8.5 其他：插入 1 個未知行 → 無法辨識的內容：第 N 行（N 為該手內的行號）', () => {
    expect(reasonTextOf(insertLine(base(), 26, 'Hero: says good luck'))).toBe('無法辨識的內容：第 26 行')
    expect(reasonTextOf(base().replace('*** HOLE CARDS ***', '*** HOLE CARDS'))).toBe('無法辨識的內容：第 11 行')
  })

  it('HC20 8.5 其他：1 個金額不符 → 底池金額對不上', () => {
    expect(reasonTextOf(base().replace('Total pot $7.75', 'Total pot $7.8'))).toBe('底池金額對不上')
    expect(reasonTextOf(base().replace('Hero collected $7.31 from pot', 'Hero collected $7.3 from pot'))).toBe('底池金額對不上')
  })

  it('HC20 8.5 其他：重播不合法 → 行動不合法：第 N 行', () => {
    expect(reasonTextOf(base().replace('e91d4a3b: raises $0.4 to $0.65', 'e91d4a3b: raises $0.05 to $0.3'))).toBe('行動不合法：第 19 行')
  })

  it('HC20 8.5 其他：牌重複 → 同一張牌不可重複出現', () => {
    const text = base().replace('*** TURN *** [8s 4h 2d] [Jc]', '*** TURN *** [8s 4h 2d] [Qh]').replace('Board [8s 4h 2d Jc]', 'Board [8s 4h 2d Qh]')
    expect(reasonTextOf(text)).toBe('同一張牌不可重複出現')
  })

  it('HC20 8.5 其他：內容不完整 → 手牌內容不完整', () => {
    expect(reasonTextOf(base().split('\n*** SUMMARY ***')[0]!)).toBe('手牌內容不完整')
    expect(reasonTextOf(base().split('\n*** TURN ***')[0]!)).toBe('手牌內容不完整')
  })

  it('HC20 8.3 1 個三位小數 → 金額超過 2 位小數（在白名單檢查之前）', () => {
    expect(reasonTextOf(base().replace('Hero collected $7.31 from pot', 'Hero collected $7.310 from pot'))).toBe('金額超過 2 位小數')
  })

  it('HC20 8.5 同時符合多個關鍵字時依表格由上到下取第一個（Omaha 且 Run It Twice → Omaha）', () => {
    const text = insertLine(header('Poker Hand #RC1000000001: Omaha ($0.1/$0.25) - 2026/09/20 22:05:13'), 32, 'run it twice')
    expect(reasonOf(text)).toEqual({ code: 'omaha' })
    expect(reasonOf(insertLine(insertLine(base(), 32, 'Insurance'), 32, 'Cashout'))).toEqual({ code: 'evCashout' })
  })

  it('HC20 同一檔案中：各種不支援的手牌全部被拒，其他合法手牌仍可匯入', () => {
    const bad = [
      header('Poker Hand #RC2000000001: Omaha ($0.1/$0.25) - 2026/09/20 22:05:13'),
      withHandId(insertLine(base(), 11, 'Hero: straddle $0.5'), 'RC2000000002'),
      withHandId(insertLine(base(), 26, 'Hero: says good luck'), 'RC2000000003'),
      withHandId(base().replace('Total pot $7.75', 'Total pot $7.8'), 'RC2000000004'),
      SIDE_POT_HAND,
      withHandId(base().replace('Hero collected $7.31', 'Hero collected $7.310'), 'RC2000000005'),
    ]
    const good = [withHandId(base(), 'RC2000000101'), SHOWDOWN_HAND]
    const file = [bad[0], good[0], ...bad.slice(1), good[1]].join('\n\n\n')
    const results: GgHandResult[] = parseGgText(file)
    expect(results).toHaveLength(8)
    const items: GgImportItem[] = results.map((result, i) => ({ fileIndex: 1, handIndex: i + 1, result }))
    const preview = buildGgImportPreview(items, new Set())
    expect(preview.importable.map((h) => h.sourceHandId)).toEqual(['RC2000000101', 'RC3000000001'])
    expect(preview.rejected).toBe(6)
    expect(preview.groups.map((g) => ggReasonText(g.reason)).sort()).toEqual(
      [
        '不支援 Omaha（PLO），第一版只支援無限注德州撲克',
        '不支援 straddle（待真實檔案確認格式）',
        '無法辨識的內容：第 26 行',
        '底池金額對不上',
        '包含邊池，第一版暫不支援匯入',
        '金額超過 2 位小數',
      ].sort(),
    )
  })
})

describe('8.6、8.7 匯入預覽：去重與摘要', () => {
  const ok = (id: string): GgHandResult => parseGgHand(withHandId(base(), id))
  const item = (fileIndex: number, handIndex: number, result: GgHandResult): GgImportItem => ({ fileIndex, handIndex, result })

  it('8.6 資料庫已有的 sourceHandId 與同一次匯入中再次出現者（第一次計為可匯入）→ 重複略過；三者相加 = 總手數', () => {
    const items = [item(1, 1, ok('RC1')), item(1, 2, ok('RC2')), item(2, 1, ok('RC1')), item(2, 2, ok('RC3')), item(2, 3, parseGgHand('Poker Hand #XX9: x'))]
    const p = buildGgImportPreview(items, new Set(['RC3']))
    expect(p.importable.map((h) => h.sourceHandId)).toEqual(['RC1', 'RC2'])
    expect([p.duplicates, p.rejected, p.total]).toEqual([2, 1, 5])
    expect(p.importable.length + p.duplicates + p.rejected).toBe(p.total)
  })

  it('8.2 依原因分組計數，每組最多保留前 20 筆明細；取不到編號時以檔案與手的序號識別', () => {
    const bad = (i: number) => item(1, i, parseGgHand(withHandId(insertLine(base(), 26, 'unknown line'), `RC${i}`)))
    const noId = item(3, 18, parseGgHand(base().replace('Poker Hand #RC1000000001:', 'Poker Hand #:')))
    const items = [...Array.from({ length: 25 }, (_, i) => bad(i + 1)), noId]
    const p = buildGgImportPreview(items, new Set())
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]!.count).toBe(26)
    expect(p.groups[0]!.samples).toHaveLength(20)
    expect(p.groups[0]!.samples[0]).toMatchObject({ sourceHandId: 'RC1', fileIndex: 1, handIndex: 1 })
    const p2 = buildGgImportPreview([noId], new Set())
    expect(p2.groups[0]!.samples[0]).toMatchObject({ sourceHandId: null, fileIndex: 3, handIndex: 18 })
  })

  it('8.2 不支援的前綴依前綴分組', () => {
    const p = buildGgImportPreview(
      [item(1, 1, ok('XX1')), item(1, 2, ok('YY1')), item(1, 3, ok('XX2'))],
      new Set(),
    )
    expect(p.groups.map((g) => [ggReasonText(g.reason), g.count])).toEqual([
      ['不支援的牌局類型（前綴 XX）', 2],
      ['不支援的牌局類型（前綴 YY）', 1],
    ])
  })
})

it('4.12 分單位顯示：GG 匯入的金額固定 2 位小數', () => {
  expect(formatHandAmount(2500, 'cent')).toBe('$25.00')
})
