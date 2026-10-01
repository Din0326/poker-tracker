// v1.2 賣股份的備份與 CSV：8.4 匯出 schemaVersion 2 含 backers、8.5 v1 → v2 遷移與 backers 驗證、8.6 CSV 新欄位
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BACKUP_MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  buildBackup,
  buildSessionsCsv,
  migrateBackup,
  parseBackupText,
  serializeBackup,
  validateBackup,
  type Backer,
  type BackupFile,
  type Session,
  type Stake,
  type Venue,
} from '../../src/domain'
import { describeBackupError } from '../../src/features/settings/backupErrorText'
import { makeSession } from './helpers/fixtures'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const V1 = uuid(0xb01)
const S1 = uuid(0xc01)
const venues: Venue[] = [{ id: V1, name: '6bet', archived: false, sortOrder: 0 }]
const stakes: Stake[] = [{ id: S1, sb: 50, bb: 100, archived: false, sortOrder: 0 }]
const NOW = new Date(2026, 9, 1, 21, 5, 0)

const A: Backer = { name: 'A', sharePermille: 100, markupPermille: 1200 }
const B: Backer = { name: 'B', sharePermille: 200, markupPermille: 1000 }

const stakedMtt = makeSession({
  id: uuid(1),
  type: 'mtt',
  stakeId: null,
  venueId: V1,
  buyIns: [{ amount: 10000, fee: 0 }],
  cashOut: 50000,
  backers: [A, B],
})
const plainCash = makeSession({ id: uuid(2), type: 'cash', stakeId: S1, buyIns: [{ amount: 5000, fee: 100 }], cashOut: 3000 })

function backup(sessions: Session[] = [stakedMtt, plainCash]): BackupFile {
  return buildBackup({ sessions, venues, stakes, hands: [], settings: { lastType: 'mtt' } }, NOW)
}

/** 深拷貝後修改 sessions，模擬被竄改的 v2 備份檔 */
function mutateSessions(fn: (sessions: Record<string, unknown>[]) => void): unknown {
  const data = JSON.parse(serializeBackup(backup()))
  fn(data.sessions)
  return data
}

function expectInvalid(input: unknown) {
  const r = validateBackup(input)
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error('unreachable')
  return r.error
}

// v2（SPEC-v2-hands 10.1）：目前匯出版本為 3；backers 的格式與檢查不變
describe('8.4 匯出（schemaVersion 3，含 backers）', () => {
  it('P5.5 匯出 JSON 的 schemaVersion 為 3（v1.2 時為 2），每筆 session 含 backers（沒有賣股為 []），元素為 { name, sharePermille, markupPermille }', () => {
    const b = backup()
    expect(CURRENT_SCHEMA_VERSION).toBe(3)
    expect(b.schemaVersion).toBe(3)
    const json = JSON.parse(serializeBackup(b))
    const mtt = json.sessions.find((s: Session) => s.id === stakedMtt.id)
    const cash = json.sessions.find((s: Session) => s.id === plainCash.id)
    expect(mtt.backers).toEqual([
      { name: 'A', sharePermille: 100, markupPermille: 1200 },
      { name: 'B', sharePermille: 200, markupPermille: 1000 },
    ])
    expect(Object.keys(mtt.backers[0])).toEqual(['name', 'sharePermille', 'markupPermille'])
    expect(cash.backers).toEqual([])
  })

  it('匯出 → 解析：backers 逐欄還原（含順序）', () => {
    const b = backup()
    const r = parseBackupText(serializeBackup(b))
    expect(r).toEqual({ ok: true, backup: b })
    if (!r.ok) throw new Error('unreachable')
    expect(r.backup.sessions.find((s) => s.id === stakedMtt.id)?.backers).toEqual([A, B])
  })
})

describe('8.5 匯入 schemaVersion 1（遷移 1 → 2）', () => {
  const fixtureText = readFileSync(new URL('../fixtures/backup-v1.json', import.meta.url), 'utf8')

  it('P5.5 匯入 schemaVersion 1 的備份檔（fixture）成功，所有場次補 backers: []，其他欄位不變', () => {
    const raw = JSON.parse(fixtureText)
    expect(raw.schemaVersion).toBe(1)
    const r = parseBackupText(fixtureText)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    // v2：1 → 2 → 3 逐步升級
    expect(r.backup.schemaVersion).toBe(3)
    expect(r.backup.hands).toEqual([])
    expect(r.backup.sessions).toHaveLength(3)
    r.backup.sessions.forEach((s, i) => {
      const { backers, ...rest } = s
      expect(backers).toEqual([])
      expect(rest).toEqual(raw.sessions[i])
    })
    expect(r.backup.exportedAt).toBe(raw.exportedAt)
  })

  it('v1 檔案中意外出現 backers 也一律覆寫為 []', () => {
    const raw = JSON.parse(fixtureText)
    raw.sessions[0].backers = [{ name: 'X', sharePermille: 100, markupPermille: 1000 }]
    raw.sessions[1].backers = 'garbage'
    const r = validateBackup(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    for (const s of r.backup.sessions) expect(s.backers).toEqual([])
  })

  it('遷移函式只動 backers；sessions 不是陣列或某筆不是物件時原樣保留，交給驗證報錯', () => {
    const migrated = migrateBackup({ schemaVersion: 1, sessions: [{ id: 'a', x: 1 }, 5], venues: [] }, BACKUP_MIGRATIONS, 2)
    expect(migrated).toEqual({ schemaVersion: 2, sessions: [{ id: 'a', x: 1, backers: [] }, 5], venues: [] })
    // v2：升級到目前版本時再補 hands: []（2 → 3），sessions 不變
    expect(migrateBackup({ schemaVersion: 1, sessions: [{ id: 'a', x: 1 }, 5], venues: [] })).toEqual({
      schemaVersion: 3,
      sessions: [{ id: 'a', x: 1, backers: [] }, 5],
      venues: [],
      hands: [],
    })
    expect(BACKUP_MIGRATIONS[1]!({ schemaVersion: 1, sessions: 'x' })).toEqual({ schemaVersion: 1, sessions: 'x' })
    expect(expectInvalid({ ...JSON.parse(fixtureText), sessions: [5] })).toMatchObject({ code: 'invalidRecord', index: 1 })
  })
})

describe('8.5 schemaVersion 2 的 backers 驗證', () => {
  it('缺少 backers 視為驗證失敗', () => {
    const e = expectInvalid(mutateSessions((s) => delete s[0]!.backers))
    expect(e).toMatchObject({ code: 'invalidRecord', collection: 'sessions', index: 1, path: ['backers'], issue: 'required' })
  })

  it('backers 為 null 視為驗證失敗', () => {
    expect(expectInvalid(mutateSessions((s) => (s[1]!.backers = null)))).toMatchObject({ index: 2, path: ['backers'] })
  })

  it('比例不是整數：顯示第一筆有問題的資料位置「出資者第 2 位 比例」', () => {
    const e = expectInvalid(
      mutateSessions((s) => {
        ;(s[0]!.backers as Backer[])[1]!.sharePermille = 12.5
      }),
    )
    expect(e).toMatchObject({ code: 'invalidRecord', index: 1, path: ['backers', 1, 'sharePermille'], issue: 'notInteger' })
    const text = describeBackupError(e)
    expect(text.reason).toBe('資料未通過檢查')
    expect(text.detail).toBe(`sessions 第 1 筆（id: ${stakedMtt.id}）：出資者第 2 位 比例 必須是整數`)
  })

  it('名稱空白、超過 20 字、前後空白；比例 0 或 > 1000；倍數 < 1000 或 > 3000；未知欄位：皆拒絕', () => {
    const cases: [(b: Record<string, unknown>) => void, (string | number)[]][] = [
      [(b) => (b.name = ''), ['backers', 0, 'name']],
      [(b) => (b.name = '一二三四五六七八九十一二三四五六七八九十一'), ['backers', 0, 'name']],
      [(b) => (b.name = ' A '), ['backers', 0, 'name']],
      [(b) => (b.sharePermille = 0), ['backers', 0, 'sharePermille']],
      [(b) => (b.sharePermille = 1001), ['backers', 0, 'sharePermille']],
      [(b) => (b.markupPermille = 999), ['backers', 0, 'markupPermille']],
      [(b) => (b.markupPermille = 3001), ['backers', 0, 'markupPermille']],
      [(b) => (b.markupPermille = 1.2), ['backers', 0, 'markupPermille']],
      [(b) => (b.paid = true), ['backers', 0, 'paid']],
    ]
    for (const [fn, path] of cases) {
      const e = expectInvalid(mutateSessions((s) => fn((s[0]!.backers as Record<string, unknown>[])[0]!)))
      expect(e).toMatchObject({ code: 'invalidRecord', index: 1, path })
    }
  })

  it('同場名稱重複（不分大小寫）、比例合計超過 1000、超過 10 筆：皆拒絕', () => {
    const dup = expectInvalid(
      mutateSessions((s) => (s[0]!.backers = [A, { ...B, name: 'a' }])),
    )
    expect(dup).toMatchObject({ path: ['backers', 1, 'name'], issue: 'duplicateBackerName' })
    expect(describeBackupError(dup).detail).toContain('出資者第 2 位 名稱 出資者名稱重複')

    const over = expectInvalid(
      mutateSessions((s) => (s[0]!.backers = [{ ...A, sharePermille: 600 }, { ...B, sharePermille: 401 }])),
    )
    expect(over).toMatchObject({ path: ['backers'], issue: 'backerShareTotalExceeded' })
    expect(describeBackupError(over).detail).toContain('出資者 賣出比例合計超過 100%')

    const many = expectInvalid(
      mutateSessions((s) => (s[0]!.backers = Array.from({ length: 11 }, (_, i) => ({ name: `N${i}`, sharePermille: 1, markupPermille: 1000 })))),
    )
    expect(many).toMatchObject({ path: ['backers'], issue: 'tooBig' })
  })

  it('合計恰為 1000（全部賣出）合法', () => {
    const r = validateBackup(mutateSessions((s) => (s[0]!.backers = [{ ...A, sharePermille: 600 }, { ...B, sharePermille: 400 }])))
    expect(r.ok).toBe(true)
  })
})

describe('8.6 CSV 新欄位', () => {
  const HEADERS = [
    '日期',
    '開始時',
    '類型',
    '場地',
    '盲注',
    '名稱',
    '進場次數',
    '買入總額',
    '服務費總額',
    '到手金額',
    '全額盈利',
    '賣出比例',
    '出資者付款總額',
    '分走獎金總額',
    '你的盈利',
    '出資者',
    '時長（分）',
    '參賽人數',
    '名次',
    '備註',
  ]

  const rowsOf = (csv: string) =>
    csv
      .slice(1)
      .split('\r\n')
      .filter((l) => l !== '')
      .map((l) => l.split(','))

  it('P5.5 欄位順序與名稱符合 8.6', () => {
    const rows = rowsOf(buildSessionsCsv([], venues, stakes))
    expect(rows[0]).toEqual(HEADERS)
  })

  it('有出資者：賣出比例 30.0、付款總額 3,200、分走總額 15,000、你的盈利 28,200、出資者「A 10%×1.2；B 20%×1.0」；沒有出資者為 0.0、0、0、全額盈利、空字串', () => {
    const rows = rowsOf(buildSessionsCsv([stakedMtt, plainCash], venues, stakes))
    const mtt = rows.find((r) => r[2] === 'MTT')!
    const cash = rows.find((r) => r[2] === '現金桌')!
    expect(mtt.slice(7, 16)).toEqual(['10000', '0', '50000', '40000', '30.0', '3200', '15000', '28200', 'A 10%×1.2；B 20%×1.0'])
    expect(cash.slice(7, 16)).toEqual(['5000', '100', '3000', '-2000', '0.0', '0', '0', '-2000', ''])
  })

  it('P5.5 每列「你的盈利 = 到手金額 − 分走獎金總額 − 買入總額 + 出資者付款總額」成立', () => {
    const many: Session[] = [
      stakedMtt,
      plainCash,
      makeSession({ type: 'mtt', stakeId: null, buyIns: [{ amount: 1005, fee: 5 }], cashOut: 2005, backers: [{ name: 'C', sharePermille: 333, markupPermille: 1000 }] }),
      makeSession({
        type: 'timed_mtt',
        stakeId: null,
        buyIns: [{ amount: 1000, fee: 0 }],
        cashOut: 2000,
        backers: [
          { name: 'A', sharePermille: 333, markupPermille: 1000 },
          { name: 'B', sharePermille: 333, markupPermille: 1200 },
          { name: 'C', sharePermille: 334, markupPermille: 1000 },
        ],
      }),
      makeSession({ type: 'mtt', stakeId: null, buyIns: [{ amount: 5000, fee: 0 }], cashOut: 0, backers: [{ name: 'A', sharePermille: 1000, markupPermille: 1100 }] }),
    ]
    const rows = rowsOf(buildSessionsCsv(many, venues, stakes)).slice(1)
    expect(rows).toHaveLength(many.length)
    for (const r of rows) {
      const [buyIn, , cashOut, full, , pay, payout, mine] = r.slice(7, 15).map(Number) as number[]
      expect(full).toBe(cashOut! - buyIn!)
      expect(mine).toBe(cashOut! - payout! - buyIn! + pay!)
    }
  })

  it('出資者欄屬文字欄位：以 = + - @ 開頭時加單引號；含逗號時依 RFC 4180 以雙引號包起', () => {
    const s = makeSession({ type: 'mtt', stakeId: null, backers: [{ name: '=evil', sharePermille: 125, markupPermille: 1150 }] })
    const csv = buildSessionsCsv([s], venues, stakes)
    expect(csv).toContain(",'=evil 12.5%×1.15,")
    const comma = buildSessionsCsv(
      [makeSession({ type: 'mtt', stakeId: null, backers: [{ name: 'A,B', sharePermille: 100, markupPermille: 1000 }] })],
      venues,
      stakes,
    )
    expect(comma).toContain(',"A,B 10%×1.0",')
  })
})
