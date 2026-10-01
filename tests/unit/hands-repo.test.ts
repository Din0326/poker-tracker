// handRepo（SPEC-v2-hands 3.1、3.11、5.8、6.4、7.4）、刪除場次的手牌處理（6.5）
// 12.2 HC24、HC26（與匯出無關的部分）、HC31（儲存部分）；12.3 H0「exportSeq 配發」「刪除場次的手牌處理」
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HandLockedError,
  HandVerificationError,
  ReferenceNotFoundError,
  SessionTypeMismatchError,
  TypeImmutableError,
  ValidationError,
  AlreadyExistsError,
  createDb,
  createRepositories,
  type HandInput,
  type PokerDb,
} from '../../src/db'
import { buildBackup, type BackupFile } from '../../src/domain'
import { loadAllData, replaceAllData } from '../../src/features/settings/dataTransfer'
import { EXAMPLE_79_BOARD, buildHand, example79Detail, example79Hand } from './helpers/hands'

let seq = 0
const opened: PokerDb[] = []
let clock = new Date(2026, 9, 1, 21, 5, 0)

function setup() {
  const db = createDb(`hands-repo-${Date.now()}-${++seq}`)
  opened.push(db)
  clock = new Date(2026, 9, 1, 21, 5, 0)
  const repos = createRepositories(db, { now: () => clock })
  return { db, repos }
}

afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})

const memo = (extra: Partial<HandInput> = {}): HandInput => ({
  source: 'manual',
  gameType: 'cash',
  playedAt: '2026-09-30T21:15:00',
  detail: null,
  heroCards: ['Ah', 'Kd'],
  ...extra,
})

const example79Input = (extra: Partial<HandInput> = {}): HandInput => ({
  source: 'manual',
  gameType: 'cash',
  playedAt: '2026-09-30T21:15:00',
  // 手動紀錄的 collected 由系統計算，輸入的值被忽略
  detail: { ...example79Detail(), collected: [] },
  board: EXAMPLE_79_BOARD,
  ...extra,
})

async function cashSession(repos: ReturnType<typeof setup>['repos']) {
  const stake = await repos.stakes.create(1, 2)
  return repos.sessions.create({
    type: 'cash',
    startAt: '2026-09-27T20:00',
    durationMin: 60,
    buyIns: [{ amount: 1000, fee: 0 }],
    cashOut: 1500,
    stakeId: stake.id,
  })
}

async function mttSession(repos: ReturnType<typeof setup>['repos']) {
  return repos.sessions.create({ type: 'mtt', startAt: '2026-09-14T13:00', durationMin: 60, buyIns: [{ amount: 1000, fee: 0 }], cashOut: 0 })
}

describe('handRepo.create', () => {
  it('簡易備忘：系統產生 id、exportSeq、kind、amountUnit、時間戳；標籤去除前後空白、備註空字串為 null', async () => {
    const { repos } = setup()
    const h = await repos.hands.create(memo({ tags: [' 3bet ', 'BTN'], note: '', heroNet: -1250, bb: 200 }))
    expect(h).toMatchObject({
      exportSeq: 1,
      kind: 'simple',
      source: 'manual',
      amountUnit: 'yuan',
      sessionId: null,
      tags: ['3bet', 'BTN'],
      note: null,
      heroNet: -1250,
      bb: 200,
      detail: null,
      createdAt: '2026-10-01T21:05:00+08:00',
      updatedAt: '2026-10-01T21:05:00+08:00',
    })
    expect(h.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await repos.hands.get(h.id)).toEqual(h)
    expect(await repos.settings.get('lastHandSeq')).toBe(1)
  })

  it('7.9 範例：摘要欄位與 collected 由系統推導，kind complete，與規格 JSON 完全相同', async () => {
    const { repos } = setup()
    const h = await repos.hands.create(example79Input({ heroNet: 1, bb: 5, heroPosition: 'CO' }))
    const spec = example79Hand()
    expect(h).toEqual({ ...spec, id: h.id, createdAt: h.createdAt, updatedAt: h.updatedAt })
  })

  it('驗證失敗不寫入、不配發序號：Zod 失敗丟 ValidationError、3.9 結構驗證失敗丟 HandVerificationError', async () => {
    const { repos } = setup()
    await expect(repos.hands.create(memo({ heroCards: ['Ah'] }))).rejects.toBeInstanceOf(ValidationError)
    const d = example79Detail()
    const illegal = { ...d, actions: d.actions.map((a, i) => (i === 0 ? { ...a, type: 'check' as const } : a)) }
    await expect(repos.hands.create(example79Input({ detail: illegal }))).rejects.toBeInstanceOf(HandVerificationError)
    expect(await repos.hands.list()).toEqual([])
    expect(await repos.settings.get('lastHandSeq')).toBeUndefined()
  })

  it('3.11 關聯場次：必須存在；cash 只能關聯 cash 場次、tournament 只能關聯 mtt / timed_mtt', async () => {
    const { repos } = setup()
    const cash = await cashSession(repos)
    const mtt = await mttSession(repos)
    await expect(repos.hands.create(memo({ sessionId: 'nope' }))).rejects.toBeInstanceOf(ReferenceNotFoundError)
    await expect(repos.hands.create(memo({ sessionId: mtt.id }))).rejects.toBeInstanceOf(SessionTypeMismatchError)
    await expect(repos.hands.create(memo({ gameType: 'tournament', sessionId: cash.id }))).rejects.toBeInstanceOf(
      SessionTypeMismatchError,
    )
    expect((await repos.hands.create(memo({ sessionId: cash.id }))).sessionId).toBe(cash.id)
    expect((await repos.hands.create(memo({ gameType: 'tournament', sessionId: mtt.id }))).amountUnit).toBe('chip')
    expect(await repos.hands.listBySession(cash.id)).toHaveLength(1)
  })

  it('createMany：同一個 transaction，任何一手失敗整批不寫入', async () => {
    const { repos } = setup()
    const many = await repos.hands.createMany([memo(), memo(), memo()])
    expect(many.map((h) => h.exportSeq)).toEqual([1, 2, 3])
    await expect(repos.hands.createMany([memo(), memo({ sessionId: 'missing' })])).rejects.toBeInstanceOf(ReferenceNotFoundError)
    expect(await repos.hands.list()).toHaveLength(3)
    expect(await repos.settings.get('lastHandSeq')).toBe(3)
  })
})

describe('HC26 手牌編號（與匯出無關的部分）', () => {
  it('HC26 刪除最後一手後新增，新序號不重用；lastHandSeq 只增不減', async () => {
    const { repos } = setup()
    const [a, b, c] = [await repos.hands.create(memo()), await repos.hands.create(memo()), await repos.hands.create(memo())]
    expect([a.exportSeq, b.exportSeq, c.exportSeq]).toEqual([1, 2, 3])
    await repos.hands.delete(c.id)
    expect((await repos.hands.create(memo())).exportSeq).toBe(4)
    // 全部刪除後仍不重用
    for (const h of await repos.hands.list()) await repos.hands.delete(h.id)
    expect(await repos.settings.get('lastHandSeq')).toBe(4)
    expect((await repos.hands.create(memo())).exportSeq).toBe(5)
  })

  it('HC26 next = max(lastHandSeq, hands 表最大 exportSeq) + 1', async () => {
    const { db, repos } = setup()
    await repos.settings.set('lastHandSeq', 41)
    expect((await repos.hands.create(memo())).exportSeq).toBe(42)
    // hands 表有比 lastHandSeq 更大的序號（例如舊資料）時以表內最大值為準
    await db.hands.put({ ...example79Hand(), exportSeq: 100 })
    expect((await repos.hands.create(memo())).exportSeq).toBe(101)
    expect(await repos.settings.get('lastHandSeq')).toBe(101)
  })

  it('HC26 &exportSeq 唯一索引：同一個 exportSeq 無法寫入兩次', async () => {
    const { db } = setup()
    await db.hands.add(example79Hand({ exportSeq: 7 }))
    await expect(db.hands.add(example79Hand({ exportSeq: 7 }))).rejects.toThrow()
  })

  function backupWith(hands: BackupFile['hands'], lastHandSeq?: number): BackupFile {
    return {
      ...buildBackup({ sessions: [], venues: [], stakes: [], hands, settings: lastHandSeq === undefined ? {} : { lastHandSeq } }, new Date(2026, 9, 1)),
    }
  }

  it('HC26 備份匯入後 lastHandSeq = max(檔案中的 lastHandSeq（沒有時為 0）, 檔案 hands 的最大 exportSeq)，之後新增接續配發', async () => {
    const { db, repos } = setup()
    const hands = [example79Hand({ exportSeq: 3 }), example79Hand({ exportSeq: 7 })]
    // 檔案 lastHandSeq 較小 → 取 hands 最大值
    await replaceAllData(db, backupWith(hands, 5))
    expect(await repos.settings.get('lastHandSeq')).toBe(7)
    expect((await repos.hands.create(memo())).exportSeq).toBe(8)
    // 檔案 lastHandSeq 較大（備份前刪過手牌）→ 取 lastHandSeq
    await replaceAllData(db, backupWith(hands, 20))
    expect(await repos.settings.get('lastHandSeq')).toBe(20)
    expect((await repos.hands.create(memo())).exportSeq).toBe(21)
    // 檔案沒有 lastHandSeq → 視為 0
    await replaceAllData(db, backupWith(hands))
    expect(await repos.settings.get('lastHandSeq')).toBe(7)
    // 沒有手牌、也沒有 lastHandSeq → 0
    await replaceAllData(db, backupWith([]))
    expect(await repos.settings.get('lastHandSeq')).toBe(0)
    expect((await repos.hands.create(memo())).exportSeq).toBe(1)
  })

  it('HC26 備份檔包含 lastHandSeq（3.10 進備份）', async () => {
    const { db, repos } = setup()
    await repos.hands.create(memo())
    await repos.hands.create(memo())
    const backup = buildBackup(await loadAllData(db), new Date(2026, 9, 1))
    expect(backup.settings.lastHandSeq).toBe(2)
    expect(backup.hands.map((h) => h.exportSeq).sort()).toEqual([1, 2])
  })
})

describe('HC24 刪除場次', () => {
  it('HC24 場次底下 3 手手牌：刪除後 3 手 sessionId 為 null、updatedAt 不變；復原後 3 手重新關聯；刪除前已是獨立的手牌不受影響', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const other = await repos.sessions.create({ ...session, stakeId: session.stakeId })
    const linked = await repos.hands.createMany([memo({ sessionId: session.id }), memo({ sessionId: session.id }), memo({ sessionId: session.id })])
    const independent = await repos.hands.create(memo())
    const otherHand = await repos.hands.create(memo({ sessionId: other.id }))

    clock = new Date(2026, 9, 2, 10, 0, 0)
    const deleted = await repos.sessions.delete(session.id)
    expect([...deleted.detachedHandIds].sort()).toEqual(linked.map((h) => h.id).sort())
    expect(await repos.sessions.get(session.id)).toBeUndefined()
    for (const h of linked) {
      // 轉為獨立：只有 sessionId 改為 null，其餘欄位（含 updatedAt）不變
      expect(await repos.hands.get(h.id)).toEqual({ ...h, sessionId: null })
    }
    expect(await repos.hands.get(independent.id)).toEqual(independent)
    expect(await repos.hands.get(otherHand.id)).toEqual(otherHand)

    await repos.sessions.restore(deleted.session, deleted.detachedHandIds)
    expect(await repos.sessions.get(session.id)).toEqual(session)
    for (const h of linked) expect(await repos.hands.get(h.id)).toEqual(h)
    expect(await repos.hands.get(independent.id)).toEqual(independent)
    expect(await repos.hands.get(otherHand.id)).toEqual(otherHand)
  })

  it('HC24 復原只掛回「這次刪除時被轉為獨立、且目前 sessionId 仍為 null」的手牌；期間被刪除或改掛其他場次的不動', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const other = await repos.sessions.create({ ...session })
    const [a, b, c] = await repos.hands.createMany([memo({ sessionId: session.id }), memo({ sessionId: session.id }), memo({ sessionId: session.id })])
    const deleted = await repos.sessions.delete(session.id)
    await repos.hands.update(a!.id, { sessionId: other.id })
    await repos.hands.delete(b!.id)
    await repos.sessions.restore(deleted.session, deleted.detachedHandIds)
    expect((await repos.hands.get(a!.id))?.sessionId).toBe(other.id)
    expect(await repos.hands.get(b!.id)).toBeUndefined()
    expect((await repos.hands.get(c!.id))?.sessionId).toBe(session.id)
  })

  it('HC24 沒有傳 detachedHandIds 時（例如 v1 的呼叫方式）只寫回場次', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const h = await repos.hands.create(memo({ sessionId: session.id }))
    const deleted = await repos.sessions.delete(session.id)
    await repos.sessions.restore(deleted.session)
    expect((await repos.hands.get(h.id))?.sessionId).toBeNull()
  })

  it('HC24 刪除不存在的場次：丟出錯誤，手牌不受影響（同一個 transaction）', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const h = await repos.hands.create(memo({ sessionId: session.id }))
    await expect(repos.sessions.delete('nope')).rejects.toThrow()
    expect(await repos.hands.get(h.id)).toEqual(h)
  })

  it('HC24 復原失敗（同 id 場次已存在）時整個 transaction 還原，手牌不被掛回', async () => {
    const { db, repos } = setup()
    const session = await cashSession(repos)
    const h = await repos.hands.create(memo({ sessionId: session.id }))
    const deleted = await repos.sessions.delete(session.id)
    await db.sessions.add(deleted.session)
    await expect(repos.sessions.restore(deleted.session, deleted.detachedHandIds)).rejects.toBeInstanceOf(AlreadyExistsError)
    expect((await repos.hands.get(h.id))?.sessionId).toBeNull()
  })
})

describe('handRepo.update（5.8）', () => {
  it('HC31 手動簡易手牌由現金桌改為錦標賽後 amountUnit 變為 chip、bb 數值不變；id、exportSeq、createdAt 不變，updatedAt 更新', async () => {
    const { repos } = setup()
    const h = await repos.hands.create(memo({ bb: 200 }))
    expect(h.amountUnit).toBe('yuan')
    clock = new Date(2026, 9, 2, 8, 0, 0)
    const t = await repos.hands.update(h.id, { gameType: 'tournament' })
    expect(t).toMatchObject({ id: h.id, exportSeq: h.exportSeq, createdAt: h.createdAt, amountUnit: 'chip', gameType: 'tournament', bb: 200 })
    expect(t.updatedAt).toBe('2026-10-02T08:00:00+08:00')
  })

  it('補齊為完整手牌：同一 id，kind 變為 complete，備忘的 heroNet 被計算值取代', async () => {
    const { repos } = setup()
    const h = await repos.hands.create(memo({ heroCards: ['As', 'Ks'], heroNet: 5000, bb: 200 }))
    const done = await repos.hands.update(h.id, { detail: { ...example79Detail(), collected: [] }, board: EXAMPLE_79_BOARD })
    expect(done).toMatchObject({ id: h.id, exportSeq: h.exportSeq, kind: 'complete', heroNet: 16800 })
  })

  it('有 detail 時 gameType 不可變更（同時清除 detail 才可）', async () => {
    const { repos } = setup()
    const h = await repos.hands.create(example79Input())
    await expect(repos.hands.update(h.id, { gameType: 'tournament' })).rejects.toBeInstanceOf(TypeImmutableError)
    const cleared = await repos.hands.update(h.id, { gameType: 'tournament', detail: null })
    expect(cleared).toMatchObject({ kind: 'simple', amountUnit: 'chip', detail: null })
  })

  it('匯入的手牌（gg）只能修改關聯場次、標籤與備註（HQ17）', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const gg = await repos.hands.create(
      memo({ source: 'gg', playedAt: '2026-09-20T22:05:13', sourceHandId: 'RC1000000001', rawText: 'Poker Hand #RC1000000001: …', parserVersion: 1 }),
    )
    expect(gg.amountUnit).toBe('cent')
    const edited = await repos.hands.update(gg.id, { sessionId: session.id, tags: ['review'], note: 'n' })
    expect(edited).toMatchObject({ sessionId: session.id, tags: ['review'], note: 'n', rawText: gg.rawText })
    await expect(repos.hands.update(gg.id, { playedAt: '2026-09-20T22:05:14' })).rejects.toBeInstanceOf(HandLockedError)
    await expect(repos.hands.update(gg.id, { heroCards: ['2c', '3c'] })).rejects.toBeInstanceOf(HandLockedError)
    // 值相同的欄位不算變更
    expect((await repos.hands.update(gg.id, { playedAt: gg.playedAt })).playedAt).toBe(gg.playedAt)
  })
})

describe('handRepo.delete / restore（6.4）', () => {
  it('復原時以原始 id、exportSeq、createdAt、updatedAt 及所有欄位原封不動寫回', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const h = await repos.hands.create(example79Input({ sessionId: session.id, tags: ['a'] }))
    const removed = await repos.hands.delete(h.id)
    expect(removed).toEqual(h)
    expect(await repos.hands.get(h.id)).toBeUndefined()
    clock = new Date(2026, 9, 3)
    expect(await repos.hands.restore(removed)).toEqual(h)
    expect(await repos.hands.get(h.id)).toEqual(h)
    await expect(repos.hands.restore(removed)).rejects.toBeInstanceOf(AlreadyExistsError)
    // 序號沒有因刪除與復原而改變配發
    expect((await repos.hands.create(memo())).exportSeq).toBe(2)
  })

  it('原本關聯的場次在這段時間內被刪除：sessionId 改為 null 後寫回', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const h = await repos.hands.create(memo({ sessionId: session.id }))
    const removed = await repos.hands.delete(h.id)
    await repos.sessions.delete(session.id)
    expect(await repos.hands.restore(removed)).toEqual({ ...h, sessionId: null })
  })

  it('HC31 amountUnit 與推導不符的手牌在儲存時被拒', async () => {
    const { repos } = setup()
    const h = buildHand({ detail: null, heroCards: ['Ah', 'Kd'] })
    await expect(repos.hands.restore({ ...h, amountUnit: 'cent' })).rejects.toBeInstanceOf(ValidationError)
    await expect(repos.hands.restore({ ...h, amountUnit: 'chip' })).rejects.toBeInstanceOf(ValidationError)
    await expect(repos.hands.restore({ ...h, kind: 'complete' })).rejects.toBeInstanceOf(HandVerificationError)
    expect(await repos.hands.list()).toEqual([])
  })
})

describe('10.6 資料量：手牌數（完整 / 簡易）', () => {
  it('counts 依 kind 計數', async () => {
    const { repos } = setup()
    expect(await repos.hands.counts()).toEqual({ total: 0, complete: 0, simple: 0 })
    await repos.hands.createMany([memo(), memo(), example79Input()])
    expect(await repos.hands.counts()).toEqual({ total: 3, complete: 1, simple: 2 })
  })
})
