// SPEC-v2-hands 第 9 節、12.3 H3：PokerStars 解析器（parse/core.ts + parse/pokerstars.ts）與 HC18 往返測試。
// 往返：建立完整手牌 → exportPokerStars([hand]) → parsePokerStars(text) → 比對第 9 節列出的欄位。
// playedAt 不換算時區：npm run test:tz 以 UTC、Asia/Taipei、America/New_York 各執行一次，結果必須相同。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  exportHandText,
  exportPokerStars,
  normalizeText,
  parsePokerStars,
  sortHandsForExport,
  splitHands,
  type Hand,
  type ParsedPokerStarsHand,
  type PokerStarsHandResult,
} from '../../src/domain/hands'
import { hc2Detail, hc5Detail, hc6Detail, muckDetail, runoutBoard } from './helpers/handCases'
import { EXAMPLE_79_BOARD, act, buildHand, detail, example79Hand, seat } from './helpers/hands'
import { ggCentHand, hc7Hand, hc8Hand, hc9Hand, multiSidePotHand, tenMaxHand } from './helpers/exportCases'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'hands', 'export-example-1.txt')

/** HC4 不完整加注：翻牌 3 人，A（座位 2）下注 1000、B（座位 3）加注到 3000、C（座位 1，Hero）全下到 4000（不完整），A、B 跟注 */
function hc4Hand(fixed: Partial<Pick<Hand, 'exportSeq'>> = {}): Hand {
  const d = detail({
    tableSize: 3,
    buttonSeat: 1,
    heroSeat: 1,
    seats: [seat(1, 4200, ['As', 'Ad']), seat(2, 20000, ['Ks', 'Kd']), seat(3, 20000, ['Qs', 'Qd'])],
    actions: [
      act('preflop', 1, 'call'),
      act('preflop', 2, 'call'),
      act('preflop', 3, 'check'),
      act('flop', 2, 'bet', 1000),
      act('flop', 3, 'raise', 3000),
      act('flop', 1, 'raise', 4000),
      act('flop', 2, 'call'),
      act('flop', 3, 'call'),
      act('turn', 2, 'check'),
      act('turn', 3, 'check'),
      act('river', 2, 'check'),
      act('river', 3, 'check'),
    ],
  })
  return buildHand({ detail: d, board: runoutBoard }, fixed)
}

/** 第 9 節往返測試的案例（每手 exportSeq 與 playedAt 不同，多手檔案的順序即依 7.1 排序） */
function roundTripCases(): { name: string; hand: Hand }[] {
  const list: { name: string; hand: Hand }[] = [
    { name: '7.9 範例', hand: example79Hand() },
    { name: 'HC2 BB walk', hand: buildHand({ detail: hc2Detail() }) },
    { name: 'HC4 不完整加注', hand: hc4Hand() },
    { name: 'HC5 三人邊池（自動發完、rake 300）', hand: buildHand({ detail: hc5Detail(300), board: runoutBoard }) },
    { name: 'HC6 平分（元）', hand: buildHand({ detail: hc6Detail(25, 50), board: ['Ts', 'Js', 'Qs', 'Ks', 'As'] }) },
    {
      name: 'HC6 平分（籌碼）',
      hand: buildHand({ detail: hc6Detail(25, 50), board: ['Ts', 'Js', 'Qs', 'Ks', 'As'], gameType: 'tournament' }),
    },
    { name: 'HC8 straddle', hand: hc8Hand() },
    { name: 'HC9 錦標賽前注', hand: hc9Hand() },
    { name: '2 人桌（HC7）', hand: hc7Hand() },
    { name: '10 人桌', hand: tenMaxHand() },
    { name: '對手蓋牌', hand: buildHand({ detail: muckDetail(), board: EXAMPLE_79_BOARD }) },
    { name: '分單位手牌（8.8 GG 範例的解析結果）', hand: ggCentHand() },
    { name: 'HC10 抽水扣光主池（rake 3500）', hand: buildHand({ detail: hc5Detail(3500), board: runoutBoard }) },
    { name: '兩個以上邊池', hand: multiSidePotHand() },
  ]
  return list.map(({ name, hand }, i) => ({
    name,
    hand: { ...hand, exportSeq: 100 + i, playedAt: `2026-09-${String(10 + i).padStart(2, '0')}T${String(i).padStart(2, '0')}:05:00` },
  }))
}

/** 第 9 節的比對欄位（Seat.name 不比對；GG 名稱另有案例） */
function comparable(h: Pick<Hand, 'gameType' | 'amountUnit' | 'playedAt' | 'detail' | 'heroCards' | 'board' | 'heroPosition' | 'heroNet'>) {
  return {
    gameType: h.gameType,
    amountUnit: h.amountUnit,
    playedAt: h.playedAt,
    detail: { ...h.detail!, seats: h.detail!.seats.map(({ seatNo, stack, cards, mucked }) => ({ seatNo, stack, cards, mucked })) },
    heroCards: h.heroCards,
    board: h.board,
    heroPosition: h.heroPosition,
    heroNet: h.heroNet,
  }
}

function okHands(results: PokerStarsHandResult[]): ParsedPokerStarsHand[] {
  return results.map((r) => {
    if (!r.ok) throw new Error(`parse failed: ${r.error.code} line ${r.error.line}`)
    return r.hand
  })
}

describe('HC18 往返：第 9 節列出的所有案例往返後逐欄相同', () => {
  for (const { name, hand } of roundTripCases()) {
    it(`HC18 ${name}`, () => {
      expect(hand.kind).toBe('complete')
      const text = exportPokerStars([hand])
      const result = parsePokerStars(text)
      expect(result.hands).toHaveLength(1)
      const [parsed] = okHands(result.hands)
      expect(comparable(parsed!)).toEqual(comparable(hand))
      expect(parsed!.exportSeq).toBe(hand.exportSeq)
      expect(parsed!.heroName).toBe('Hero')
    })
  }

  it('HC18 多手檔案：同一個檔案含上述所有案例，解析出的手數與順序一致', () => {
    const hands = roundTripCases().map((c) => c.hand)
    const shuffled = [...hands].reverse()
    const text = exportPokerStars(shuffled)
    const parsed = okHands(parsePokerStars(text).hands)
    const expected = sortHandsForExport(hands)
    expect(parsed).toHaveLength(expected.length)
    parsed.forEach((p, i) => {
      expect(p.exportSeq).toBe(expected[i]!.exportSeq)
      expect(comparable(p)).toEqual(comparable(expected[i]!))
    })
  })

  it(`HC18 playedAt 不換算時區（目前 TZ=${process.env.TZ ?? '未設定'}；test:tz 以多個時區執行，結果必須相同）`, () => {
    const hand = example79Hand({ playedAt: '2026-11-01T01:30:00' })
    const [parsed] = okHands(parsePokerStars(exportPokerStars([hand])).hands)
    expect(parsed!.playedAt).toBe('2026-11-01T01:30:00')
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBeTruthy()
  })

  it('HC18 金額單位還原：錦標賽 → chip、全部無小數 → yuan、全部 2 位小數 → cent', () => {
    const parse = (h: Hand) => okHands(parsePokerStars(exportPokerStars([h])).hands)[0]!
    expect(parse(hc9Hand()).amountUnit).toBe('chip')
    expect(parse(example79Hand()).amountUnit).toBe('yuan')
    expect(parse(ggCentHand()).amountUnit).toBe('cent')
  })

  it('9 節 名稱還原：Hero 依 Dealt to 判定；Villain<n> 為 null；其他名稱依 7.3 寫入條件存入 Seat.name', () => {
    const [gg] = okHands(parsePokerStars(exportPokerStars([ggCentHand()])).hands)
    expect(gg!.detail.seats.map((s) => s.name)).toEqual(['7f3a9c21', null, 'b04e5d18', '2c8e6f07', 'e91d4a3b', '5a6b7c8d'])
    expect(gg!.detail.heroSeat).toBe(2)
    const [custom] = okHands(parsePokerStars(exportPokerStars([example79Hand()], 'Din_0326')).hands)
    expect(custom!.heroName).toBe('Din_0326')
    expect(custom!.detail.heroSeat).toBe(4)
    expect(custom!.detail.seats.every((s) => s.name === null)).toBe(true)
  })

  it('7.9 fixture 原文可直接解析，結果與 7.9 輸入 JSON 相同', () => {
    const [parsed] = okHands(parsePokerStars(readFileSync(FIXTURE, 'utf8')).hands)
    expect(comparable(parsed!)).toEqual(comparable(example79Hand()))
    expect(parsed!.exportSeq).toBe(1)
  })
})

describe('9 節 解析器：白名單逐行解析，遇到未知或不一致的內容明確拒絕（第 N 行）', () => {
  const fixture = () => readFileSync(FIXTURE, 'utf8')
  const lines = () => fixture().split('\n')
  const withLines = (edit: (l: string[]) => void) => {
    const l = lines()
    edit(l)
    return l.join('\n')
  }
  const errorOf = (text: string) => {
    const [r] = parsePokerStars(text).hands
    if (!r || r.ok) throw new Error('expected failure')
    return r.error
  }

  it('未知行：插入 1 行無法辨識的內容 → unrecognizedLine，行號為該手內的行號', () => {
    expect(errorOf(withLines((l) => l.splice(12, 0, 'Villain1: is sitting out')))).toEqual({ code: 'unrecognizedLine', line: 13 })
    expect(errorOf(withLines((l) => l.splice(3, 0, 'Seat 7: Villain7 is sitting out')))).toEqual({ code: 'unrecognizedLine', line: 4 })
    // 手牌中間的空行也是未知內容
    expect(errorOf(withLines((l) => l.splice(20, 0, '')))).toEqual({ code: 'unrecognizedLine', line: 21 })
  })

  it('標頭、牌桌行不符合 7.7 格式 → 第 1、2 行', () => {
    expect(errorOf(fixture().replace(':  Hold', ': Hold'))).toEqual({ code: 'unrecognizedLine', line: 1 })
    expect(errorOf(fixture().replace('21:15:00', '21:15:00 ET'))).toEqual({ code: 'unrecognizedLine', line: 1 })
    expect(errorOf(fixture().replace('#7700000000000001', '#123456789012'))).toEqual({ code: 'unrecognizedLine', line: 1 })
    expect(errorOf(fixture().replace('2026/09/30', '2026/02/30'))).toEqual({ code: 'unrecognizedLine', line: 1 })
    expect(errorOf(fixture().replace("Table 'PokerRoad'", "Table 'Other'"))).toEqual({ code: 'unrecognizedLine', line: 2 })
  })

  it('牌面 `10h` 等非 3.6 編碼 → 無法辨識', () => {
    expect(errorOf(fixture().replace('Dealt to Hero [As Ks]', 'Dealt to Hero [As 10s]'))).toEqual({ code: 'unrecognizedLine', line: 12 })
  })

  it('同一手金額格式不一致（混用整數與 2 位小數、3 位小數）→ amountFormatMismatch', () => {
    expect(errorOf(fixture().replace('Villain6: calls $300', 'Villain6: calls $300.00'))).toEqual({ code: 'amountFormatMismatch', line: 18 })
    expect(errorOf(fixture().replace('($20000 in chips)', '($200.005 in chips)'))).toEqual({ code: 'amountFormatMismatch', line: 3 })
    const cent = exportPokerStars([ggCentHand()])
    expect(errorOf(cent.replace('$31.20 in chips', '$31.2 in chips'))).toEqual({ code: 'amountFormatMismatch', line: 5 })
    // 錦標賽金額不得帶 $
    const mtt = exportPokerStars([hc9Hand()])
    expect(errorOf(mtt.replace('Seat 2: Villain2 (10000 in chips)', 'Seat 2: Villain2 ($10000 in chips)'))).toEqual({ code: 'amountFormatMismatch', line: 4 })
  })

  it('行動金額、全下標記與重播不符 → illegalAction', () => {
    expect(errorOf(fixture().replace('Villain6: calls $300', 'Villain6: calls $400'))).toEqual({ code: 'illegalAction', line: 18 })
    expect(errorOf(fixture().replace('Hero: raises $300 to $500', 'Hero: raises $200 to $500'))).toEqual({ code: 'illegalAction', line: 16 })
    expect(errorOf(fixture().replace('raises $14300 to $15900 and is all-in', 'raises $14300 to $15900'))).toEqual({ code: 'illegalAction', line: 26 })
    expect(errorOf(fixture().replace('Hero: calls $14300', 'Hero: calls $14300 and is all-in'))).toEqual({ code: 'illegalAction', line: 27 })
    // 不是輪到的玩家
    expect(errorOf(withLines((l) => ([l[15], l[16]] = [l[16]!, l[15]!])))).toEqual({ code: 'illegalAction', line: 16 })
  })

  it('名稱不在座位行 → unknownPlayer；座位名稱重複 → duplicatePlayer', () => {
    expect(errorOf(fixture().replace('Villain1: folds', 'Villain9: folds'))).toEqual({ code: 'unknownPlayer', line: 13 })
    expect(errorOf(fixture().replace('Seat 2: Villain2 ($20000', 'Seat 2: Villain1 ($20000'))).toEqual({ code: 'duplicatePlayer', line: 4 })
  })

  it('盲注座位或金額與 4.1 推導不符 → blindMismatch', () => {
    expect(errorOf(fixture().replace('Villain5: posts small blind $100', 'Villain4: posts small blind $100'))).toEqual({ code: 'unknownPlayer', line: 9 })
    expect(errorOf(fixture().replace('Villain5: posts small blind $100', 'Villain6: posts small blind $100'))).toEqual({ code: 'blindMismatch', line: 9 })
    expect(errorOf(fixture().replace('posts big blind $200', 'posts big blind $300'))).toEqual({ code: 'blindMismatch', line: 10 })
  })

  it('底池、抽水與收回對不上 → potMismatch', () => {
    expect(errorOf(fixture().replace('Total pot $34300 | Rake $400', 'Total pot $34400 | Rake $400'))).toEqual({ code: 'potMismatch', line: 34 })
    expect(errorOf(fixture().replace('Hero collected $33900 from pot', 'Hero collected $33800 from pot'))).toEqual({ code: 'potMismatch', line: 34 })
  })

  it('收回的池別與 4.6 切出的池數不符 → collectedMismatch', () => {
    expect(errorOf(fixture().replace('Hero collected $33900 from pot', 'Hero collected $33900 from main pot'))).toEqual({ code: 'collectedMismatch', line: 32 })
  })

  it('公牌：轉牌行前段與翻牌不同、摘要 Board 與各街不同 → boardMismatch；同一張牌重複 → duplicateCard', () => {
    expect(errorOf(fixture().replace('*** TURN *** [Kh 7d 2c] [9s]', '*** TURN *** [Kh 7d 3c] [9s]'))).toEqual({ code: 'boardMismatch', line: 23 })
    expect(errorOf(fixture().replace('Board [Kh 7d 2c 9s 3h]', 'Board [Kh 7d 2c 9s 4h]'))).toEqual({ code: 'boardMismatch', line: 35 })
    const dup = fixture().replaceAll('Kd Qs', 'Kh Qs')
    expect(errorOf(dup)).toEqual({ code: 'duplicateCard', line: 12 })
  })

  it('未跟注退回與 4.5 不符 → refundMismatch', () => {
    const walk = exportPokerStars([buildHand({ detail: hc2Detail() })])
    expect(errorOf(walk.replace('Uncalled bet ($100) returned to Villain6', 'Uncalled bet ($150) returned to Villain6'))).toMatchObject({ code: 'refundMismatch' })
    expect(errorOf(walk.replace('Uncalled bet ($100) returned to Villain6\n', ''))).toMatchObject({ code: 'refundMismatch' })
  })

  it('缺少攤牌標記、沒有攤牌卻有攤牌標記、內容不完整', () => {
    expect(errorOf(fixture().replace('*** SHOW DOWN ***\n', ''))).toMatchObject({ code: 'unrecognizedLine' })
    expect(errorOf(fixture().split('*** SUMMARY ***')[0]!)).toMatchObject({ code: 'incomplete' })
    const walk = exportPokerStars([buildHand({ detail: hc2Detail() })])
    expect(errorOf(walk.replace('Villain6 collected $200 from pot', '*** SHOW DOWN ***\nVillain6 collected $200 from pot'))).toMatchObject({ code: 'unrecognizedLine' })
  })

  it('摘要行文字與重算結果不一致 → contentMismatch（第 N 行）', () => {
    expect(errorOf(fixture().replace("Seat 1: Villain1 folded before Flop (didn't bet)", 'Seat 1: Villain1 folded before Flop'))).toEqual({ code: 'contentMismatch', line: 36 })
    expect(errorOf(fixture().replace('Villain6: shows [Kd Qs] (a pair of Kings)', 'Villain6: shows [Kd Qs] (two pair, Kings and Queens)'))).toEqual({ code: 'contentMismatch', line: 30 })
    // 亮牌順序不同
    expect(errorOf(withLines((l) => ([l[29], l[30]] = [l[30]!, l[29]!])))).toEqual({ code: 'contentMismatch', line: 30 })
  })

  it('第一手之前的非空白內容 → 以一筆失敗回報；其他手牌照常解析', () => {
    const result = parsePokerStars(`garbage\n\n${fixture()}`)
    expect(result.hands).toHaveLength(2)
    expect(result.hands[0]).toMatchObject({ ok: false, error: { code: 'unrecognizedLine', line: 1 } })
    expect(result.hands[1]!.ok).toBe(true)
  })

  it('多手檔案中一手不合法時，其他手牌仍解析成功；失敗的手回報該手內的行號與起始行', () => {
    const a = example79Hand({ exportSeq: 1 })
    const b = example79Hand({ exportSeq: 2, playedAt: '2026-10-01T10:00:00' })
    const text = exportPokerStars([a, b]).replace('PokerStars Hand #7700000000000002:  Hold', 'PokerStars Hand #7700000000000002: Hold')
    const [ra, rb] = parsePokerStars(text).hands
    expect(ra!.ok).toBe(true)
    expect(rb).toMatchObject({ ok: false, error: { code: 'unrecognizedLine', line: 1 }, startLine: 44 })
  })

  it('BOM 與 \\r\\n 換行正規化後可解析；空字串為 0 手', () => {
    const crlf = String.fromCharCode(0xfeff) + fixture().replaceAll('\n', '\r\n')
    expect(okHands(parsePokerStars(crlf).hands)).toHaveLength(1)
    expect(parsePokerStars('').hands).toEqual([])
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('splitHands：以開頭行拆手並去除前後空行', () => {
    const r = splitHands('noise\n\nH 1\nx\n\n\nH 2\ny\n\n', (l) => l.startsWith('H '))
    expect(r.leading).toEqual([{ line: 1, text: 'noise' }])
    expect(r.hands).toEqual([
      { startLine: 3, lines: ['H 1', 'x'] },
      { startLine: 7, lines: ['H 2', 'y'] },
    ])
  })

  it('解析結果重算的文字與原文相同（單手）', () => {
    const hand = hc9Hand()
    const text = exportHandText(hand)
    const [parsed] = okHands(parsePokerStars(text).hands)
    expect(parsed!.amountUnit).toBe('chip')
  })
})
