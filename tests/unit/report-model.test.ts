import { describe, expect, it } from 'vitest'
import type { Stake } from '../../src/domain/types'
import {
  METRICS_BY_TAB,
  buildCurve,
  buildMetricCards,
  buildTypeBreakdown,
  curvePointTone,
  curveStroke,
  filterByTab,
  toneValue,
} from '../../src/features/report/reportModel'
import { makeSession } from './helpers/fixtures'

const stakes = new Map<string, Pick<Stake, 'bb'>>([
  ['s50', { bb: 100 }],
  ['s100', { bb: 200 }],
])

const values = (cards: ReturnType<typeof buildMetricCards>) =>
  Object.fromEntries(cards.map((c) => [c.key, c.value.text]))

describe('6.2 各頁籤指標與順序', () => {
  it('四個頁籤的指標清單與順序完全照表', () => {
    expect(METRICS_BY_TAB.all).toEqual([
      'profit',
      'count',
      'winRate',
      'totalHours',
      'totalBuyIn',
      'totalCashOut',
      'totalFee',
      'feeRate',
    ])
    expect(METRICS_BY_TAB.cash).toEqual([
      'profit',
      'count',
      'winRate',
      'hourly',
      'bbPerHour',
      'avgProfit',
      'totalHours',
      'totalBuyIn',
      'totalCashOut',
      'totalFee',
      'feeRate',
    ])
    expect(METRICS_BY_TAB.mtt).toEqual([
      'profit',
      'count',
      'winRate',
      'roi',
      'hourly',
      'itm',
      'placePercentile',
      'avgProfit',
      'abi',
      'avgEntries',
      'totalHours',
      'totalBuyIn',
      'totalCashOut',
      'totalFee',
      'feeRate',
    ])
    expect(METRICS_BY_TAB.timed_mtt).toEqual([
      'profit',
      'count',
      'winRate',
      'roi',
      'hourly',
      'avgProfit',
      'abi',
      'avgEntries',
      'totalHours',
      'totalBuyIn',
      'totalCashOut',
      'totalFee',
      'feeRate',
    ])
  })

  it('指標卡標籤使用表中名稱', () => {
    expect(buildMetricCards([], 'mtt', stakes).map((c) => c.label)).toEqual([
      '盈利',
      '場次數',
      '贏率',
      'ROI',
      '時薪',
      'ITM%',
      '平均名次百分位',
      '平均每場盈利',
      '平均單次買入（ABI）',
      '平均進場次數',
      '總時數',
      '總投入',
      '總到手',
      '總服務費',
      '服務費比例',
    ])
  })
})

describe('6.2 指標數值（呼叫 domain 彙總與格式化）', () => {
  it('現金桌：時薪、bb/hr（C4 各場依自己的 bb 換算）、服務費比例', () => {
    const sessions = [
      makeSession({ type: 'cash', stakeId: 's50', buyIns: [{ amount: 10000, fee: 300 }], cashOut: 12000, durationMin: 120 }),
      makeSession({ type: 'cash', stakeId: 's100', buyIns: [{ amount: 10000, fee: 0 }], cashOut: 12000, durationMin: 120 }),
    ]
    expect(values(buildMetricCards(sessions, 'cash', stakes))).toEqual({
      profit: '+$4,000',
      count: '2',
      winRate: '2/2（100.0%）',
      hourly: '+$1,000/hr',
      bbPerHour: '+7.5 bb/hr',
      avgProfit: '+$2,000',
      totalHours: '4.0 小時',
      totalBuyIn: '$20,000',
      totalCashOut: '$24,000',
      totalFee: '$300',
      feeRate: '1.5%',
    })
  })

  it('MTT：ROI、ITM%（C11）、平均名次百分位（C8）、ABI（C12）、平均進場次數', () => {
    const sessions = [
      makeSession({ type: 'mtt', buyIns: [{ amount: 3000, fee: 300 }], cashOut: 9000, fieldSize: 100, finishPlace: 10 }),
      makeSession({
        type: 'mtt',
        buyIns: [
          { amount: 3000, fee: 300 },
          { amount: 3000, fee: 300 },
        ],
        cashOut: 0,
        fieldSize: 100,
        finishPlace: 30,
      }),
      makeSession({ type: 'mtt', buyIns: [{ amount: 3000, fee: 300 }], cashOut: 0, durationMin: 120 }),
    ]
    const v = values(buildMetricCards(sessions, 'mtt', stakes))
    expect(v.roi).toBe('−25.0%')
    expect(v.itm).toBe('1/3（33.3%）')
    expect(v.placePercentile).toBe('前 20.0%（n=2）')
    expect(v.abi).toBe('$3,000')
    expect(v.avgEntries).toBe('1.33')
    expect(v.hourly).toBe('−$750/hr')
    expect(v.feeRate).toBe('10.0%')
  })

  it('C5 空集合：比率指標為 —、金額為 $0、場次數 0', () => {
    for (const tab of ['all', 'cash', 'mtt', 'timed_mtt'] as const) {
      const v = values(buildMetricCards([], tab, stakes))
      expect(v.profit).toBe('$0')
      expect(v.count).toBe('0')
      expect(v.winRate).toBe('—')
      expect(v.totalBuyIn).toBe('$0')
      expect(v.totalCashOut).toBe('$0')
      expect(v.totalFee).toBe('$0')
      expect(v.feeRate).toBe('—')
      expect(v.totalHours).toBe('0.0 小時')
      for (const key of ['roi', 'hourly', 'bbPerHour', 'itm', 'placePercentile', 'avgProfit', 'abi', 'avgEntries']) {
        if (key in v) expect(v[key], `${tab} ${key}`).toBe('—')
      }
    }
  })

  it('盲注參照遺失時 bb/hr 顯示 — 而不拋錯', () => {
    const s = makeSession({ type: 'cash', stakeId: 'missing' })
    expect(values(buildMetricCards([s], 'cash', stakes)).bbPerHour).toBe('—')
  })
})

describe('正負上色依據', () => {
  it('以顯示時捨入後的值判斷；0 與 null 不上色', () => {
    expect(toneValue(0.4, 0)).toBe(0)
    expect(toneValue(-0.5, 0)).toBe(-1)
    expect(toneValue(0.04, 1)).toBe(0)
    expect(toneValue(null, 0)).toBeNull()
  })

  it('盈利、平均每場盈利、時薪、ROI、bb/hr 帶上色依據，其餘不上色', () => {
    const s = makeSession({ type: 'mtt', buyIns: [{ amount: 1000, fee: 0 }], cashOut: 3000 })
    const tones = Object.fromEntries(buildMetricCards([s], 'mtt', stakes).map((c) => [c.key, c.value.tone]))
    expect(tones).toMatchObject({ profit: 2000, avgProfit: 2000, hourly: 2000, roi: 200 })
    expect(tones.count).toBeNull()
    expect(tones.totalBuyIn).toBeNull()
    expect(tones.abi).toBeNull()
  })
})

describe('頁籤篩選與總體小表', () => {
  const sessions = [
    makeSession({ type: 'cash', cashOut: 2000 }),
    makeSession({ type: 'mtt', cashOut: 0 }),
    makeSession({ type: 'mtt', cashOut: 500 }),
  ]
  it('總體為全部類型，其餘只含該類型', () => {
    expect(filterByTab(sessions, 'all')).toHaveLength(3)
    expect(filterByTab(sessions, 'mtt')).toHaveLength(2)
    expect(filterByTab(sessions, 'timed_mtt')).toHaveLength(0)
  })
  it('小表三列固定順序：現金桌、MTT、限時 MTT', () => {
    expect(buildTypeBreakdown(sessions).map((r) => [r.type, r.count, r.profit.text])).toEqual([
      ['cash', 1, '+$1,000'],
      ['mtt', 2, '−$1,500'],
      ['timed_mtt', 0, '$0'],
    ])
  })
})

describe('6.3 累積盈利曲線資料', () => {
  it('依 startAt 由舊到新、同時間依 createdAt，從 0 開始累積', () => {
    const a = makeSession({ startAt: '2026-09-02T10:00', cashOut: 2000, createdAt: '2026-09-02T20:00:00+08:00' })
    const b = makeSession({ startAt: '2026-09-01T10:00', cashOut: 500 })
    // 同 startAt：createdAt 較早的在前（時區偏移不同也以實際時間比較）
    const c = makeSession({ startAt: '2026-09-02T10:00', cashOut: 1500, createdAt: '2026-09-02T13:00:00+00:00' })
    const curve = buildCurve([a, b, c])
    expect(curve.map((p) => p.index)).toEqual([1, 2, 3])
    expect(curve.map((p) => p.date)).toEqual(['2026/09/01', '2026/09/02', '2026/09/02'])
    expect(curve.map((p) => p.profit)).toEqual([-500, 1000, 500])
    expect(curve.map((p) => p.cumulative)).toEqual([-500, 500, 1000])
    expect(curve[0]!.type).toBe('cash')
  })
})

describe('6.3 水上水下顏色', () => {
  it('跨 0：offset = max / (max − min)，在 y = 0 處硬切換', () => {
    expect(curveStroke([1000, -500, 300])).toEqual({ kind: 'split', offset: 1000 / 1500 })
    expect(curveStroke([-3000, 1000])).toEqual({ kind: 'split', offset: 0.25 })
  })

  it('只有 2 點：一正一負與兩點同號', () => {
    expect(curveStroke([500, -500])).toEqual({ kind: 'split', offset: 0.5 })
    expect(curveStroke([100, 200])).toEqual({ kind: 'solid', tone: 'gain' })
    expect(curveStroke([-100, -200])).toEqual({ kind: 'solid', tone: 'loss' })
  })

  it('全部 ≥ 0 → 整條 gain；全部 < 0 → 整條 loss', () => {
    expect(curveStroke([1, 2, 3, 4])).toEqual({ kind: 'solid', tone: 'gain' })
    expect(curveStroke([-1, -2, -3])).toEqual({ kind: 'solid', tone: 'loss' })
  })

  it('剛好為 0：最低點為 0 時整條 gain；最高點為 0 時線條沒有任何一段在 0 之上，整條 loss', () => {
    expect(curveStroke([0, 500, 0])).toEqual({ kind: 'solid', tone: 'gain' })
    expect(curveStroke([0, -500])).toEqual({ kind: 'solid', tone: 'loss' })
    expect(curveStroke([0, 0])).toEqual({ kind: 'solid', tone: 'gain' })
  })

  it('全部相同值（path 高度為 0）一律單色，不使用漸層', () => {
    expect(curveStroke([700, 700, 700])).toEqual({ kind: 'solid', tone: 'gain' })
    expect(curveStroke([-700, -700])).toEqual({ kind: 'solid', tone: 'loss' })
  })

  it('大量資料不會因展開參數超出呼叫堆疊', () => {
    const values = Array.from({ length: 200_000 }, (_, i) => (i % 2 === 0 ? i : -i))
    const s = curveStroke(values)
    expect(s.kind).toBe('split')
    expect(s.kind === 'split' && s.offset).toBeCloseTo(199_998 / (199_998 + 199_999), 10)
  })

  it('資料點顏色：≥ 0 為 gain（含 0）、< 0 為 loss', () => {
    expect(curvePointTone(1000)).toBe('gain')
    expect(curvePointTone(0)).toBe('gain')
    expect(curvePointTone(-0)).toBe('gain')
    expect(curvePointTone(-1)).toBe('loss')
  })
})
