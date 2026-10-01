// 開發用 10,000 手測試手牌產生器（SPEC-v2-hands 11.1、13 節 H0）：
// 全部通過 Zod（handSchema）與 3.9 結構驗證（verifyHand），且含完整與簡易兩種、三種 amountUnit、邊池、平分等情況
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createDb } from '../../src/db'
import { buildPots, handSchema, replay, verifyHand, type Hand } from '../../src/domain/hands'
import { generateHandSeedData, HAND_SEED_MARKER } from '../../src/dev/handSeed'
import { generateSeedData } from '../../src/dev/seed'

describe('開發用 seed：10,000 手測試手牌', () => {
  const today = '2026-10-01'
  const sessions = generateSeedData({ today, count: 200 }).sessions
  const hands = generateHandSeedData({ today, sessions })

  it('預設產生 10,000 手，exportSeq 由 1 起連續、id 不重複', () => {
    expect(hands).toHaveLength(10_000)
    expect(hands.map((h) => h.exportSeq)).toEqual(Array.from({ length: 10_000 }, (_, i) => i + 1))
    expect(new Set(hands.map((h) => h.id)).size).toBe(10_000)
    expect(generateHandSeedData({ today, count: 3, startSeq: 51 }).map((h) => h.exportSeq)).toEqual([51, 52, 53])
  })

  it('每一手都通過 handSchema（3.1–3.6、amountUnit 推導）與 verifyHand（3.9 結構驗證、kind、摘要一致）', () => {
    const zodFailed = hands.filter((h) => !handSchema.safeParse(h).success)
    expect(zodFailed.map((h) => h.exportSeq)).toEqual([])
    const verifyFailed = hands.filter((h) => !verifyHand(h).ok)
    expect(verifyFailed.map((h) => [h.exportSeq, verifyHand(h)])).toEqual([])
  })

  it('約 30% 簡易（含純備忘與未完成的完整紀錄）、70% 完整', () => {
    const simple = hands.filter((h) => h.kind === 'simple')
    const ratio = simple.length / hands.length
    expect(ratio).toBeGreaterThan(0.25)
    expect(ratio).toBeLessThan(0.35)
    expect(simple.some((h) => h.detail === null)).toBe(true)
    expect(simple.some((h) => h.detail !== null)).toBe(true)
  })

  it('三種 amountUnit（yuan、cent、chip）與兩種來源都有', () => {
    const units = new Set(hands.map((h) => h.amountUnit))
    expect([...units].sort()).toEqual(['cent', 'chip', 'yuan'])
    expect(new Set(hands.map((h) => h.source))).toEqual(new Set(['manual', 'gg']))
    for (const h of hands) if (h.source === 'gg') expect(h.sourceHandId).toMatch(/^RC\d+$/)
    expect(new Set(hands.filter((h) => h.source === 'gg').map((h) => h.sourceHandId)).size).toBe(hands.filter((h) => h.source === 'gg').length)
  })

  const complete = hands.filter((h): h is Hand & { detail: NonNullable<Hand['detail']> } => h.kind === 'complete' && h.detail !== null)
  const potCount = (h: (typeof complete)[number]) => {
    const r = replay(h.detail)
    return r.ok ? buildPots(r.state.players).length : 0
  }

  it('含邊池（2 個以上的池）、平分（同一池多位贏家）、平分有餘數、抽水、前注、straddle、2 人與 10 人桌、蓋牌', () => {
    expect(complete.filter((h) => potCount(h) >= 2).length).toBeGreaterThan(50)
    // GG 第一版不支援邊池（8.3）
    expect(complete.filter((h) => h.source === 'gg' && potCount(h) >= 2)).toEqual([])
    const chops = complete.filter((h) => {
      const perPot = new Map<number, number>()
      for (const c of h.detail.collected) perPot.set(c.potIndex, (perPot.get(c.potIndex) ?? 0) + 1)
      return [...perPot.values()].some((n) => n >= 2)
    })
    expect(chops.length).toBeGreaterThan(50)
    // 平分不能整除：同一池的贏家金額差 1
    expect(
      chops.some((h) => {
        const amounts = h.detail.collected.filter((c) => c.potIndex === 0).map((c) => c.amount)
        return Math.max(...amounts) - Math.min(...amounts) === 1
      }),
    ).toBe(true)
    expect(complete.some((h) => h.detail.rake > 0)).toBe(true)
    expect(complete.some((h) => h.detail.ante > 0)).toBe(true)
    expect(complete.some((h) => h.detail.straddle > 0)).toBe(true)
    expect(complete.some((h) => h.detail.seats.length === 2)).toBe(true)
    expect(complete.some((h) => h.detail.seats.length === 10)).toBe(true)
    expect(complete.some((h) => h.detail.seats.some((s) => s.mucked))).toBe(true)
    // 錦標賽 rake 為 0
    for (const h of complete) if (h.gameType === 'tournament') expect(h.detail.rake).toBe(0)
  })

  it('關聯的場次都存在且類型相容（3.11）；playedAt 不含未來日期', () => {
    const types = new Map(sessions.map((s) => [s.id, s.type]))
    expect(hands.some((h) => h.sessionId !== null)).toBe(true)
    for (const h of hands) {
      if (h.sessionId !== null) {
        const t = types.get(h.sessionId)
        expect(t).toBeDefined()
        expect(h.gameType === 'cash' ? t === 'cash' : t !== 'cash').toBe(true)
      }
      expect(h.playedAt.slice(0, 10) < today).toBe(true)
    }
  })

  it('含標記字串（用於確認正式建置不含本檔）；同一組參數結果相同', () => {
    expect(hands.some((h) => h.note?.includes(HAND_SEED_MARKER))).toBe(true)
    expect(generateHandSeedData({ today, count: 30 })).toEqual(generateHandSeedData({ today, count: 30 }))
  })

  it('可整批寫入 Dexie（hands 表的 &exportSeq 唯一索引不衝突）', async () => {
    const db = createDb(`hand-seed-${Date.now()}`)
    await db.transaction('rw', db.sessions, db.hands, async () => {
      await db.sessions.bulkAdd(sessions)
      await db.hands.bulkAdd(hands)
    })
    expect(await db.hands.count()).toBe(10_000)
    await db.delete()
  })
})
