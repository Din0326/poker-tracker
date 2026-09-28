// 開發用：產生大量隨機測試資料（11.1、A9；6.6、7.1 的 5,000 筆效能測試用）。
// 只產生資料，不寫入 DB、不含 UI。
// 正式程式碼不得 import 本檔（ESLint no-restricted-imports 強制），確保不進 production bundle。
// 以固定種子的虛擬亂數產生，同一組參數每次結果相同，方便重現問題。
import dayjs from 'dayjs'
import type { BuyIn, Session, SessionType, Stake, Venue } from '../domain/types'

/** 寫在 note 裡的標記，也用於確認建置產物不含本檔 */
export const SEED_MARKER = 'poker-seed-generator-v1'

export interface SeedOptions {
  /** 場次數，預設 5,000 */
  count?: number
  /** 亂數種子，預設 20260928 */
  seed?: number
  /** 資料的最晚日期 `YYYY-MM-DD`（不含當天，避免產生未來時間），預設為執行當天 */
  today?: string
  /** 往前分布的天數，預設 1,095（約 3 年） */
  spanDays?: number
}

export interface SeedData {
  venues: Venue[]
  stakes: Stake[]
  sessions: Session[]
}

/** mulberry32：輕量、可重現的虛擬亂數 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateSeedData(options: SeedOptions = {}): SeedData {
  const { count = 5000, seed = 20260928, spanDays = 1095 } = options
  const today = options.today ?? dayjs().format('YYYY-MM-DD')
  const rand = mulberry32(seed)
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T
  const chance = (p: number) => rand() < p

  // 以虛擬亂數產生 UUID v4 格式（crypto.randomUUID 無法重現）
  const uuid = (): string => {
    const hex = Array.from({ length: 32 }, () => int(0, 15).toString(16))
    hex[12] = '4'
    hex[16] = (8 + int(0, 3)).toString(16)
    const h = hex.join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }

  const venues: Venue[] = Array.from({ length: 8 }, (_, i) => ({
    id: uuid(),
    name: `Seed Venue ${i + 1}`,
    archived: i >= 6,
    sortOrder: i,
  }))

  const stakePairs: [number, number][] = [
    [25, 50],
    [50, 100],
    [100, 200],
    [200, 400],
    [500, 1000],
  ]
  const stakes: Stake[] = stakePairs.map(([sb, bb], i) => ({
    id: uuid(),
    sb,
    bb,
    archived: i === stakePairs.length - 1,
    sortOrder: i,
  }))

  const types: SessionType[] = ['cash', 'cash', 'mtt', 'timed_mtt']
  const eventNames = Array.from({ length: 12 }, (_, i) => `Seed Event ${i + 1}`)
  const tournamentBuyIns: BuyIn[] = [
    { amount: 1100, fee: 100 },
    { amount: 3400, fee: 400 },
    { amount: 3200, fee: 200 },
    { amount: 6600, fee: 600 },
  ]

  const sessions: Session[] = []
  for (let i = 0; i < count; i++) {
    const type = pick(types)
    const start = dayjs(today).subtract(int(1, spanDays), 'day').hour(int(0, 23))
    const startAt = start.format('YYYY-MM-DDTHH:00')
    const durationMin = int(1, 144) * 5 // 5 分鐘到 12 小時

    let buyIns: BuyIn[]
    let cashOut: number
    let stakeId: string | null = null
    let fieldSize: number | null = null
    let finishPlace: number | null = null

    if (type === 'cash') {
      const stake = pick(stakes)
      stakeId = stake.id
      const amount = stake.bb * int(50, 300)
      buyIns = [{ amount, fee: chance(0.3) ? int(0, 5) * 100 : 0 }]
      cashOut = chance(0.15) ? 0 : Math.round((amount * int(0, 300)) / 100)
    } else {
      const base = pick(tournamentBuyIns)
      buyIns = Array.from({ length: chance(0.7) ? 1 : int(2, 4) }, () => ({ ...base }))
      cashOut = chance(0.8) ? 0 : base.amount * int(1, 30)
      if (type === 'mtt' && chance(0.7)) {
        fieldSize = int(20, 600)
        if (chance(0.8)) finishPlace = int(1, fieldSize)
      }
    }

    const createdAt = start.add(durationMin, 'minute').format('YYYY-MM-DDTHH:mm:ssZ')
    sessions.push({
      id: uuid(),
      type,
      startAt,
      durationMin,
      buyIns,
      cashOut,
      stakeId,
      venueId: chance(0.85) ? pick(venues).id : null,
      name: type !== 'cash' && chance(0.6) ? pick(eventNames) : null,
      note: chance(0.1) ? `${SEED_MARKER} #${i + 1}` : null,
      fieldSize,
      finishPlace,
      createdAt,
      updatedAt: createdAt,
    })
  }

  return { venues, stakes, sessions }
}
