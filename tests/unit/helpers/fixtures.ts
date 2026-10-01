// 單元測試共用的場次建構函式
import type { BuyIn, Session, SessionType } from '../../../src/domain/types'

let counter = 0

/** 產生合法的 UUID v4 格式字串（測試用，依序遞增） */
export function testUuid(): string {
  counter++
  const tail = counter.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${tail}`
}

const TS = '2026-09-28T21:05:00+08:00'

/** 建立一筆合法場次，可覆寫任何欄位 */
export function makeSession(overrides: Partial<Session> & { type?: SessionType } = {}): Session {
  const type = overrides.type ?? 'cash'
  const buyIns: BuyIn[] = overrides.buyIns ?? [{ amount: 1000, fee: 0 }]
  return {
    id: testUuid(),
    type,
    startAt: '2026-09-27T20:00',
    durationMin: 60,
    buyIns,
    cashOut: 1000,
    stakeId: type === 'cash' ? 'stake-1' : null,
    venueId: null,
    name: null,
    note: null,
    fieldSize: null,
    finishPlace: null,
    backers: [],
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

/** 以買入總額與到手金額快速建立場次 */
export function withResult(type: SessionType, buyIn: number, cashOut: number, extra: Partial<Session> = {}): Session {
  return makeSession({ type, buyIns: [{ amount: buyIn, fee: 0 }], cashOut, ...extra })
}
