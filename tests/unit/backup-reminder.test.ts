// 8.7 備份提醒的三個觸發條件（now 注入）；v1.6 / SPEC-v2-hands v2.4 10.5：14 天或累積 20 筆
import { describe, expect, it } from 'vitest'
import { BACKUP_REMINDER_INTERVAL_MS, BACKUP_REMINDER_MAX_CHANGES, shouldShowBackupReminder } from '../../src/domain'

const at = (updatedAt: string) => ({ updatedAt })
const many = (n: number, updatedAt = '2026-09-01T10:00:00+08:00') => Array.from({ length: n }, () => at(updatedAt))
const NOW = new Date('2026-09-30T12:00:00+08:00')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** NOW 往前 ms 的時間戳（ISO，UTC 表示） */
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

it('8.7 常數：14 天（14 × 24 小時）、20 筆', () => {
  expect(BACKUP_REMINDER_INTERVAL_MS).toBe(14 * DAY)
  expect(BACKUP_REMINDER_MAX_CHANGES).toBe(20)
})

describe('8.7 條件 1：從未備份，且場次數 ≥ 10', () => {
  it('8.7 條件 1：10 場時提醒、9 場時不提醒、0 場不提醒', () => {
    expect(shouldShowBackupReminder({ sessions: many(10), lastBackupAt: undefined, now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: many(9), lastBackupAt: undefined, now: NOW })).toBe(false)
    expect(shouldShowBackupReminder({ sessions: [], lastBackupAt: undefined, now: NOW })).toBe(false)
  })

  it('8.7 條件 1：lastBackupAt 無法解析時視同從未備份（只看條件 1）', () => {
    expect(shouldShowBackupReminder({ sessions: many(10), lastBackupAt: 'garbage', now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: many(3), lastBackupAt: 'garbage', now: NOW })).toBe(false)
  })
})

describe('8.7 條件 2：距上次備份超過 14 天，且任一場次 updatedAt > lastBackupAt', () => {
  // 備份後只有 1 筆修改（遠低於條件 3 的 20 筆），只由天數決定
  const updatedOnce = (last: string) => [at(new Date(Date.parse(last) + 1000).toISOString())]

  it('8.7 條件 2 邊界：13 天 23 小時不提醒；恰 14 天不提醒；超過 14 天（多 1 毫秒）提醒', () => {
    const last13d23h = before(13 * DAY + 23 * HOUR)
    expect(shouldShowBackupReminder({ sessions: updatedOnce(last13d23h), lastBackupAt: last13d23h, now: NOW })).toBe(false)
    const last14d = before(14 * DAY)
    expect(shouldShowBackupReminder({ sessions: updatedOnce(last14d), lastBackupAt: last14d, now: NOW })).toBe(false)
    expect(shouldShowBackupReminder({ sessions: updatedOnce(last14d), lastBackupAt: last14d, now: new Date(NOW.getTime() + 1) })).toBe(true)
  })

  it('8.7 條件 2：超過 14 天但備份後沒有新增或修改：不提醒', () => {
    const old = '2026-07-01T00:00:00+08:00'
    expect(shouldShowBackupReminder({ sessions: [at('2026-06-30T23:59:59+08:00'), at(old)], lastBackupAt: old, now: NOW })).toBe(
      false,
    )
  })

  it('8.7 條件 2：任一場次 updatedAt 晚於備份時間即符合；1 場也會提醒（不需 10 場）', () => {
    const old = '2026-07-01T00:00:00+08:00'
    expect(
      shouldShowBackupReminder({
        sessions: [at('2026-06-01T00:00:00+08:00'), at('2026-07-01T00:00:01+08:00')],
        lastBackupAt: old,
        now: NOW,
      }),
    ).toBe(true)
  })

  it('8.7 條件 2：時間戳以時間值比較，不受時區偏移寫法影響', () => {
    // 2026-07-01T00:00:00+08:00 = 2026-06-30T16:00:00Z；updatedAt 以 UTC 表示且早於備份時間
    expect(
      shouldShowBackupReminder({ sessions: [at('2026-06-30T15:59:59Z')], lastBackupAt: '2026-07-01T00:00:00+08:00', now: NOW }),
    ).toBe(false)
    expect(
      shouldShowBackupReminder({ sessions: [at('2026-06-30T16:00:01Z')], lastBackupAt: '2026-07-01T00:00:00+08:00', now: NOW }),
    ).toBe(true)
  })

  it('8.7 條件 2：14 天內有更新但未達 20 筆不提醒；已備份過就不再套用 10 場條件', () => {
    // 原本（v1.5，30 天）此例為 50 筆；v1.6 的條件 3 會讓 50 筆提醒，改為 19 筆檢查「14 天內、未達 20 筆」
    expect(
      shouldShowBackupReminder({ sessions: many(19, '2026-09-29T00:00:00+08:00'), lastBackupAt: '2026-09-20T00:00:00+08:00', now: NOW }),
    ).toBe(false)
  })
})

describe('8.7 條件 3（v1.6）：備份後新增或修改累積達 20 筆，不論天數', () => {
  const last = '2026-09-29T12:00:00+08:00' // 距 NOW 僅 1 天
  const after = '2026-09-30T08:00:00+08:00'
  const prior = '2026-09-01T00:00:00+08:00'

  it('8.7 條件 3 邊界：備份後更新 19 筆不提醒、20 筆提醒（距上次備份僅 1 天）', () => {
    expect(shouldShowBackupReminder({ sessions: many(19, after), lastBackupAt: last, now: NOW })).toBe(false)
    expect(shouldShowBackupReminder({ sessions: many(20, after), lastBackupAt: last, now: NOW })).toBe(true)
  })

  it('8.7 條件 3：只計 updatedAt > lastBackupAt 的筆數（備份前的資料、等於備份時間的不算）', () => {
    const sessions = [...many(19, after), ...many(100, prior), at(last)]
    expect(shouldShowBackupReminder({ sessions, lastBackupAt: last, now: NOW })).toBe(false)
    expect(shouldShowBackupReminder({ sessions: [...sessions, at(after)], lastBackupAt: last, now: NOW })).toBe(true)
  })

  it('10.5 條件 3：場次與手牌合計（12 場 + 8 手 = 20 提醒；12 場 + 7 手 = 19 不提醒）', () => {
    expect(shouldShowBackupReminder({ sessions: many(12, after), hands: many(8, after), lastBackupAt: last, now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: many(12, after), hands: many(7, after), lastBackupAt: last, now: NOW })).toBe(false)
    expect(shouldShowBackupReminder({ sessions: [], hands: many(20, after), lastBackupAt: last, now: NOW })).toBe(true)
  })

  it('8.7 條件 3：從未備份時不套用（20 筆時由條件 1 提醒，19 筆以上必然已達 10 筆）', () => {
    expect(shouldShowBackupReminder({ sessions: many(20, after), lastBackupAt: undefined, now: NOW })).toBe(true)
  })
})

// SPEC-v2-hands 10.5（12.3 H0「備份提醒符合 10.5」）：觸發條件納入手牌
describe('10.5 備份提醒納入手牌', () => {
  it('10.5 條件 1：從未備份，且「場次數 + 手牌數」≥ 10', () => {
    expect(shouldShowBackupReminder({ sessions: many(5), hands: many(5), lastBackupAt: undefined, now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: many(5), hands: many(4), lastBackupAt: undefined, now: NOW })).toBe(false)
    expect(shouldShowBackupReminder({ sessions: [], hands: many(10), lastBackupAt: undefined, now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: [], hands: many(9), lastBackupAt: undefined, now: NOW })).toBe(false)
  })

  it('10.5 條件 2：距上次備份超過 14 天，且備份後有場次或手牌被新增或修改', () => {
    const old = '2026-07-01T00:00:00+08:00'
    const prior = [at('2026-06-30T00:00:00+08:00')]
    expect(shouldShowBackupReminder({ sessions: prior, hands: [at('2026-07-01T00:00:01+08:00')], lastBackupAt: old, now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: prior, hands: prior, lastBackupAt: old, now: NOW })).toBe(false)
    // 未超過 14 天（10 天）且未達 20 筆：手牌有更新也不提醒
    expect(
      shouldShowBackupReminder({ sessions: [], hands: [at('2026-09-29T00:00:00+08:00')], lastBackupAt: '2026-09-20T00:00:00+08:00', now: NOW }),
    ).toBe(false)
  })

  it('10.5 刪除手牌、刪除場次造成的手牌轉為獨立（不更新 updatedAt）不觸發', () => {
    const old = '2026-07-01T00:00:00+08:00'
    // 轉為獨立的手牌 updatedAt 仍在備份前；刪除則不在清單中
    expect(shouldShowBackupReminder({ sessions: [], hands: [at('2026-06-01T00:00:00+08:00')], lastBackupAt: old, now: NOW })).toBe(false)
  })
})
