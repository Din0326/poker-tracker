// 8.4 匯出備份、8.5 匯入備份：組出備份物件、檔名、遷移、驗證（檢查順序與錯誤位置）
import { describe, expect, it } from 'vitest'
import {
  BACKUP_APP,
  CURRENT_SCHEMA_VERSION,
  backupFileName,
  buildBackup,
  formatIssuePath,
  migrateBackup,
  parseBackupText,
  serializeBackup,
  validateBackup,
  type BackupError,
  type BackupFile,
  type Session,
  type Stake,
  type Venue,
} from '../../src/domain'
import { describeBackupError } from '../../src/features/settings/backupErrorText'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const V1 = uuid(0x101)
const V2 = uuid(0x102)
const S1 = uuid(0x201)
const S2 = uuid(0x202)

const venues: Venue[] = [
  { id: V2, name: 'B 場', archived: true, sortOrder: 1 },
  { id: V1, name: 'A 場', archived: false, sortOrder: 0 },
]
const stakes: Stake[] = [
  { id: S2, sb: 100, bb: 200, archived: false, sortOrder: 1 },
  { id: S1, sb: 50, bb: 100, archived: false, sortOrder: 0 },
]

const TS = '2026-09-28T21:05:00+08:00'
const baseSession = {
  stakeId: null,
  venueId: null,
  name: null,
  note: null,
  fieldSize: null,
  finishPlace: null,
  createdAt: TS,
  updatedAt: TS,
} as const

const sessions: Session[] = [
  {
    ...baseSession,
    id: uuid(3),
    type: 'mtt',
    startAt: '2026-09-14T13:00',
    durationMin: 375,
    buyIns: [
      { amount: 3400, fee: 400 },
      { amount: 3200, fee: 200 },
    ],
    cashOut: 9000,
    venueId: V1,
    name: '週日賽',
    fieldSize: 180,
    finishPlace: 12,
  },
  {
    ...baseSession,
    id: uuid(1),
    type: 'cash',
    startAt: '2026-09-27T20:00',
    durationMin: 270,
    buyIns: [{ amount: 10000, fee: 300 }],
    cashOut: 12000,
    stakeId: S1,
    venueId: V2,
    note: '第一行\n第二行',
  },
  {
    ...baseSession,
    id: uuid(2),
    type: 'timed_mtt',
    startAt: '2026-09-01T00:00',
    durationMin: 90,
    buyIns: [{ amount: 2000, fee: 0 }],
    cashOut: 0,
  },
]

const NOW = new Date(2026, 8, 28, 21, 5, 42)

function validBackup(): BackupFile {
  return buildBackup(
    {
      sessions,
      venues,
      stakes,
      settings: {
        lastType: 'cash',
        lastVenueByType: { cash: V1, mtt: null },
        lastStakeId: S1,
        lastBackupAt: '2026-01-01T00:00:00+08:00',
        recordDraft: { version: 1 },
        profitColorScheme: 'greenGain',
      },
    },
    NOW,
  )
}

/** 深拷貝後修改，模擬被竄改或損毀的備份檔 */
function mutate(fn: (data: Record<string, unknown> & { sessions: Record<string, unknown>[]; venues: Record<string, unknown>[]; stakes: Record<string, unknown>[]; settings: Record<string, unknown> }) => void): unknown {
  const data = JSON.parse(JSON.stringify(validBackup()))
  fn(data)
  return data
}

function expectError(input: unknown, expected: Partial<BackupError>): BackupError {
  const r = validateBackup(input)
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error('unreachable')
  expect(r.error).toMatchObject(expected)
  return r.error
}

describe('8.4 buildBackup', () => {
  it('格式完全照規格：app、schemaVersion、exportedAt（含偏移）、四個集合；settings 不含 recordDraft 與 lastBackupAt', () => {
    const b = validBackup()
    expect(Object.keys(b)).toEqual(['app', 'schemaVersion', 'exportedAt', 'sessions', 'venues', 'stakes', 'settings'])
    expect(b.app).toBe('poker-tracker')
    expect(b.schemaVersion).toBe(1)
    expect(b.exportedAt).toMatch(/^2026-09-28T21:05:42[+-]\d{2}:\d{2}$/)
    expect(b.settings).toEqual({
      lastType: 'cash',
      lastVenueByType: { cash: V1, mtt: null },
      lastStakeId: S1,
      profitColorScheme: 'greenGain',
    })
    expect('recordDraft' in b.settings).toBe(false)
    expect('lastBackupAt' in b.settings).toBe(false)
  })

  it('順序穩定：sessions 依 id；venues、stakes 依 sortOrder；不改動輸入陣列', () => {
    const before = sessions.map((s) => s.id)
    const b = validBackup()
    expect(b.sessions.map((s) => s.id)).toEqual([uuid(1), uuid(2), uuid(3)])
    expect(b.venues.map((v) => v.id)).toEqual([V1, V2])
    expect(b.stakes.map((s) => s.id)).toEqual([S1, S2])
    expect(sessions.map((s) => s.id)).toEqual(before)
    // 同樣的資料每次輸出相同
    expect(serializeBackup(validBackup())).toBe(serializeBackup(b))
  })

  it('沒有設定時 settings 為空物件', () => {
    expect(buildBackup({ sessions: [], venues: [], stakes: [], settings: {} }, NOW).settings).toEqual({})
  })

  it('匯出的內容可以原樣匯入（round-trip）', () => {
    const b = validBackup()
    const r = parseBackupText(serializeBackup(b))
    expect(r).toEqual({ ok: true, backup: b })
  })
})

describe('8.4 backupFileName', () => {
  it('poker-backup-YYYYMMDD-HHmm.json（本地時間，補零）', () => {
    expect(backupFileName(NOW)).toBe('poker-backup-20260928-2105.json')
    expect(backupFileName(new Date(2027, 0, 3, 4, 7))).toBe('poker-backup-20270103-0407.json')
  })
})

describe('8.5 migrateBackup', () => {
  it('v1 直通：內容不變', () => {
    const data = { ...validBackup() } as unknown as Record<string, unknown> & { schemaVersion: number }
    expect(migrateBackup(data)).toEqual(data)
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })

  it('依版本逐步升級（框架）：v1 → v2 → v3', () => {
    const calls: number[] = []
    const migrations = {
      1: (d: Record<string, unknown>) => {
        calls.push(1)
        return { ...d, a: 1 }
      },
      2: (d: Record<string, unknown>) => {
        calls.push(2)
        return { ...d, b: (d.a as number) + 1 }
      },
    }
    expect(migrateBackup({ schemaVersion: 1 }, migrations, 3)).toEqual({ schemaVersion: 3, a: 1, b: 2 })
    expect(calls).toEqual([1, 2])
  })

  it('缺少某一步的遷移時丟出錯誤', () => {
    expect(() => migrateBackup({ schemaVersion: 1 }, {}, 2)).toThrow(/v1/)
  })
})

describe('8.5 驗證：檔案層級（依檢查順序）', () => {
  it('無法解析為 JSON', () => {
    expect(parseBackupText('{ not json')).toEqual({ ok: false, error: { code: 'invalidJson' } })
    expect(parseBackupText('')).toEqual({ ok: false, error: { code: 'invalidJson' } })
  })

  it('不是物件', () => {
    for (const v of [null, 1, 'x', [], true]) expectError(v, { code: 'notObject' })
  })

  it('app 不是 poker-tracker', () => {
    expectError(mutate((d) => (d.app = 'other-app')), { code: 'wrongApp' })
    expectError(mutate((d) => delete d.app), { code: 'wrongApp' })
  })

  it('schemaVersion 不是正整數', () => {
    for (const v of [0, -1, 1.5, '1', null]) expectError(mutate((d) => (d.schemaVersion = v)), { code: 'invalidSchemaVersion' })
    expectError(mutate((d) => delete d.schemaVersion), { code: 'invalidSchemaVersion' })
  })

  it('schemaVersion 大於目前版本（過新）', () => {
    expectError(mutate((d) => (d.schemaVersion = 2)), { code: 'schemaTooNew' })
  })

  it('檢查順序：app 錯誤優先於版本錯誤；版本過新優先於資料錯誤', () => {
    expectError(
      mutate((d) => {
        d.app = 'x'
        d.schemaVersion = 99
      }),
      { code: 'wrongApp' },
    )
    expectError(
      mutate((d) => {
        d.schemaVersion = 99
        d.sessions[0]!.cashOut = -1
      }),
      { code: 'schemaTooNew' },
    )
  })

  it('頂層結構：exportedAt 缺少或格式錯誤、集合不是陣列、settings 不是物件、未知頂層欄位', () => {
    expectError(mutate((d) => delete d.exportedAt), { code: 'invalidStructure', key: 'exportedAt', issue: 'required' })
    expectError(mutate((d) => (d.exportedAt = '2026-09-28 21:05')), { code: 'invalidStructure', key: 'exportedAt', issue: 'invalidFormat' })
    // 不含時區偏移的時間不接受
    expectError(mutate((d) => (d.exportedAt = '2026-09-28T21:05:00')), { code: 'invalidStructure', key: 'exportedAt' })
    expectError(mutate((d) => delete (d as Record<string, unknown>).sessions), { code: 'invalidStructure', key: 'sessions', issue: 'required' })
    expectError(mutate((d) => ((d as Record<string, unknown>).venues = {})), { code: 'invalidStructure', key: 'venues', issue: 'invalidType' })
    expectError(mutate((d) => ((d as Record<string, unknown>).stakes = null)), { code: 'invalidStructure', key: 'stakes', issue: 'invalidType' })
    expectError(mutate((d) => ((d as Record<string, unknown>).settings = [])), { code: 'invalidStructure', key: 'settings', issue: 'invalidType' })
    expectError(mutate((d) => delete (d as Record<string, unknown>).settings), { code: 'invalidStructure', key: 'settings', issue: 'required' })
    expectError(mutate((d) => (d.hands = [])), { code: 'invalidStructure', key: 'hands', issue: 'unknownKey' })
  })

  it('空的備份檔（沒有任何資料）合法', () => {
    const r = validateBackup({ app: BACKUP_APP, schemaVersion: 1, exportedAt: TS, sessions: [], venues: [], stakes: [], settings: {} })
    expect(r.ok).toBe(true)
  })
})

describe('8.5 驗證：每筆資料通過 Zod（與第 3 節規則一致）', () => {
  it('回報第一筆有問題的資料：集合、序號（1 起算）、id、欄位路徑', () => {
    const err = expectError(
      mutate((d) => {
        d.sessions[2]!.buyIns = [{ amount: 1000, fee: 1001 }]
        d.sessions[1]!.durationMin = 0
      }),
      { code: 'invalidRecord', collection: 'sessions', index: 2, id: uuid(2), path: ['durationMin'], issue: 'tooSmall' },
    )
    expect(err.index).toBe(2)
  })

  it('服務費大於買入：buyIns[0].fee', () => {
    expectError(
      mutate((d) => (d.sessions[0]!.buyIns = [{ amount: 1000, fee: 1001 }])),
      { collection: 'sessions', index: 1, path: ['buyIns', 0, 'fee'], issue: 'feeExceedsAmount' },
    )
  })

  const sessionCases: [string, (s: Record<string, unknown>) => void, Partial<BackupError>][] = [
    ['缺少必填欄位', (s) => delete s.cashOut, { path: ['cashOut'], issue: 'required' }],
    ['金額不是整數', (s) => (s.cashOut = 1.5), { path: ['cashOut'], issue: 'notInteger' }],
    ['金額超出上限', (s) => (s.cashOut = 100_000_000), { path: ['cashOut'], issue: 'tooBig' }],
    ['型別錯誤', (s) => (s.cashOut = '100'), { path: ['cashOut'], issue: 'invalidType' }],
    ['未知類型', (s) => (s.type = 'sng'), { path: ['type'], issue: 'invalidValue' }],
    ['id 不是 UUID', (s) => (s.id = 'abc'), { id: 'abc', path: ['id'], issue: 'invalidFormat' }],
    ['startAt 不是整點', (s) => (s.startAt = '2026-09-27T20:30'), { path: ['startAt'], issue: 'invalidStartAt' }],
    ['startAt 日期不存在', (s) => (s.startAt = '2026-02-30T20:00'), { path: ['startAt'], issue: 'invalidStartAt' }],
    ['時長超過 72 小時', (s) => (s.durationMin = 4321), { path: ['durationMin'], issue: 'tooBig' }],
    ['買入 0 筆', (s) => (s.buyIns = []), { path: ['buyIns'], issue: 'tooSmall' }],
    ['買入超過 20 筆', (s) => (s.buyIns = Array.from({ length: 21 }, () => ({ amount: 1, fee: 0 }))), { path: ['buyIns'], issue: 'tooBig' }],
    ['買入金額 0', (s) => (s.buyIns = [{ amount: 0, fee: 0 }]), { path: ['buyIns', 0, 'amount'], issue: 'tooSmall' }],
    ['買入含未知欄位', (s) => (s.buyIns = [{ amount: 1, fee: 0, tip: 1 }]), { path: ['buyIns', 0, 'tip'], issue: 'unknownKey' }],
    ['名稱前後有空白', (s) => (s.name = ' x '), { path: ['name'], issue: 'notTrimmed' }],
    ['名稱空字串', (s) => (s.name = ''), { path: ['name'], issue: 'emptyText' }],
    ['名稱超過 50 字', (s) => (s.name = 'a'.repeat(51)), { path: ['name'], issue: 'textTooLong' }],
    ['備註超過 500 字', (s) => (s.note = 'a'.repeat(501)), { path: ['note'], issue: 'textTooLong' }],
    ['參賽人數 1', (s) => (s.fieldSize = 1), { path: ['fieldSize'], issue: 'tooSmall' }],
    ['名次大於參賽人數', (s) => (s.finishPlace = 181), { path: ['finishPlace'], issue: 'finishPlaceExceedsFieldSize' }],
    [
      '填名次未填參賽人數',
      (s) => (s.fieldSize = null),
      { path: ['finishPlace'], issue: 'finishPlaceRequiresFieldSize' },
    ],
    ['錦標賽有盲注', (s) => (s.stakeId = S1), { path: ['stakeId'], issue: 'stakeNotAllowed' }],
    ['時間戳不含時區', (s) => (s.createdAt = '2026-09-28T21:05:00'), { path: ['createdAt'], issue: 'invalidFormat' }],
    ['未知欄位', (s) => (s.hands = []), { path: ['hands'], issue: 'unknownKey' }],
  ]
  // sessions[2] 依 id 排序後是 uuid(3) 的 MTT（有名次與參賽人數）
  for (const [name, fn, expected] of sessionCases) {
    it(`sessions：${name}`, () => {
      expectError(
        mutate((d) => fn(d.sessions[2]!)),
        { code: 'invalidRecord', collection: 'sessions', index: 3, id: uuid(3), ...expected },
      )
    })
  }

  it('現金桌規則：買入恰 1 筆、必須有盲注；非 MTT 不可有參賽人數與名次', () => {
    expectError(
      mutate((d) => (d.sessions[0]!.buyIns = [{ amount: 1, fee: 0 }, { amount: 1, fee: 0 }])),
      { collection: 'sessions', index: 1, path: ['buyIns'], issue: 'cashBuyInCount' },
    )
    expectError(mutate((d) => (d.sessions[0]!.stakeId = null)), { collection: 'sessions', index: 1, path: ['stakeId'], issue: 'cashStakeRequired' })
    expectError(mutate((d) => (d.sessions[1]!.fieldSize = 10)), { collection: 'sessions', index: 2, path: ['fieldSize'], issue: 'fieldSizeNotAllowed' })
    expectError(mutate((d) => (d.sessions[1]!.finishPlace = 1)), { collection: 'sessions', index: 2, path: ['finishPlace'], issue: 'finishPlaceNotAllowed' })
  })

  it('sessions 某筆不是物件：id 為 null', () => {
    expectError(mutate((d) => ((d.sessions as unknown[])[0] = 'x')), { collection: 'sessions', index: 1, id: null, issue: 'invalidType' })
  })

  it('venues：名稱空白、前後空白、超過 30 字、archived 型別錯誤', () => {
    expectError(mutate((d) => (d.venues[0]!.name = '')), { code: 'invalidRecord', collection: 'venues', index: 1, id: V1, path: ['name'], issue: 'emptyText' })
    expectError(mutate((d) => (d.venues[1]!.name = ' B ')), { collection: 'venues', index: 2, id: V2, path: ['name'], issue: 'notTrimmed' })
    expectError(mutate((d) => (d.venues[0]!.name = 'a'.repeat(31))), { collection: 'venues', path: ['name'], issue: 'textTooLong' })
    expectError(mutate((d) => (d.venues[0]!.archived = 'no')), { collection: 'venues', path: ['archived'], issue: 'invalidType' })
    expectError(mutate((d) => (d.venues[0]!.sortOrder = 0.5)), { collection: 'venues', path: ['sortOrder'], issue: 'notInteger' })
  })

  it('stakes：sb < 1、bb < sb', () => {
    expectError(mutate((d) => (d.stakes[0]!.sb = 0)), { code: 'invalidRecord', collection: 'stakes', index: 1, id: S1, path: ['sb'], issue: 'tooSmall' })
    expectError(mutate((d) => (d.stakes[1]!.bb = 50)), { collection: 'stakes', index: 2, id: S2, path: ['bb'], issue: 'bbLessThanSb' })
  })

  it('檢查順序：sessions 的錯誤優先於 venues、stakes', () => {
    expectError(
      mutate((d) => {
        d.stakes[0]!.sb = 0
        d.venues[0]!.name = ''
        d.sessions[1]!.cashOut = -5
      }),
      { collection: 'sessions' },
    )
    expectError(
      mutate((d) => {
        d.stakes[0]!.sb = 0
        d.venues[0]!.name = ''
      }),
      { collection: 'venues' },
    )
  })

  it('settings：允許缺 key；值不合法時回報 key；未知 key 視為錯誤', () => {
    expect(validateBackup(mutate((d) => (d.settings = {}))).ok).toBe(true)
    expectError(mutate((d) => (d.settings.lastType = 'sng')), { code: 'invalidRecord', collection: 'settings', key: 'lastType', issue: 'invalidValue' })
    expectError(mutate((d) => (d.settings.profitColorScheme = 'blue')), { collection: 'settings', key: 'profitColorScheme' })
    expectError(mutate((d) => (d.settings.lastVenueByType = { poker: 'x' })), { collection: 'settings', key: 'lastVenueByType' })
    expectError(mutate((d) => (d.settings.theme = 'dark')), { code: 'invalidRecord', collection: 'settings', key: 'theme', issue: 'unknownKey' })
  })

  it('settings 內的 recordDraft、lastBackupAt 直接忽略（不驗證、不匯入）', () => {
    const r = validateBackup(
      mutate((d) => {
        d.settings.recordDraft = 'not-an-object'
        d.settings.lastBackupAt = 'bad'
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.settings).not.toHaveProperty('recordDraft')
    expect(r.backup.settings).not.toHaveProperty('lastBackupAt')
  })
})

describe('8.5 驗證：不可重複（3.3、3.4）', () => {
  it('同一集合內 id 重複：回報第二次出現的位置', () => {
    expectError(
      mutate((d) => (d.sessions[2]!.id = d.sessions[0]!.id)),
      { code: 'duplicateId', collection: 'sessions', index: 3, id: uuid(1), value: uuid(1) },
    )
    expectError(mutate((d) => (d.venues[1]!.id = V1)), { code: 'duplicateId', collection: 'venues', index: 2 })
    expectError(mutate((d) => (d.stakes[1]!.id = S1)), { code: 'duplicateId', collection: 'stakes', index: 2 })
  })

  it('場地名稱重複（不分大小寫）', () => {
    const b = mutate((d) => {
      d.venues[0]!.name = 'Ace Club'
      d.venues[1]!.name = 'ace club'
    })
    expectError(b, { code: 'duplicateVenueName', collection: 'venues', index: 2, id: V2, value: 'ace club' })
  })

  it('盲注 sb/bb 重複', () => {
    expectError(
      mutate((d) => {
        d.stakes[1]!.sb = 50
        d.stakes[1]!.bb = 100
      }),
      { code: 'duplicateStake', collection: 'stakes', index: 2, id: S2, value: '50/100' },
    )
  })
})

describe('8.5 驗證：參照完整性', () => {
  it('venueId 不存在於備份檔內', () => {
    const missing = uuid(0xdead)
    expectError(
      mutate((d) => (d.sessions[2]!.venueId = missing)),
      { code: 'missingReference', collection: 'sessions', index: 3, id: uuid(3), path: ['venueId'], value: missing },
    )
  })

  it('stakeId 不存在於備份檔內', () => {
    expectError(
      mutate((d) => (d.stakes = d.stakes.filter((s) => s.id !== S1))),
      { code: 'missingReference', collection: 'sessions', index: 1, id: uuid(1), path: ['stakeId'], value: S1 },
    )
  })

  it('已封存的場地與盲注仍可被參照', () => {
    const r = validateBackup(mutate((d) => (d.stakes[0]!.archived = true)))
    expect(r.ok).toBe(true)
  })
})

describe('8.5 錯誤顯示文字', () => {
  const describe_ = (input: unknown) => {
    const r = validateBackup(input)
    if (r.ok) throw new Error('expected error')
    return describeBackupError(r.error)
  }

  it('資料錯誤：集合名、序號、id、欄位路徑與說明', () => {
    expect(describe_(mutate((d) => (d.sessions[0]!.buyIns = [{ amount: 1000, fee: 1001 }])))).toEqual({
      reason: '資料未通過檢查',
      detail: `sessions 第 1 筆（id: ${uuid(1)}）：buyIns[0].fee 服務費不可大於買入`,
    })
  })

  it('檔案層級錯誤沒有位置', () => {
    expect(describeBackupError({ code: 'invalidJson' })).toEqual({ reason: '檔案不是有效的 JSON', detail: null })
    expect(describeBackupError({ code: 'wrongApp' }).reason).toBe('這不是德州記帳的備份檔')
    expect(describeBackupError({ code: 'schemaTooNew' }).reason).toContain('較新版本')
  })

  it('參照不存在、重複、settings、頂層結構', () => {
    const missing = uuid(0xbeef)
    expect(describe_(mutate((d) => (d.sessions[2]!.venueId = missing))).detail).toBe(
      `sessions 第 3 筆（id: ${uuid(3)}）：venueId ${missing} 不存在`,
    )
    expect(describe_(mutate((d) => (d.venues[1]!.name = 'a 場'))).detail).toBe(`venues 第 2 筆（id: ${V2}）：場地名稱「a 場」重複`)
    expect(describe_(mutate((d) => (d.settings.theme = 1))).detail).toBe('settings.theme：含有無法辨識的欄位')
    expect(describe_(mutate((d) => delete d.exportedAt)).detail).toBe('欄位 exportedAt：缺少必填欄位')
    expect(describe_(mutate((d) => ((d.sessions as unknown[])[0] = 5))).detail).toBe('sessions 第 1 筆：型別不正確')
  })
})

describe('formatIssuePath', () => {
  it('陣列索引以 [n] 表示', () => {
    expect(formatIssuePath(['buyIns', 0, 'fee'])).toBe('buyIns[0].fee')
    expect(formatIssuePath(['name'])).toBe('name')
    expect(formatIssuePath([])).toBe('')
  })
})
