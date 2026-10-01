// SPEC-v2-hands 10.1–10.3 備份 schemaVersion 3：匯出含 hands、遷移 1 → 2 → 3、v3 驗證
// 12.2 HC22；HC30、HC31 的備份部分；12.3 H0「備份 schemaVersion 3：HC22 通過；匯出 → 清除所有資料 → 匯入，hands 逐欄還原」
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb, type PokerDb } from '../../src/db'
import {
  BACKUP_MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  buildBackup,
  migrateBackup,
  parseBackupText,
  serializeBackup,
  validateBackup,
  type BackupError,
  type BackupFile,
  type Session,
} from '../../src/domain'
import type { Hand } from '../../src/domain/hands'
import { clearAllData, loadAllData, replaceAllData } from '../../src/features/settings/dataTransfer'
import { describeBackupError } from '../../src/features/settings/backupErrorText'
import { completeCaseHands } from './helpers/handCases'
import { EXAMPLE_79_BOARD, buildHand, example79Detail, example79Hand } from './helpers/hands'

const v1Text = readFileSync(new URL('../fixtures/backup-v1.json', import.meta.url), 'utf8')
const v2Text = readFileSync(new URL('../fixtures/backup-v2.json', import.meta.url), 'utf8')

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const TS = '2026-09-28T21:05:00+08:00'
const CASH_ID = uuid(0xa1)
const MTT_ID = uuid(0xa2)
const STAKE_ID = uuid(0xc1)

const baseSession = {
  venueId: null,
  name: null,
  note: null,
  fieldSize: null,
  finishPlace: null,
  backers: [] as Session['backers'],
  createdAt: TS,
  updatedAt: TS,
} as const

const sessions: Session[] = [
  { ...baseSession, id: CASH_ID, type: 'cash', startAt: '2026-09-27T20:00', durationMin: 60, buyIns: [{ amount: 20000, fee: 0 }], cashOut: 36800, stakeId: STAKE_ID },
  { ...baseSession, id: MTT_ID, type: 'mtt', startAt: '2026-09-14T13:00', durationMin: 300, buyIns: [{ amount: 3400, fee: 400 }], cashOut: 0, stakeId: null },
]

/** v3 備份檔用的手牌：完整（掛現金桌場次）、錦標賽備忘（掛 MTT）、GG、未完成、以及 12.2 表的所有完整手牌 */
function v3Hands(): Hand[] {
  const d = example79Detail()
  const partial = buildHand(
    {
      detail: { ...d, seats: d.seats.map((s) => (s.seatNo === 4 ? s : { ...s, cards: [] })), actions: d.actions.slice(0, 7), rake: 0, collected: [] },
      board: ['Kh', '7d', '2c'],
      tags: ['未完成'],
    },
    { exportSeq: 3 },
  )
  const fixed = completeCaseHands().map((c, i) => ({ ...c.hand, id: uuid(0x900 + i), exportSeq: 10 + i }))
  return [
    example79Hand({ id: uuid(0xd1), exportSeq: 1, sessionId: CASH_ID, tags: ['3bet', 'BTN'], note: '第一行\n第二行' }),
    buildHand({ detail: null, gameType: 'tournament', sessionId: MTT_ID, heroCards: ['Qh', 'Qd'], bb: 400, heroNet: -2500, heroPosition: 'UTG1' }, { id: uuid(0xd2), exportSeq: 2 }),
    { ...partial, id: uuid(0xd3) },
    buildHand(
      {
        detail: { ...d, rake: 44, collected: [{ seatNo: 4, potIndex: 0, amount: 34256 }] },
        board: EXAMPLE_79_BOARD,
        source: 'gg',
        playedAt: '2026-09-20T22:05:13',
        sourceHandId: 'RC1000000001',
        rawText: 'Poker Hand #RC1000000001: Hold\'em No Limit ($0.1/$0.25) - 2026/09/20 22:05:13',
      },
      { id: uuid(0xd4), exportSeq: 4 },
    ),
    ...fixed,
  ]
}

function v3Backup(hands: Hand[] = v3Hands(), settings: BackupFile['settings'] = {}): BackupFile {
  return buildBackup(
    {
      sessions,
      venues: [],
      stakes: [{ id: STAKE_ID, sb: 100, bb: 200, archived: false, sortOrder: 0 }],
      hands,
      settings: { lastType: 'cash', handHeroName: 'Din_0326', lastHandSeq: 30, ...settings },
    },
    new Date(2026, 9, 1, 21, 5),
  )
}

/** 序列化後修改，模擬被竄改的備份檔 */
function mutateV3(fn: (data: { hands: Record<string, unknown>[]; [k: string]: unknown }) => void): string {
  const data = JSON.parse(serializeBackup(v3Backup()))
  fn(data)
  return JSON.stringify(data)
}

function expectRejected(text: string, expected: Partial<BackupError>): BackupError {
  const r = parseBackupText(text)
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error('unreachable')
  expect(r.error).toMatchObject(expected)
  return r.error
}

let seq = 0
const opened: PokerDb[] = []
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})
function newDb(): PokerDb {
  const db = createDb(`hands-backup-${Date.now()}-${++seq}`)
  opened.push(db)
  return db
}

describe('10.1 匯出 schemaVersion 3', () => {
  it('10.1 格式：schemaVersion 3、頂層含 hands（sessions、venues、stakes、hands、settings 的順序）；hands 依 id 排序、欄位與 3.1 完全一致', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3)
    const hands = v3Hands()
    const b = v3Backup([...hands].reverse())
    expect(b.schemaVersion).toBe(3)
    expect(Object.keys(b)).toEqual(['app', 'schemaVersion', 'exportedAt', 'sessions', 'venues', 'stakes', 'hands', 'settings'])
    const ids = b.hands.map((h) => h.id)
    expect(ids).toEqual([...ids].sort())
    const json = JSON.parse(serializeBackup(b))
    const first = json.hands.find((h: Hand) => h.id === uuid(0xd1))
    expect(Object.keys(first).sort()).toEqual(Object.keys(example79Hand()).sort())
    expect(first).toEqual(hands[0])
  })

  it('10.1 settings 不包含 recordDraft、lastBackupAt、handDraft；包含 handHeroName、lastHandSeq、lastHandSetup', () => {
    const b = buildBackup(
      {
        sessions: [],
        venues: [],
        stakes: [],
        hands: [],
        settings: {
          recordDraft: { version: 1 },
          handDraft: { mode: 'simple' },
          lastBackupAt: TS,
          handHeroName: 'Hero',
          lastHandSeq: 12,
          lastHandSetup: { gameType: 'cash', tableSize: 6, sb: 100, bb: 200, ante: 0, straddle: 0, defaultStack: 20000, heroSeat: 1 },
        },
      },
      new Date(2026, 9, 1),
    )
    expect(b.settings).toEqual({
      handHeroName: 'Hero',
      lastHandSeq: 12,
      lastHandSetup: { gameType: 'cash', tableSize: 6, sb: 100, bb: 200, ante: 0, straddle: 0, defaultStack: 20000, heroSeat: 1 },
    })
  })
})

describe('HC22 備份遷移', () => {
  it('HC22 schemaVersion 1 的 fixture 匯入成功，hands 為 []（1 → 2 → 3）', () => {
    const r = parseBackupText(v1Text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.schemaVersion).toBe(3)
    expect(r.backup.hands).toEqual([])
    expect(r.backup.sessions.every((s) => Array.isArray(s.backers) && s.backers.length === 0)).toBe(true)
  })

  it('HC22 schemaVersion 2 的 fixture 匯入成功，hands 為 []；其他欄位不變', () => {
    const raw = JSON.parse(v2Text)
    const r = parseBackupText(v2Text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.hands).toEqual([])
    expect(r.backup.sessions).toEqual(raw.sessions)
    expect(r.backup.venues).toEqual(raw.venues)
    expect(r.backup.stakes).toEqual(raw.stakes)
    expect(r.backup.settings).toEqual(raw.settings)
    expect(r.backup.exportedAt).toBe(raw.exportedAt)
  })

  it('HC22 檔案意外含 `hands` 的 2 版檔案仍覆寫為 []', () => {
    const raw = JSON.parse(v2Text)
    for (const hands of [[example79Hand()], 'garbage', [{ broken: true }]]) {
      const r = validateBackup({ ...raw, hands })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.backup.hands).toEqual([])
    }
    expect(BACKUP_MIGRATIONS[2]!({ schemaVersion: 2, hands: [1, 2] })).toEqual({ schemaVersion: 2, hands: [] })
    expect(migrateBackup({ schemaVersion: 2, sessions: [] })).toEqual({ schemaVersion: 3, sessions: [], hands: [] })
  })

  it('HC22 3 版檔案 hands 逐欄還原（解析）', () => {
    const b = v3Backup()
    const r = parseBackupText(serializeBackup(b))
    expect(r).toEqual({ ok: true, backup: b })
    if (!r.ok) return
    expect(r.backup.hands).toEqual([...v3Hands()].sort((a, c) => (a.id < c.id ? -1 : 1)))
  })

  it('H0 驗收：匯出 → 清除所有資料 → 匯入，hands 逐欄還原（DB）', async () => {
    const db = newDb()
    const backup = v3Backup()
    await replaceAllData(db, backup)
    const exported = buildBackup(await loadAllData(db), new Date(2026, 9, 2))
    const text = serializeBackup(exported)
    await clearAllData(db)
    expect(await db.hands.count()).toBe(0)
    const r = parseBackupText(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await replaceAllData(db, r.backup)
    const after = await loadAllData(db)
    const sortById = (list: Hand[]) => [...list].sort((a, c) => (a.id < c.id ? -1 : 1))
    expect(sortById(after.hands)).toStrictEqual(sortById(v3Hands()))
    expect(after.settings).toMatchObject({ handHeroName: 'Din_0326', lastHandSeq: 30, lastBackupAt: exported.exportedAt })
  })

  it('HC22 行動不合法的 3 版檔案被拒：invalidHandDetail，附第幾個行動；顯示「hands 第 N 筆（id: …）：行動不合法（第 5 個行動）」', () => {
    const text = mutateV3((data) => {
      const h = data.hands.find((x) => x.id === uuid(0xd1)) as unknown as Hand
      h.detail!.actions[4] = { ...h.detail!.actions[4]!, type: 'check' }
    })
    const index = v3Backup().hands.findIndex((h) => h.id === uuid(0xd1)) + 1
    const e = expectRejected(text, {
      code: 'invalidHandDetail',
      collection: 'hands',
      index,
      id: uuid(0xd1),
      handIssue: 'illegalAction',
      actionIndex: 5,
      actionError: 'cannotCheck',
    })
    expect(describeBackupError(e)).toEqual({
      reason: '手牌的牌局內容不合法',
      detail: `hands 第 ${index} 筆（id: ${uuid(0xd1)}）：行動不合法（第 5 個行動）`,
    })
  })

  it('HC22 sessionId 不存在的 3 版檔案被拒：missingReference', () => {
    const text = mutateV3((data) => {
      data.sessions = (data.sessions as Session[]).filter((s) => s.id !== CASH_ID)
    })
    const e = expectRejected(text, { code: 'missingReference', collection: 'hands', id: uuid(0xd1), path: ['sessionId'], value: CASH_ID })
    expect(describeBackupError(e).detail).toMatch(/：關聯的場次 .+ 不存在$/)
  })

  it('HC22 exportSeq 重複的 3 版檔案被拒：duplicateExportSeq', () => {
    const text = mutateV3((data) => {
      data.hands[1]!.exportSeq = data.hands[0]!.exportSeq
    })
    const e = expectRejected(text, { code: 'duplicateExportSeq', collection: 'hands', index: 2, path: ['exportSeq'] })
    expect(describeBackupError(e)).toEqual({
      reason: '手牌的匯出編號重複',
      detail: expect.stringMatching(/^hands 第 2 筆（id: .+）：匯出編號 \d+ 重複$/),
    })
  })

  it('HC22 被拒時原資料不變（驗證失敗不呼叫取代）', async () => {
    const db = newDb()
    await replaceAllData(db, v3Backup())
    const before = await loadAllData(db)
    for (const text of [
      mutateV3((d) => (d.hands[0]!.exportSeq = d.hands[1]!.exportSeq)),
      mutateV3((d) => (d.hands[0]!.sessionId = uuid(0xeee))),
    ]) {
      const r = parseBackupText(text)
      expect(r.ok).toBe(false)
      if (r.ok) await replaceAllData(db, r.backup)
    }
    expect(await loadAllData(db)).toEqual(before)
  })

  it('3 版檔案：sourceHandId 重複（gg）、手牌 id 重複、關聯場次類型不相容、hands 某筆不合 Zod', () => {
    const gg = v3Backup().hands.find((h) => h.source === 'gg')!
    expectRejected(
      mutateV3((d) => d.hands.push({ ...gg, id: uuid(0xd9), exportSeq: 99 } as unknown as Record<string, unknown>)),
      { code: 'duplicateSourceHandId', collection: 'hands', value: 'RC1000000001' },
    )
    expectRejected(
      mutateV3((d) => d.hands.push({ ...d.hands[0]!, exportSeq: 98 })),
      { code: 'duplicateId', collection: 'hands' },
    )
    expectRejected(
      mutateV3((d) => {
        const h = d.hands.find((x) => x.id === uuid(0xd1))!
        h.sessionId = MTT_ID
      }),
      { code: 'invalidRecord', collection: 'hands', path: ['sessionId'], issue: 'sessionTypeMismatch' },
    )
    expectRejected(
      mutateV3((d) => (d.hands[0]!.tags = ['a', 'A'])),
      { code: 'invalidRecord', collection: 'hands', index: 1, issue: 'duplicateTag' },
    )
  })

  it('HC30 kind 被竄改為 complete 的未完成手牌在備份匯入時被拒', () => {
    const text = mutateV3((d) => {
      const h = d.hands.find((x) => x.id === uuid(0xd3))!
      h.kind = 'complete'
    })
    const e = expectRejected(text, { code: 'invalidRecord', collection: 'hands', id: uuid(0xd3), path: ['kind'], issue: 'kindMismatch' })
    expect(describeBackupError(e).detail).toMatch(/：kind 紀錄類型（完整 \/ 簡易）與牌局內容不符$/)
  })

  it('HC31 amountUnit 與推導不符的手牌在備份匯入時被拒', () => {
    for (const unit of ['cent', 'chip']) {
      const e = expectRejected(
        mutateV3((d) => (d.hands.find((x) => x.id === uuid(0xd1))!.amountUnit = unit)),
        { code: 'invalidRecord', collection: 'hands', id: uuid(0xd1), path: ['amountUnit'], issue: 'amountUnitMismatch' },
      )
      expect(describeBackupError(e).detail).toMatch(/：amountUnit 金額單位與來源、牌局類型不符$/)
    }
  })

  it('摘要欄位被竄改（heroNet）被拒；settings 的 handDraft 直接忽略、handHeroName 不合法被拒', () => {
    expectRejected(
      mutateV3((d) => (d.hands.find((x) => x.id === uuid(0xd1))!.heroNet = 1)),
      { code: 'invalidRecord', path: ['heroNet'], issue: 'summaryMismatch' },
    )
    const withDraft = JSON.parse(serializeBackup(v3Backup()))
    withDraft.settings.handDraft = { anything: true }
    const ok = validateBackup(withDraft)
    expect(ok.ok && 'handDraft' in ok.backup.settings).toBe(false)
    for (const name of ['1abc', 'Din:1', 'villain3', 'A'.repeat(13)]) {
      expectRejected(JSON.stringify({ ...withDraft, settings: { handHeroName: name } }), {
        code: 'invalidRecord',
        collection: 'settings',
        key: 'handHeroName',
      })
    }
  })
})
