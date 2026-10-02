// SPEC-v2-hands 12.3 H2：手牌列表（6.1）的排序、分組、彙總、篩選、單列顯示（HC29）與詳情逐街呈現（6.2）的顯示資料
import { describe, expect, it } from 'vitest'
import { evaluateHand, describeHandValueText, type Hand } from '../../src/domain/hands'
import { buildHandDetailView, handHeadlineResult, handSummaryText } from '../../src/features/hands/handDetailView'
import {
  DEFAULT_HAND_FILTERS,
  applyHandFilters,
  groupHandsByMonth,
  handResultText,
  handRowBadges,
  handRowTags,
  handRowTime,
  handRowTitle,
  isFilteringHands,
  signedTextClass,
  sortHandsNewestFirst,
  summarizeHandCount,
  tagFilterOptions,
  toHandListItem,
  type HandListFilters,
  type HandListItem,
} from '../../src/features/hands/handListModel'
import { scrollMemoryKey } from '../../src/lib/useScrollMemory'
import { strings } from '../../src/strings'
import { hc2Detail, hc5Detail, runoutBoard } from './helpers/handCases'
import { EXAMPLE_79_BOARD, act, buildHand, detail, example79Detail, example79Hand, seat } from './helpers/hands'

const SESSION = '00000000-0000-4000-8000-00000000c001'
const TODAY = '2026-10-01'

/** 簡易備忘手牌 */
function memo(patch: Partial<Hand> = {}): Hand {
  return buildHand({ detail: null, heroCards: ['Ah', 'Kd'], ...patch } as Parameters<typeof buildHand>[0], {
    ...(patch.createdAt ? { createdAt: patch.createdAt } : {}),
  })
}

/** 未完成的完整紀錄：只記到翻前 2 筆行動 */
function unfinished(patch: Partial<Hand> = {}): Hand {
  const d = example79Detail()
  const seats = d.seats.map((x) => (x.seatNo === 6 ? { ...x, cards: [] } : x))
  return buildHand({ detail: { ...d, seats, rake: 0, actions: d.actions.slice(0, 2) }, ...patch } as Parameters<typeof buildHand>[0])
}

function complete(patch: Partial<Hand> = {}): Hand {
  return buildHand({ detail: example79Detail(), board: [...EXAMPLE_79_BOARD], ...patch } as Parameters<typeof buildHand>[0])
}

function gg(patch: Partial<Hand> = {}): Hand {
  return buildHand({
    detail: { ...example79Detail(), rake: 44, collected: [{ seatNo: 4, potIndex: 0, amount: 34256 }] },
    board: [...EXAMPLE_79_BOARD],
    source: 'gg',
    ...patch,
  } as Parameters<typeof buildHand>[0])
}

const items = (hands: Hand[]) => hands.map(toHandListItem)
const filters = (patch: Partial<HandListFilters>): HandListFilters => ({ ...DEFAULT_HAND_FILTERS, ...patch })
const ids = (hands: readonly { id: string }[]) => hands.map((h) => h.id)

describe('12.3 H2 列表排序、月份分組、彙總（6.1）', () => {
  it('依 playedAt 由新到舊，同時間依 createdAt 由新到舊（含不同時區偏移）', () => {
    const a = memo({ playedAt: '2026-09-30T21:15:00', createdAt: '2026-09-30T22:00:00+08:00' })
    const b = memo({ playedAt: '2026-09-30T21:15:00', createdAt: '2026-09-30T15:30:00+00:00' }) // = 23:30 +08:00，較晚建立
    const c = memo({ playedAt: '2026-10-01T09:00:00' })
    const d = memo({ playedAt: '2026-08-31T23:55:00' })
    expect(ids(sortHandsNewestFirst([a, b, c, d]))).toEqual(ids([c, b, a, d]))
  })

  it('以 playedAt 的月份分組，標題「2026 年 9 月 · 42 手」；彙總「共 N 手（完整 M 手）」不含結果加總', () => {
    const sorted = sortHandsNewestFirst(
      items([
        complete({ playedAt: '2026-09-30T21:15:00' }),
        memo({ playedAt: '2026-09-02T10:00:00' }),
        unfinished({ playedAt: '2026-08-15T10:00:00' }),
      ]),
    )
    const groups = groupHandsByMonth(sorted)
    expect(groups.map((g) => [g.key, g.hands.length])).toEqual([
      ['2026-09', 2],
      ['2026-08', 1],
    ])
    expect(strings.hands.list.monthHeader(groups[0]!.year, groups[0]!.month, groups[0]!.hands.length)).toBe('2026 年 9 月 · 2 手')
    const total = summarizeHandCount(sorted)
    expect(total).toEqual({ count: 3, complete: 1 })
    const text = strings.hands.list.summary(total.count, total.complete)
    expect(text).toBe('共 3 手（完整 1 手）')
    // 4.13：不顯示結果加總
    expect(text).not.toMatch(/\$|bb|[+−]/)
  })
})

describe('12.3 H2 6.1 每種篩選、兩種同時套用、清除篩選', () => {
  const all = sortHandsNewestFirst(
    items([
      complete({ playedAt: '2026-09-30T21:15:00', tags: ['3bet', 'River'], note: '對手 overbet', sessionId: SESSION }),
      memo({ playedAt: '2026-09-20T20:00:00', heroPosition: 'CO', tags: ['bluff'], note: null }),
      unfinished({ playedAt: '2026-07-01T00:00:00', tags: ['3Bet'] }),
      gg({ playedAt: '2026-03-31T23:59:00' }),
      memo({ playedAt: '2026-06-30T23:59:00', heroPosition: null, note: '冷靜 Fold' }),
    ]),
  )
  const [c79, memoCo, unf, memoNone, ggHand] = all as [HandListItem, HandListItem, HandListItem, HandListItem, HandListItem]
  const run = (patch: Partial<HandListFilters>, sessionId: string | null = null) => ids(applyHandFilters(all, filters(patch), sessionId, TODAY).hands)

  it('期間：近三個月以 playedAt 的本地日期判斷（今天往前 3 個月的當天起），自訂兩端皆含', () => {
    expect(run({ period: 'last3Months' })).toEqual(ids([c79, memoCo, unf]))
    expect(run({ period: 'last6Months' })).toEqual(ids([c79, memoCo, unf, memoNone]))
    expect(run({ period: 'custom', from: '2026-03-31', to: '2026-06-30' })).toEqual(ids([memoNone, ggHand]))
    // 自訂起日晚於迄日：回報錯誤且不套用期間
    const bad = applyHandFilters(all, filters({ period: 'custom', from: '2026-09-01', to: '2026-08-01' }), null, TODAY)
    expect(bad.periodError).toBe('fromAfterTo')
    expect(bad.hands).toHaveLength(5)
  })

  it('紀錄類型：完整 / 簡易（簡易含未完成）', () => {
    expect(run({ kind: 'complete' })).toEqual(ids([c79, ggHand]))
    expect(run({ kind: 'simple' })).toEqual(ids([memoCo, unf, memoNone]))
  })

  it('來源：手動 / GG', () => {
    expect(run({ source: 'gg' })).toEqual(ids([ggHand]))
    expect(run({ source: 'manual' })).toEqual(ids([c79, memoCo, unf, memoNone]))
  })

  it('位置：10 種位置之一 / 未指定', () => {
    expect(run({ position: 'CO' })).toEqual(ids([memoCo]))
    expect(run({ position: 'BTN' })).toEqual(ids([c79, unf, ggHand]))
    expect(run({ position: 'none' })).toEqual(ids([memoNone]))
  })

  it('標籤：單選一個（不分大小寫）；選單依最近使用排序、去重保留最近寫法', () => {
    expect(run({ tag: '3bet' })).toEqual(ids([c79, unf]))
    expect(run({ tag: 'BLUFF' })).toEqual(ids([memoCo]))
    expect(tagFilterOptions(all)).toEqual(['3bet', 'River', 'bluff'])
  })

  it('關聯場次：有關聯 / 獨立；場次篩選（查看全部）只列該場', () => {
    expect(run({ link: 'linked' })).toEqual(ids([c79]))
    expect(run({ link: 'standalone' })).toEqual(ids([memoCo, unf, memoNone, ggHand]))
    expect(run({}, SESSION)).toEqual(ids([c79]))
  })

  it('關鍵字：比對 note 與 tags，不分大小寫、部分符合', () => {
    expect(run({ keyword: 'OVERBET' })).toEqual(ids([c79]))
    expect(run({ keyword: 'fold' })).toEqual(ids([memoNone]))
    expect(run({ keyword: ' riv ' })).toEqual(ids([c79]))
    expect(run({ keyword: '3b' })).toEqual(ids([c79, unf]))
  })

  it('兩種篩選同時套用：結果為兩者交集', () => {
    expect(run({ kind: 'simple', tag: '3bet' })).toEqual(ids([unf]))
    expect(run({ period: 'last3Months', position: 'BTN' })).toEqual(ids([c79, unf]))
  })

  it('清除篩選回到全部；isFilteringHands 判斷是否顯示「清除篩選」', () => {
    expect(run(DEFAULT_HAND_FILTERS)).toEqual(ids(all))
    expect(isFilteringHands(DEFAULT_HAND_FILTERS, null)).toBe(false)
    expect(isFilteringHands(DEFAULT_HAND_FILTERS, SESSION)).toBe(true)
    for (const patch of [{ kind: 'simple' }, { source: 'gg' }, { position: 'none' }, { tag: 'x' }, { link: 'linked' }, { keyword: 'a' }, { period: 'last3Months' }] as const) {
      expect(isFilteringHands(filters(patch), null)).toBe(true)
    }
  })
})

/** 直接組出列表用的輕量物件（只測顯示格式） */
function row(patch: Partial<HandListItem>): HandListItem {
  return { ...toHandListItem(memo()), ...patch }
}

describe('12.3 H2 HC29 畫面顯示（元、分、籌碼三種單位）與單列內容（6.1）', () => {
  it('元單位：`BTN · $100/$200`；heroNet 16800 → `+$16,800`（無 bb 時）、bb 200 時 `+84.0 bb`', () => {
    const h = toHandListItem(example79Hand())
    expect(handRowTitle(h)).toBe('BTN · $100/$200')
    expect(handResultText(h)).toBe('+84.0 bb')
    expect(handResultText({ ...h, bb: null })).toBe('+$16,800')
    expect(handHeadlineResult(example79Hand())).toEqual({ main: '+84.0 bb', secondary: '+$16,800' })
  })

  it('分單位：`SB · $0.10/$0.25`；100 → `$1.00`、123456 → `+$1,234.56`；0 → `$0.00`', () => {
    const h = row({ amountUnit: 'cent', hasDetail: true, sb: 10, bb: 25, heroPosition: 'SB', kind: 'complete', source: 'gg' })
    expect(handRowTitle(h)).toBe('SB · $0.10/$0.25')
    expect(handResultText({ ...h, bb: null, heroNet: 100 })).toBe('+$1.00')
    expect(handResultText({ ...h, bb: null, heroNet: 123456 })).toBe('+$1,234.56')
    expect(handResultText({ ...h, bb: null, heroNet: 0 })).toBe('$0.00')
    // GG 範例 8.8：heroNet 356、bb 25 → +14.2 bb
    expect(handResultText({ ...h, heroNet: 356 })).toBe('+14.2 bb')
  })

  it('籌碼單位：`BB · 100/200`；1500 → `+1,500`；0 → `0`；元單位 0 → `$0`', () => {
    const h = row({ amountUnit: 'chip', hasDetail: true, sb: 100, bb: 200, heroPosition: 'BB', gameType: 'tournament' })
    expect(handRowTitle(h)).toBe('BB · 100/200')
    expect(handResultText({ ...h, bb: null, heroNet: 1500 })).toBe('+1,500')
    expect(handResultText({ ...h, bb: null, heroNet: 0 })).toBe('0')
    expect(handResultText(row({ amountUnit: 'yuan', bb: null, heroNet: 0 }))).toBe('$0')
  })

  it('簡易備忘手牌：有大盲 `BTN · 大盲 $200`；沒有盲注只顯示位置；都沒有顯示「手牌」；heroNet null 顯示 —', () => {
    expect(handRowTitle(row({ heroPosition: 'BTN', bb: 200, hasDetail: false, sb: null }))).toBe('BTN · 大盲 $200')
    expect(handRowTitle(row({ heroPosition: 'UTG1', bb: null }))).toBe('UTG+1')
    expect(handRowTitle(row({ heroPosition: null, bb: null }))).toBe('手牌')
    expect(handRowTitle(row({ heroPosition: null, bb: 400, amountUnit: 'chip' }))).toBe('大盲 400')
    expect(handResultText(row({ heroNet: null }))).toBe('—')
  })

  it('bb 以絕對值捨入後為 0 時顯示 `0.0 bb` 且不上色；正負顏色依顯示的正負號', () => {
    const text = handResultText(row({ heroNet: -1, bb: 40 }))
    expect(text).toBe('0.0 bb')
    expect(signedTextClass(text)).toBe('')
    expect(signedTextClass('+84.0 bb')).toBe('text-(--color-gain)')
    expect(signedTextClass('−12.5 bb')).toBe('text-(--color-loss)')
  })

  it('小標籤：簡易 / 未完成（取代簡易）/ GG；第二行時間 `09/30 21:15` 與前 2 個標籤、+N', () => {
    expect(handRowBadges(toHandListItem(memo()))).toEqual(['簡易'])
    expect(handRowBadges(toHandListItem(unfinished()))).toEqual(['未完成'])
    expect(handRowBadges(toHandListItem(complete()))).toEqual([])
    expect(handRowBadges(toHandListItem(gg()))).toEqual(['GG'])
    expect(handRowTime({ playedAt: '2026-09-30T21:15:00' })).toBe('09/30 21:15')
    expect(handRowTags({ tags: ['a', 'b', 'c', 'd'] })).toEqual({ shown: ['a', 'b'], more: 2 })
    expect(handRowTags({ tags: ['a'] })).toEqual({ shown: ['a'], more: 0 })
  })

  it('11.1 列表用的輕量物件不含 detail、rawText', () => {
    const item = toHandListItem(gg()) as unknown as Record<string, unknown>
    expect('detail' in item).toBe(false)
    expect('rawText' in item).toBe(false)
    expect(item.hasDetail).toBe(true)
    expect(item.sb).toBe(100)
  })
})

describe('12.3 H2 詳情逐街呈現的顯示資料（6.2）', () => {
  it('7.9 範例：各區底池、每行動文字、結果區', () => {
    const view = buildHandDetailView(example79Hand())!
    expect(handSummaryText(example79Hand())).toBe('現金桌 · 6-max · $100/$200 · 有效 100.0 bb')
    expect(view.seats.map((s) => `${s.label} ${s.position} ${s.stack}${s.isHero ? ' 你' : ''}`)).toEqual([
      '座位 1 UTG $20,000 · 100.0 bb',
      '座位 2 HJ $20,000 · 100.0 bb',
      '座位 3 CO $20,000 · 100.0 bb',
      '座位 4 BTN $20,000 · 100.0 bb 你',
      '座位 5 SB $24,000 · 120.0 bb',
      '座位 6 BB $17,100 · 85.5 bb',
    ])
    expect(view.streets.map((s) => [s.name, s.cards, s.pot, s.runout])).toEqual([
      ['翻前', [], '底池 $300', false],
      ['翻牌', ['Kh', '7d', '2c'], '底池 $1,100', false],
      ['轉牌', ['9s'], '底池 $2,500', false],
      ['河牌', ['3h'], '底池 $34,300', true],
    ])
    expect(view.streets.map((s) => s.lines)).toEqual([
      ['SB（5）小盲 $100', 'BB（6）大盲 $200', 'UTG（1）棄牌', 'HJ（2）棄牌', 'CO（3）棄牌', '你 BTN（4）加注到 $500', 'SB（5）棄牌', 'BB（6）跟注 $300'],
      ['BB（6）過牌', '你 BTN（4）下注 $700', 'BB（6）跟注 $700'],
      ['BB（6）過牌', '你 BTN（4）下注 $1,600', 'BB（6）加注到 $15,900 全下', '你 BTN（4）跟注 $14,300'],
      [],
    ])
    expect(view.result).toEqual({
      showdown: [
        { who: '你', cards: ['As', 'Ks'], text: '一對 K' },
        { who: 'BB（6）', cards: ['Kd', 'Qs'], text: '一對 K' },
      ],
      pots: [{ line: '主池 $34,300 → 你' }],
      rake: '抽水 $400',
      nets: [
        { who: 'UTG（1）', value: 0, text: '$0' },
        { who: 'HJ（2）', value: 0, text: '$0' },
        { who: 'CO（3）', value: 0, text: '$0' },
        { who: '你', value: 16800, text: '+$16,800' },
        { who: 'SB（5）', value: -100, text: '−$100' },
        { who: 'BB（6）', value: -17100, text: '−$17,100' },
      ],
    })
    expect(view.unfinished).toBe(false)
  })

  it('HC2 未跟注退回「退回 $100 給 BB（6）」；手牌因棄牌結束時沒有翻牌區、沒有攤牌', () => {
    const hand = buildHand({ detail: hc2Detail() })
    const view = buildHandDetailView(hand)!
    expect(view.streets.map((s) => s.name)).toEqual(['翻前'])
    expect(view.streets[0]!.lines.slice(-2)).toEqual(['SB（5）棄牌', '退回 $100 給 BB（6）'])
    expect(view.result!.showdown).toEqual([])
    expect(view.result!.pots).toEqual([{ line: '主池 $200 → BB（6）' }])
  })

  it('HC5 邊池：主池與邊池的金額與贏家；Hero 的退回寫「給 你」', () => {
    const hand = buildHand({ detail: hc5Detail(300), board: runoutBoard })
    const view = buildHandDetailView(hand)!
    expect(view.result!.pots.map((p) => p.line)).toEqual(['主池 $3,000 → 你', '邊池 1 $4,000 → SB（2）'])
    expect(view.streets.slice(1).every((s) => s.runout)).toBe(true)
    const refund = buildHandDetailView(buildHand({ detail: detail({ seats: [seat(1, 5000, ['Ah', 'Ad']), seat(2, 5000)], actions: [act('preflop', 1, 'raise', 600), act('preflop', 2, 'fold')] }) }))!
    expect(refund.streets[0]!.lines.at(-1)).toBe('退回 $400 給 你')
  })

  it('前注與 straddle 列在翻前區最上方；錦標賽金額無 $、不顯示抽水；摘要加註前注與 Straddle', () => {
    const d = detail({
      tableSize: 4,
      buttonSeat: 1,
      heroSeat: 1,
      ante: 25,
      straddle: 400,
      seats: [seat(1, 10000, ['Ah', 'Ad']), seat(2, 10000), seat(3, 10000), seat(4, 10000)],
      actions: [act('preflop', 1, 'fold'), act('preflop', 2, 'fold'), act('preflop', 3, 'fold')],
    })
    const hand = buildHand({ detail: d, gameType: 'tournament' })
    const view = buildHandDetailView(hand)!
    expect(view.streets[0]!.lines.slice(0, 7)).toEqual([
      '你 BTN（1）前注 25',
      'SB（2）前注 25',
      'BB（3）前注 25',
      'CO（4）前注 25',
      'SB（2）小盲 100',
      'BB（3）大盲 200',
      'CO（4）Straddle 400',
    ])
    expect(view.seats[3]!.position).toBe('CO · Straddle')
    expect(view.result!.rake).toBeNull()
    expect(handSummaryText(hand)).toBe('錦標賽 · 4-max · 100/200 · 前注 25 · Straddle 400 · 有效 50.0 bb')
  })

  it('未完成的手牌：顯示到目前為止的內容、unfinished 為 true、沒有結果區', () => {
    const view = buildHandDetailView(unfinished())!
    expect(view.unfinished).toBe(true)
    expect(view.result).toBeNull()
    expect(view.streets.map((s) => s.lines)).toEqual([['SB（5）小盲 $100', 'BB（6）大盲 $200', 'UTG（1）棄牌', 'HJ（2）棄牌']])
  })

  it('4.10 中文牌型：每種牌型的寫法', () => {
    const board = ['2c', '7d', '9h', 'Js', '4c']
    const cases: [string[], string[], string][] = [
      [['Ah', 'Kd'], board, '高牌 A'],
      [['Kh', 'Kd'], board, '一對 K'],
      [['Jh', '9d'], board, '兩對 J、9'],
      [['9s', '9d'], board, '三條 9'],
      [['Ah', '3d'], ['2c', '4d', '5h', 'Js', 'Kc'], '順子 A 到 5'],
      [['Th', 'Qd'], ['Kc', 'Ad', 'Jh', '2s', '3c'], '順子 10 到 A'],
      [['Ac', '3c'], ['2c', '8c', 'Tc', 'Js', '4d'], '同花 A 高'],
      [['Jh', 'Jd'], ['Js', '9h', '9d', '2c', '3s'], '葫蘆 J、9'],
      [['9s', '9c'], ['9h', '9d', '2c', '3s', 'Kd'], '四條 9'],
      [['5h', '6h'], ['7h', '8h', '9h', '2c', '3s'], '同花順 5 到 9'],
    ]
    for (const [hole, b, text] of cases) expect(describeHandValueText(evaluateHand(hole, b))).toBe(text)
  })
})

describe('5.1 捲動記憶的鍵：場次子頁（#/hands?sessionId=）不寫入「手牌」頁籤的位置', () => {
  it('只有 /hands 的 sessionId 參數會區分，其他頁面以 pathname 區分', () => {
    expect(scrollMemoryKey('/hands', '')).toBe('/hands')
    expect(scrollMemoryKey('/hands', '?sessionId=abc')).toBe('/hands?sessionId=abc')
    expect(scrollMemoryKey('/sessions', '?venue=x')).toBe('/sessions')
    expect(scrollMemoryKey('/hands/1', '')).toBe('/hands/1')
  })
})
