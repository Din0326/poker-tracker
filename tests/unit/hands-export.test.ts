// SPEC-v2-hands 12.3 H3：PokerStars 匯出（第 7 節）。HC17、HC25、HC26（編號格式）、HC28、HC29（匯出部分）、
// HC2、HC7、HC8、HC9、HC16 的匯出部分，以及 11.1「10,000 手組文字 ≤ 3 秒」。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXPORT_LIMIT,
  exportHandText,
  exportNames,
  exportPokerStars,
  formatExportAmount,
  formatExportTime,
  formatHandNumber,
  handsExportFileName,
  isExportable,
  isLikelySupportedByGtoWizard,
  singleHandExportFileName,
  sortHandsForExport,
  type Hand,
  type HandDetail,
} from '../../src/domain/hands'
import { hc2Detail, hc5Detail, hc6Detail, muckDetail, runoutBoard } from './helpers/handCases'
import { EXAMPLE_79_BOARD, act, buildHand, detail, example79Detail, example79Hand, seat } from './helpers/hands'
import { ggCentHand, hc7Hand, hc8Hand, hc9Hand, multiSidePotHand, tenMaxHand } from './helpers/exportCases'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'hands', 'export-example-1.txt')

const linesOf = (text: string) => text.split('\n')

describe('HC17 匯出模板：7.9 輸入 → 輸出與 fixture export-example-1.txt 逐行完全相同', () => {
  it('HC17 逐行比對（含空格）、整份檔案逐字元相同（以 \\n 結尾、無 BOM）', () => {
    const fixture = readFileSync(FIXTURE, 'utf8')
    const out = exportPokerStars([example79Hand()])
    const expected = linesOf(fixture)
    const actual = linesOf(out)
    expect(actual.length).toBe(expected.length)
    actual.forEach((line, i) => expect(line, `第 ${i + 1} 行`).toBe(expected[i]))
    expect(out).toBe(fixture)
    expect(out.charCodeAt(0)).not.toBe(0xfeff)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
    expect(out.includes('\r')).toBe(false)
    // 7.2：內容只有 ASCII
    expect(/^[\x20-\x7e\n]*$/.test(out)).toBe(true)
  })

  it('HC17 handHeroName 未設定（undefined）與 `Hero` 結果相同', () => {
    expect(exportPokerStars([example79Hand()], undefined)).toBe(exportPokerStars([example79Hand()], 'Hero'))
  })

  it('7.2 多手：前一手最後一行之後空兩行再接下一手；最後一手之後單一 \\n', () => {
    const a = example79Hand({ exportSeq: 1 })
    const b = example79Hand({ exportSeq: 2, playedAt: '2026-09-30T22:00:00' })
    const out = exportPokerStars([b, a])
    const single = exportHandText(a)
    expect(out.startsWith(`${single}\n\n\nPokerStars Hand #7700000000000002:`)).toBe(true)
    expect(out.endsWith('with a pair of Kings\n')).toBe(true)
    expect(out.split('\n\n\n')).toHaveLength(2)
  })

  it('0 手時輸出空字串', () => {
    expect(exportPokerStars([])).toBe('')
  })
})

describe('7.1 匯出範圍與順序', () => {
  it('依 playedAt 由舊到新，同時間依 exportSeq 由小到大', () => {
    const hands = [
      { id: 'c', playedAt: '2026-09-30T21:15:00', exportSeq: 9 },
      { id: 'a', playedAt: '2026-09-29T21:15:00', exportSeq: 10 },
      { id: 'b', playedAt: '2026-09-30T21:15:00', exportSeq: 3 },
    ]
    expect(sortHandsForExport(hands).map((h) => h.id)).toEqual(['a', 'b', 'c'])
  })

  it('只有完整手牌可匯出；簡易備忘與未完成的完整紀錄都不可', () => {
    expect(isExportable(example79Hand())).toBe(true)
    expect(isExportable(buildHand({ detail: null, heroCards: ['As', 'Ks'] }))).toBe(false)
    const unfinished = buildHand({ detail: { ...example79Detail(), actions: example79Detail().actions.slice(0, 3), collected: [] } })
    expect(unfinished.kind).toBe('simple')
    expect(isExportable(unfinished)).toBe(false)
    expect(() => exportHandText(unfinished)).toThrow()
  })

  it('HQ28 單次匯出上限 10,000 手', () => {
    expect(EXPORT_LIMIT).toBe(10_000)
  })
})

describe('7.2 檔名', () => {
  it('多手 poker-hands-YYYYMMDD-HHmm.txt（本地時間）；單手 poker-hand-<匯出編號>.txt', () => {
    expect(handsExportFileName(new Date(2026, 0, 5, 9, 7))).toBe('poker-hands-20260105-0907.txt')
    expect(handsExportFileName(new Date(2026, 9, 1, 21, 45))).toBe('poker-hands-20261001-2145.txt')
    expect(singleHandExportFileName(1)).toBe('poker-hand-7700000000000001.txt')
  })
})

describe('HC25 匯出時間（不換算）', () => {
  it('HC25 YYYY/MM/DD HH:mm:ss，補零、不換算、無時區後綴', () => {
    expect(formatExportTime('2026-09-30T21:15:00')).toBe('2026/09/30 21:15:00')
    expect(formatExportTime('2026-01-05T09:05:00')).toBe('2026/01/05 09:05:00')
    expect(formatExportTime('2026-11-01T01:30:00')).toBe('2026/11/01 01:30:00')
  })

  it(`HC25 標頭行不含 ET、UTC 或任何時區後綴，且與裝置時區無關（目前 TZ=${process.env.TZ ?? '未設定'}）`, () => {
    for (const playedAt of ['2026-09-30T21:15:00', '2026-01-05T09:05:00', '2026-11-01T01:30:00', '2026-03-08T02:30:00']) {
      const header = linesOf(exportHandText(example79Hand({ playedAt })))[0]!
      expect(header.endsWith(` - ${formatExportTime(playedAt)}`)).toBe(true)
      expect(header).not.toMatch(/\b(ET|EST|EDT|UTC|GMT|CST|JST)\b|[+-]\d{2}:?\d{2}$/)
    }
    // 7.9 範例的固定期望：不論 vitest 以哪個 TZ 執行（npm run test:tz）都相同
    expect(linesOf(exportHandText(example79Hand()))[0]).toBe("PokerStars Hand #7700000000000001:  Hold'em No Limit ($100/$200) - 2026/09/30 21:15:00")
  })
})

describe('HC26 手牌編號（格式）', () => {
  it('HC26 exportSeq 1 → 7700000000000001；99,999,999,999,999 → 7799999999999999', () => {
    expect(formatHandNumber(1)).toBe('7700000000000001')
    expect(formatHandNumber(99_999_999_999_999)).toBe('7799999999999999')
    expect(formatHandNumber(12345)).toBe('7700000000012345')
    expect(formatHandNumber(99_999_999_999_999).length).toBe(16)
  })

  it('HC26 標頭使用該手的 exportSeq；錦標賽的賽事編號與桌名使用同一個 16 位編號', () => {
    expect(linesOf(exportHandText(example79Hand({ exportSeq: 42 })))[0]).toMatch(/^PokerStars Hand #7700000000000042: /)
    const lines = linesOf(exportHandText(hc9Hand({ exportSeq: 7 })))
    expect(lines[0]).toMatch(/^PokerStars Hand #7700000000000007: Tournament #7700000000000007, /)
    expect(lines[1]).toBe("Table '7700000000000007 1' 8-max Seat #1 is the button")
  })
})

describe('HC29 金額格式依單位（匯出部分）', () => {
  it('HC29 元單位 `$` + 整數、無千分位、無小數', () => {
    expect(formatExportAmount(100, 'yuan')).toBe('$100')
    expect(formatExportAmount(200, 'yuan')).toBe('$200')
    expect(formatExportAmount(16800, 'yuan')).toBe('$16800')
    expect(formatExportAmount(0, 'yuan')).toBe('$0')
  })

  it('HC29 分單位固定 2 位小數、無千分位', () => {
    expect(formatExportAmount(5, 'cent')).toBe('$0.05')
    expect(formatExportAmount(100, 'cent')).toBe('$1.00')
    expect(formatExportAmount(123456, 'cent')).toBe('$1234.56')
    expect(formatExportAmount(1234567, 'cent')).toBe('$12345.67')
    expect(formatExportAmount(0, 'cent')).toBe('$0.00')
    expect(formatExportAmount(999_999_990_0, 'cent')).toBe('$99999999.00')
  })

  it('HC29 籌碼單位整數，無 `$`', () => {
    expect(formatExportAmount(1500, 'chip')).toBe('1500')
    expect(formatExportAmount(0, 'chip')).toBe('0')
  })

  it('HC29 元單位 sb 100 / bb 200 的手牌匯出 `($100/$200)` 與 `$16800`（Hero 淨贏的那一手）', () => {
    const out = exportHandText(example79Hand())
    expect(out).toContain('($100/$200)')
    const won = buildHand({
      detail: { ...example79Detail(), rake: 0 },
      board: EXAMPLE_79_BOARD,
    })
    expect(exportHandText(won)).toContain('Hero collected $34300 from pot')
    // 16800 元寫成 $16800（無千分位）
    const stacks = buildHand({ detail: { ...example79Detail(), seats: example79Detail().seats.map((s) => (s.seatNo === 1 ? { ...s, stack: 16800 } : s)) }, board: EXAMPLE_79_BOARD })
    expect(exportHandText(stacks)).toContain('Seat 1: Villain1 ($16800 in chips)')
  })

  it('HC29 分單位手牌（GG 匯入）整手 2 位小數：標頭 `($0.10/$0.25)`、`Rake $0.44`', () => {
    const lines = linesOf(exportHandText(ggCentHand()))
    expect(lines[0]).toBe("PokerStars Hand #7700000000000003:  Hold'em No Limit ($0.10/$0.25) - 2026/09/20 22:05:13")
    expect(lines).toContain('Seat 3: b04e5d18 ($31.20 in chips)')
    expect(lines).toContain('e91d4a3b: raises $0.40 to $0.65')
    expect(lines).toContain('Uncalled bet ($3.75) returned to Hero')
    expect(lines).toContain('Hero collected $7.31 from pot')
    expect(lines).toContain('Total pot $7.75 | Rake $0.44')
    expect(lines).toContain('Seat 2: Hero (small blind) collected ($7.31)')
  })

  it('HC29 rake 0：元單位 `Rake $0`、分單位 `Rake $0.00`、錦標賽 `Rake 0`', () => {
    expect(exportHandText(buildHand({ detail: hc2Detail() }))).toContain('Total pot $200 | Rake $0')
    expect(exportHandText(ggCentHand({ rake: 0, collected: [{ seatNo: 2, potIndex: 0, amount: 775 }] }))).toContain('Total pot $7.75 | Rake $0.00')
    expect(exportHandText(hc9Hand())).toContain('| Rake 0')
  })

  it('一個檔案內不同單位的手牌各自依自己的單位輸出', () => {
    const out = exportPokerStars([example79Hand(), ggCentHand(), hc9Hand()])
    expect(out).toContain('($100/$200)')
    expect(out).toContain('($0.10/$0.25)')
    expect(out).toContain('Level I (100/200)')
  })
})

describe('HC2 BB walk（匯出部分）', () => {
  it('HC2 含退回、收回、Total pot 行；無 SHOW DOWN、無 Board 行', () => {
    const hand = buildHand({ detail: hc2Detail() })
    expect(hand.kind).toBe('complete')
    const lines = linesOf(exportHandText(hand))
    expect(lines).toContain('Uncalled bet ($100) returned to Villain6')
    expect(lines).toContain('Villain6 collected $200 from pot')
    expect(lines).toContain('Total pot $200 | Rake $0')
    expect(lines).not.toContain('*** SHOW DOWN ***')
    expect(lines.some((l) => l.startsWith('Board '))).toBe(false)
    // 7.7 第 16、20 行的位置：退回緊接在最後一筆行動之後，收回緊接在退回之後
    const i = lines.indexOf('Villain5: folds')
    expect(lines.slice(i, i + 4)).toEqual(['Villain5: folds', 'Uncalled bet ($100) returned to Villain6', 'Villain6 collected $200 from pot', '*** SUMMARY ***'])
    expect(lines.slice(-6)).toEqual([
      "Seat 1: Villain1 folded before Flop (didn't bet)",
      "Seat 2: Villain2 folded before Flop (didn't bet)",
      "Seat 3: Villain3 folded before Flop (didn't bet)",
      "Seat 4: Hero (button) folded before Flop (didn't bet)",
      'Seat 5: Villain5 (small blind) folded before Flop',
      'Seat 6: Villain6 (big blind) collected ($200)',
    ])
  })
})

describe('HC7 2 人桌（匯出部分）', () => {
  it('HC7 按鈕放小盲；摘要按鈕行為 `(button) (small blind)`、大盲 `(big blind)`', () => {
    const lines = linesOf(exportHandText(hc7Hand()))
    expect(lines[1]).toBe("Table 'PokerRoad' 2-max Seat #1 is the button")
    expect(lines).toContain('Hero: posts small blind $100')
    expect(lines).toContain('Villain2: posts big blind $200')
    // 翻前按鈕（小盲）先行動，翻牌起座位 2 先行動
    const hole = lines.indexOf('Dealt to Hero [Ah Kh]')
    expect(lines[hole + 1]).toMatch(/^Hero: /)
    const flop = lines.findIndex((l) => l.startsWith('*** FLOP ***'))
    expect(lines[flop + 1]).toMatch(/^Villain2: /)
    expect(lines.some((l) => l.startsWith('Seat 1: Hero (button) (small blind) '))).toBe(true)
    expect(lines.some((l) => l.startsWith('Seat 2: Villain2 (big blind) '))).toBe(true)
  })
})

describe('HC8 straddle（匯出部分）', () => {
  it('HC8 含 `posts straddle $400`，在大盲之後；straddle 不加位置標記', () => {
    const lines = linesOf(exportHandText(hc8Hand()))
    const bb = lines.indexOf('Villain3: posts big blind $200')
    expect(bb).toBeGreaterThan(0)
    expect(lines[bb + 1]).toBe('Villain4: posts straddle $400')
    expect(lines[bb + 2]).toBe('*** HOLE CARDS ***')
    expect(lines.find((l) => l.startsWith('Seat 4: Villain4 '))).not.toMatch(/\(button\)|\(small blind\)|\(big blind\)|straddle/)
  })
})

describe('HC9 錦標賽前注（匯出部分）', () => {
  it('HC9 金額為籌碼整數、無 `$`；8 行 `posts the ante 25` 在盲注行之前；Rake 0', () => {
    const hand = hc9Hand()
    expect(hand.amountUnit).toBe('chip')
    const text = exportHandText(hand)
    const lines = linesOf(text)
    expect(lines[0]).toBe("PokerStars Hand #7700000000000001: Tournament #7700000000000001, $0+$0 USD Hold'em No Limit - Level I (100/200) - 2026/09/30 21:15:00")
    const antes = lines.filter((l) => l.endsWith(': posts the ante 25'))
    expect(antes).toHaveLength(8)
    expect(antes.map((l) => l.split(':')[0])).toEqual(['Hero', 'Villain2', 'Villain3', 'Villain4', 'Villain5', 'Villain6', 'Villain7', 'Villain8'])
    const firstAnte = lines.indexOf(antes[0]!)
    const sb = lines.findIndex((l) => l.includes('posts small blind'))
    expect(sb).toBe(firstAnte + 8)
    expect(lines[sb]).toBe('Villain2: posts small blind 100')
    expect(lines[sb + 1]).toBe('Villain3: posts big blind 200')
    // 籌碼單位：`$` 只出現在錦標賽標頭固定的 `$0+$0 USD`
    expect(lines.slice(1).some((l) => l.includes('$'))).toBe(false)
    expect(lines).toContain('Seat 1: Hero (1500 in chips)')
    expect(text).toContain('| Rake 0')
  })
})

describe('HC16 Hero 名稱（匯出部分）', () => {
  it('HC16 合法名稱 `Din_0326`、`A` 用於 Seat、行動、Dealt to 與摘要', () => {
    for (const name of ['Din_0326', 'A']) {
      const lines = linesOf(exportPokerStars([example79Hand()], name))
      expect(lines).toContain(`Seat 4: ${name} ($20000 in chips)`)
      expect(lines).toContain(`Dealt to ${name} [As Ks]`)
      expect(lines).toContain(`${name}: raises $300 to $500`)
      expect(lines).toContain(`Seat 4: ${name} (button) showed [As Ks] and won ($33900) with a pair of Kings`)
      expect(lines.some((l) => l.includes('Hero'))).toBe(false)
    }
  })

  it('HC16 不合法的名稱（`1abc`、`Din:1`、`[Hero]`、中文、含空白、13 字元、`villain3`）不寫入檔案，退回 `Hero`', () => {
    for (const bad of ['1abc', 'Din:1', '[Hero]', '有中文', 'Hero Name', 'A234567890123', 'villain3']) {
      expect(exportPokerStars([example79Hand()], bad)).toBe(exportPokerStars([example79Hand()]))
    }
  })

  it('7.3 對手名稱：預設 Villain<座位號>；Seat.name 沿用；與 Hero 或彼此衝突（不分大小寫）時後者改用 Villain<座位號>', () => {
    const d: Pick<HandDetail, 'seats' | 'heroSeat'> = {
      heroSeat: 2,
      seats: [
        { ...seat(1, 100), name: 'din_0326' },
        seat(2, 100),
        { ...seat(3, 100), name: 'abc' },
        { ...seat(4, 100), name: 'ABC' },
        seat(5, 100),
      ],
    }
    expect([...exportNames(d, 'Din_0326').entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 'Villain1'],
      [2, 'Din_0326'],
      [3, 'abc'],
      [4, 'Villain4'],
      [5, 'Villain5'],
    ])
  })
})

describe('HC28 GTO Wizard 判斷', () => {
  const h = (gameType: 'cash' | 'tournament', tableSize: number, ante = 0, straddle = 0) => ({ gameType, detail: { tableSize, ante, straddle } })
  it('HC28 7.8 表格每列各一手為 true', () => {
    expect(isLikelySupportedByGtoWizard(h('cash', 6))).toBe(true)
    expect(isLikelySupportedByGtoWizard(h('cash', 6, 50, 400))).toBe(true)
    expect(isLikelySupportedByGtoWizard(h('cash', 8, 50, 400))).toBe(true)
    expect(isLikelySupportedByGtoWizard(h('cash', 2))).toBe(true)
    expect(isLikelySupportedByGtoWizard(h('tournament', 8, 25))).toBe(true)
    expect(isLikelySupportedByGtoWizard(h('tournament', 3))).toBe(true)
    expect(isLikelySupportedByGtoWizard(h('tournament', 2))).toBe(true)
  })

  it('HC28 9-max 現金桌、6-max 只有前注、tournament 6 人各一手為 false', () => {
    expect(isLikelySupportedByGtoWizard(h('cash', 9))).toBe(false)
    expect(isLikelySupportedByGtoWizard(h('cash', 6, 50, 0))).toBe(false)
    expect(isLikelySupportedByGtoWizard(h('tournament', 6))).toBe(false)
    // 其他組合：8-max 無 straddle、6-max 只有 straddle、10-max
    expect(isLikelySupportedByGtoWizard(h('cash', 8))).toBe(false)
    expect(isLikelySupportedByGtoWizard(h('cash', 6, 0, 400))).toBe(false)
    expect(isLikelySupportedByGtoWizard(h('cash', 10))).toBe(false)
    expect(isLikelySupportedByGtoWizard({ gameType: 'cash', detail: null })).toBe(false)
  })

  it('HC28 以實際手牌判斷：7.9 範例（6-max）true、10 人桌 false、HC9（8 人錦標賽）true', () => {
    expect(isLikelySupportedByGtoWizard(example79Hand())).toBe(true)
    expect(isLikelySupportedByGtoWizard(tenMaxHand())).toBe(false)
    expect(isLikelySupportedByGtoWizard(hc9Hand())).toBe(true)
  })
})

describe('7.7 其他模板列', () => {
  it('HC5 三人邊池：自動發完的街照常輸出；邊池行先輸出、主池最後；Total pot 含 Main pot / Side pot', () => {
    const hand = buildHand({ detail: hc5Detail(300), board: runoutBoard })
    const lines = linesOf(exportHandText(hand))
    // BB 已放 200，跟注 2800 到 3000；起始 5000，不是全下
    const call = lines.indexOf('Villain3: calls $2800')
    expect(call).toBeGreaterThan(0)
    expect(lines.slice(call + 1, call + 5)).toEqual([
      '*** FLOP *** [2c 7d 9h]',
      '*** TURN *** [2c 7d 9h] [Js]',
      '*** RIVER *** [2c 7d 9h Js] [4c]',
      '*** SHOW DOWN ***',
    ])
    expect(lines).toContain('Hero: raises $800 to $1000 and is all-in')
    expect(lines).toContain('Villain2: raises $2000 to $3000 and is all-in')
    // 亮牌順序：最後的加注者（座位 2）先亮，之後順時針
    expect(lines.filter((l) => l.includes(': shows ['))).toEqual([
      'Villain2: shows [Kh Kd] (a pair of Kings)',
      'Villain3: shows [Qh Qd] (a pair of Queens)',
      'Hero: shows [Ah Ad] (a pair of Aces)',
    ])
    expect(lines.filter((l) => l.includes(' collected '))).toEqual(['Villain2 collected $4000 from side pot', 'Hero collected $2700 from main pot'])
    expect(lines).toContain('Total pot $7000 Main pot $2700. Side pot $4000. | Rake $300')
    expect(lines).toContain('Seat 1: Hero (button) showed [Ah Ad] and won ($2700) with a pair of Aces')
    expect(lines).toContain('Seat 3: Villain3 (big blind) showed [Qh Qd] and lost with a pair of Queens')
  })

  it('兩個以上邊池：`side pot-1`、`side pot-2`，由最後的邊池往前，主池最後', () => {
    const hand = multiSidePotHand()
    const lines = linesOf(exportHandText(hand))
    expect(lines.filter((l) => l.includes(' collected '))).toEqual([
      'Villain3 collected $2000 from side pot-2',
      'Villain2 collected $3000 from side pot-1',
      'Villain2 collected $4000 from main pot',
    ])
    expect(lines).toContain('Villain4: raises $4800 to $5000 and is all-in')
    expect(lines).toContain('Uncalled bet ($2000) returned to Villain4')
    expect(lines).toContain('Seat 2: Villain2 (small blind) showed [Ah Ad] and won ($7000) with a pair of Aces')
    expect(lines).toContain('Total pot $9000 Main pot $4000. Side pot-1 $3000. Side pot-2 $2000. | Rake $0')
  })

  it('HC6 平分：每位贏家一行，依座位順時針（從按鈕下一位起），摘要各自的收回金額', () => {
    const hand = buildHand({ detail: hc6Detail(25, 50), board: ['Ts', 'Js', 'Qs', 'Ks', 'As'] })
    const lines = linesOf(exportHandText(hand))
    expect(lines.filter((l) => l.includes(' collected '))).toEqual(['Villain3 collected $63 from pot', 'Hero collected $62 from pot'])
    expect(lines).toContain('Hero: shows [2c 3d] (a Royal Flush)')
    expect(lines).toContain('Seat 1: Hero (button) showed [2c 3d] and won ($62) with a Royal Flush')
    expect(lines).toContain('Seat 2: Villain2 (small blind) folded before Flop')
    // 所有街都沒有下注：從按鈕順時針下一位攤牌者（座位 3）開始亮牌
    expect(lines.filter((l) => l.includes(': shows ['))[0]).toBe('Villain3: shows [4h 5c] (a Royal Flush)')
  })

  it('對手蓋牌：`mucks hand`、摘要 `mucked`', () => {
    const hand = buildHand({ detail: muckDetail(), board: EXAMPLE_79_BOARD })
    const lines = linesOf(exportHandText(hand))
    expect(lines.slice(lines.indexOf('*** SHOW DOWN ***') + 1, lines.indexOf('*** SHOW DOWN ***') + 3)).toEqual([
      'Hero: shows [Ah Ad] (a pair of Aces)',
      'Villain2: mucks hand',
    ])
    expect(lines).toContain('Seat 2: Villain2 (big blind) mucked')
  })

  it('翻牌後棄牌、翻前平跟後棄牌的摘要文字', () => {
    const d = detail({
      tableSize: 4,
      buttonSeat: 1,
      heroSeat: 1,
      seats: [seat(1, 20000, ['Ah', 'Kh']), seat(2, 20000), seat(3, 20000), seat(4, 20000)],
      actions: [
        act('preflop', 4, 'call'),
        act('preflop', 1, 'raise', 800),
        act('preflop', 2, 'call'),
        act('preflop', 3, 'call'),
        act('preflop', 4, 'fold'),
        act('flop', 2, 'check'),
        act('flop', 3, 'bet', 400),
        act('flop', 1, 'raise', 1600),
        act('flop', 2, 'fold'),
        act('flop', 3, 'call'),
        act('turn', 3, 'check'),
        act('turn', 1, 'bet', 2000),
        act('turn', 3, 'fold'),
      ],
    })
    const hand = buildHand({ detail: d, board: ['2c', '7d', '9h', 'Js'] })
    expect(hand.kind).toBe('complete')
    const lines = linesOf(exportHandText(hand))
    expect(lines).toContain('Uncalled bet ($2000) returned to Hero')
    expect(lines.slice(-4)).toEqual([
      'Seat 1: Hero (button) collected ($5800)',
      'Seat 2: Villain2 (small blind) folded on the Flop',
      'Seat 3: Villain3 (big blind) folded on the Turn',
      'Seat 4: Villain4 folded before Flop',
    ])
  })
})

describe('11.1 匯出效能', () => {
  it('11.1 10,000 手組文字 ≤ 3 秒（Node）', () => {
    const base = [example79Hand(), buildHand({ detail: hc5Detail(300), board: runoutBoard }), hc9Hand(), hc8Hand()]
    const hands: Hand[] = Array.from({ length: EXPORT_LIMIT }, (_, i) => ({ ...base[i % base.length]!, exportSeq: i + 1 }))
    const t0 = performance.now()
    const out = exportPokerStars(hands)
    const ms = performance.now() - t0
    expect(out.split('\n\n\n')).toHaveLength(EXPORT_LIMIT)
    expect(ms).toBeLessThanOrEqual(3000)
  }, 30_000)
})
