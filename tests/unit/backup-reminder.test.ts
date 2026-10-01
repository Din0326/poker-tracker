// 8.7 備份提醒的兩個觸發條件（now 注入）
import { describe, expect, it } from 'vitest'
import { shouldShowBackupReminder } from '../../src/domain'

const at = (updatedAt: string) => ({ updatedAt })
const many = (n: number, updatedAt = '2026-09-01T10:00:00+08:00') => Array.from({ length: n }, () => at(updatedAt))
const NOW = new Date('2026-09-30T12:00:00+08:00')

describe('條件一：從未備份，且場次數 ≥ 10', () => {
  it('10 場時提醒、9 場時不提醒、0 場不提醒', () => {
    expect(shouldShowBackupReminder({ sessions: many(10), lastBackupAt: undefined, now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: many(9), lastBackupAt: undefined, now: NOW })).toBe(false)
    expect(shouldShowBackupReminder({ sessions: [], lastBackupAt: undefined, now: NOW })).toBe(false)
  })

  it('lastBackupAt 無法解析時視同從未備份', () => {
    expect(shouldShowBackupReminder({ sessions: many(10), lastBackupAt: 'garbage', now: NOW })).toBe(true)
    expect(shouldShowBackupReminder({ sessions: many(3), lastBackupAt: 'garbage', now: NOW })).toBe(false)
  })
})

describe('條件二：距上次備份超過 30 天，且任一場次 updatedAt > lastBackupAt', () => {
  const last = '2026-08-31T12:00:00+08:00' // 距 NOW 恰 30 天

  it('恰 30 天不提醒；超過 30 天（多 1 毫秒）且有更新才提醒', () => {
    const updated = [at('2026-09-10T00:00:00+08:00')]
    expect(shouldShowBackupReminder({ sessions: updated, lastBackupAt: last, now: NOW })).toBe(false)
    const later = new Date(NOW.getTime() + 1)
    expect(shouldShowBackupReminder({ sessions: updated, lastBackupAt: last, now: later })).toBe(true)
  })

  it('超過 30 天但備份後沒有新增或修改：不提醒', () => {
    const old = '2026-07-01T00:00:00+08:00'
    expect(shouldShowBackupReminder({ sessions: [at('2026-06-30T23:59:59+08:00'), at(old)], lastBackupAt: old, now: NOW })).toBe(
      false,
    )
  })

  it('任一場次 updatedAt 晚於備份時間即符合；1 場也會提醒（不需 10 場）', () => {
    const old = '2026-07-01T00:00:00+08:00'
    expect(
      shouldShowBackupReminder({
        sessions: [at('2026-06-01T00:00:00+08:00'), at('2026-07-01T00:00:01+08:00')],
        lastBackupAt: old,
        now: NOW,
      }),
    ).toBe(true)
  })

  it('時間戳以時間值比較，不受時區偏移寫法影響', () => {
    // 2026-07-01T00:00:00+08:00 = 2026-06-30T16:00:00Z；updatedAt 以 UTC 表示且早於備份時間
    expect(
      shouldShowBackupReminder({ sessions: [at('2026-06-30T15:59:59Z')], lastBackupAt: '2026-07-01T00:00:00+08:00', now: NOW }),
    ).toBe(false)
    expect(
      shouldShowBackupReminder({ sessions: [at('2026-06-30T16:00:01Z')], lastBackupAt: '2026-07-01T00:00:00+08:00', now: NOW }),
    ).toBe(true)
  })

  it('30 天內即使有更新也不提醒；已備份過就不再套用 10 場條件', () => {
    expect(
      shouldShowBackupReminder({ sessions: many(50, '2026-09-29T00:00:00+08:00'), lastBackupAt: '2026-09-20T00:00:00+08:00', now: NOW }),
    ).toBe(false)
  })
})
