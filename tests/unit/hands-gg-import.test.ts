// SPEC-v2-hands 8.1、8.2、8.6、12.3 H4：GG 匯入的檔案讀取（.txt 單檔 / 多檔 / .zip、50 MB、1,000 個項目、解壓失敗）、
// 分批解析（進度、取消後不寫入）、寫入（單一 transaction，任何錯誤整批還原）、HC21 重複匯入、關聯場次。
// zip fixture 在測試中以 fflate 動態產生；所有 GG 原文都是非真實檔案（待以真實 PokerCraft 匯出驗證，HQ15）。
import 'fake-indexeddb/auto'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionTypeMismatchError, createDb, createRepositories, type PokerDb, type Repositories } from '../../src/db'
import { buildGgImportPreview, parsedSourceHandIds, type GgImportPreview } from '../../src/domain/hands'
import {
  GG_IMPORT_MAX_BYTES,
  parseImportTexts,
  readImportFiles,
  toGgHandInput,
  type ImportFileLike,
  type ParseProgress,
} from '../../src/features/hands/ggImportModel'
import { ZIP_MAX_ENTRIES, isImportableZipEntry } from '../../src/lib/unzip'
import { ggExampleFile } from './helpers/ggText'

let seq = 0
const opened: PokerDb[] = []

function setup() {
  const db = createDb(`gg-import-${Date.now()}-${++seq}`)
  opened.push(db)
  return { db, repos: createRepositories(db, { now: () => new Date(2026, 9, 3, 12, 0, 0) }) }
}

afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})

/** File 的替身：size 可以與實際內容不同（模擬大檔案而不實際產生內容）；read 記錄是否讀取過內容 */
function fileOf(name: string, content: string | Uint8Array, options: { size?: number; type?: string } = {}) {
  const bytes = typeof content === 'string' ? strToU8(content) : content
  const file = {
    name,
    size: options.size ?? bytes.length,
    type: options.type ?? '',
    reads: 0,
    async arrayBuffer() {
      file.reads++
      return bytes.slice().buffer as ArrayBuffer
    },
  }
  return file
}

const noYield = () => Promise.resolve()

/** 匯入頁的流程（不含畫面）：讀檔 → 分批解析 → 資料庫去重 → 預覽 */
async function previewOf(repos: Repositories, files: ImportFileLike[]): Promise<GgImportPreview> {
  const read = await readImportFiles(files)
  if (!read.ok) throw new Error(read.error)
  const items = (await parseImportTexts(read.texts, { yieldFn: noYield }))!
  return buildGgImportPreview(items, await repos.hands.existingSourceHandIds(parsedSourceHandIds(items)))
}

async function importAll(repos: Repositories, files: ImportFileLike[], sessionId: string | null = null) {
  const preview = await previewOf(repos, files)
  const hands = await repos.hands.createMany(
    preview.importable.map((h) => toGgHandInput(h, sessionId)),
    { skipExistingSourceHandIds: true },
  )
  return { preview, hands }
}

/** 8.1 zip fixture：2 個 .txt、1 個 .csv、1 個 __MACOSX/ 項目 */
function fixtureZip(): Uint8Array {
  return zipSync({
    'hands-1.txt': strToU8(ggExampleFile(2, 1_000_000_001)),
    'folder/hands-2.TXT': strToU8(ggExampleFile(3, 1_000_000_101)),
    'summary.csv': strToU8(ggExampleFile(1, 1_000_000_201)),
    '__MACOSX/._hands-1.txt': strToU8(ggExampleFile(1, 1_000_000_301)),
  })
}

describe('12.3 H4 匯入 .txt 單檔、多檔、.zip（8.1）', () => {
  it('12.3 H4 .txt 單檔：一個檔案可含多手', async () => {
    const { repos } = setup()
    const { preview, hands } = await importAll(repos, [fileOf('gg.txt', ggExampleFile(3))])
    expect([preview.total, preview.importable.length, preview.duplicates, preview.rejected]).toEqual([3, 3, 0, 0])
    expect(hands).toHaveLength(3)
    expect(hands.every((h) => h.source === 'gg' && h.amountUnit === 'cent' && h.kind === 'complete' && h.parserVersion === 1)).toBe(true)
    expect(hands.map((h) => h.exportSeq)).toEqual([1, 2, 3])
  })

  it('12.3 H4 .txt 多檔：檔案選擇器 multiple，所有檔案的手牌一起匯入', async () => {
    const { repos } = setup()
    const { hands } = await importAll(repos, [fileOf('a.txt', ggExampleFile(2, 1)), fileOf('b.txt', ggExampleFile(2, 101))])
    expect(hands.map((h) => h.sourceHandId)).toEqual(['RC1', 'RC2', 'RC101', 'RC102'])
  })

  it('12.3 H4 .zip：fixture 內含 2 個 .txt、1 個 .csv、1 個 __MACOSX/ 項目，只處理 2 個 .txt', async () => {
    const read = await readImportFiles([fileOf('PokerCraft.zip', fixtureZip())])
    expect(read.ok && read.texts.map((t) => t.name)).toEqual(['PokerCraft.zip/hands-1.txt', 'PokerCraft.zip/folder/hands-2.TXT'])
    const { repos } = setup()
    const { hands } = await importAll(repos, [fileOf('PokerCraft.zip', fixtureZip(), { type: 'application/zip' })])
    expect(hands.map((h) => h.sourceHandId)).toEqual(['RC1000000001', 'RC1000000002', 'RC1000000101', 'RC1000000102', 'RC1000000103'])
  })

  it('8.1 zip 項目篩選：忽略資料夾、其他副檔名（含巢狀 zip）、__MACOSX/、檔名以 . 開頭的項目；.txt 不分大小寫', () => {
    expect(isImportableZipEntry('a.txt')).toBe(true)
    expect(isImportableZipEntry('dir/b.TXT')).toBe(true)
    expect(isImportableZipEntry('dir/')).toBe(false)
    expect(isImportableZipEntry('c.csv')).toBe(false)
    expect(isImportableZipEntry('nested.zip')).toBe(false)
    expect(isImportableZipEntry('__MACOSX/a.txt')).toBe(false)
    expect(isImportableZipEntry('x/__MACOSX/a.txt')).toBe(false)
    expect(isImportableZipEntry('.hidden.txt')).toBe(false)
    expect(isImportableZipEntry('dir/._a.txt')).toBe(false)
  })

  it('8.1 文字解碼：UTF-8 去除 BOM、\\r\\n 與 \\r 正規化為 \\n', async () => {
    const { repos } = setup()
    const crlf = String.fromCharCode(0xfeff) + `${ggExampleFile(1).replaceAll('\n', '\r\n')}`
    const cr = ggExampleFile(1, 5).replaceAll('\n', '\r')
    const { hands } = await importAll(repos, [fileOf('crlf.txt', crlf), fileOf('cr.txt', cr)])
    expect(hands).toHaveLength(2)
    expect(hands[0]!.rawText!.includes('\r')).toBe(false)
    expect(hands[0]!.rawText!.charCodeAt(0)).not.toBe(0xfeff)
  })
})

describe('12.3 H4 8.1 的限制（50 MB、1,000 個項目、解壓失敗）', () => {
  it('12.3 H4 50 MB：所有 .txt 合計超過 50 MB → 檔案太大（以檔案大小在讀取內容之前檢查）', async () => {
    const big = fileOf('big.txt', 'x', { size: GG_IMPORT_MAX_BYTES + 1 })
    expect(await readImportFiles([big])).toEqual({ ok: false, error: 'tooLarge' })
    expect(big.reads).toBe(0)
    // 兩個檔案合計超過也拒絕；剛好 50 MB 可以
    const a = fileOf('a.txt', 'x', { size: GG_IMPORT_MAX_BYTES / 2 })
    const b = fileOf('b.txt', 'x', { size: GG_IMPORT_MAX_BYTES / 2 + 1 })
    expect(await readImportFiles([a, b])).toEqual({ ok: false, error: 'tooLarge' })
    expect((await readImportFiles([fileOf('ok.txt', 'x', { size: GG_IMPORT_MAX_BYTES })])).ok).toBe(true)
  })

  it('12.3 H4 50 MB：zip 以解壓後的大小計，與其他 .txt 合計超過 50 MB → 檔案太大', async () => {
    // 30 MB（模擬大小）的 .txt + zip 內解壓後 21 MB 的 .txt（壓縮後很小）
    const txt = fileOf('a.txt', 'x', { size: 30 * 1024 * 1024 })
    const zip = zipSync({ 'big.txt': new Uint8Array(21 * 1024 * 1024) }, { level: 1 })
    expect(zip.length).toBeLessThan(1024 * 1024)
    expect(await readImportFiles([txt, fileOf('b.zip', zip)])).toEqual({ ok: false, error: 'tooLarge' })
    // 只有 zip（21 MB）時不超過
    expect((await readImportFiles([fileOf('b.zip', zip)])).ok).toBe(true)
  })

  it('12.3 H4 1,000 個項目：壓縮檔內項目數 > 1,000 → 壓縮檔內的檔案太多；剛好 1,000 個可以', async () => {
    const entries = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.csv`, strToU8('x')]))
    expect(ZIP_MAX_ENTRIES).toBe(1000)
    expect(await readImportFiles([fileOf('many.zip', zipSync(entries(1001)))])).toEqual({ ok: false, error: 'tooManyEntries' })
    expect((await readImportFiles([fileOf('ok.zip', zipSync(entries(1000)))])).ok).toBe(true)
  })

  it('12.3 H4 解壓失敗：不是 zip 或損毀的壓縮檔 → 無法解壓縮這個檔案', async () => {
    expect(await readImportFiles([fileOf('broken.zip', 'this is not a zip file')])).toEqual({ ok: false, error: 'unzipFailed' })
    const truncated = fixtureZip().slice(0, 200)
    expect(await readImportFiles([fileOf('truncated.zip', truncated)])).toEqual({ ok: false, error: 'unzipFailed' })
  })

  it('8.1 讀取檔案失敗 → 無法讀取檔案', async () => {
    const bad = { name: 'a.txt', size: 1, type: '', arrayBuffer: () => Promise.reject(new Error('NotReadableError')) }
    expect(await readImportFiles([bad])).toEqual({ ok: false, error: 'readFailed' })
  })
})

describe('12.3 H4 解析進度更新、可取消且取消後不寫入（8.2）', () => {
  it('12.3 H4 解析分批進行：每批最多 200 手後讓出主執行緒並回報進度', async () => {
    const progress: ParseProgress[] = []
    const yieldFn = vi.fn(() => Promise.resolve())
    const items = await parseImportTexts([{ name: 'a', text: ggExampleFile(450) }], { onProgress: (p) => progress.push(p), yieldFn })
    expect(items).toHaveLength(450)
    expect(progress).toEqual([
      { done: 0, total: 450 },
      { done: 200, total: 450 },
      { done: 400, total: 450 },
      { done: 450, total: 450 },
    ])
    expect(yieldFn).toHaveBeenCalledTimes(4)
  })

  it('12.3 H4 取消：中止後不再解析、回傳 null，資料庫沒有任何手牌', async () => {
    const { repos } = setup()
    const controller = new AbortController()
    const progress: ParseProgress[] = []
    const items = await parseImportTexts([{ name: 'a', text: ggExampleFile(450) }], {
      signal: controller.signal,
      yieldFn: noYield,
      onProgress: (p) => {
        progress.push(p)
        if (p.done === 200) controller.abort()
      },
    })
    expect(items).toBeNull()
    expect(progress.at(-1)).toEqual({ done: 200, total: 450 })
    expect(await repos.hands.list()).toEqual([])
  })

  it('12.3 H4 寫入失敗整批還原：transaction 內第 3 手寫入時模擬錯誤 → 沒有任何手牌被寫入、lastHandSeq 不變', async () => {
    const { db, repos } = setup()
    const preview = await previewOf(repos, [fileOf('a.txt', ggExampleFile(5))])
    let n = 0
    const failOnThird = () => {
      if (++n === 3) throw new Error('模擬寫入錯誤')
    }
    db.hands.hook('creating', failOnThird)
    await expect(repos.hands.createMany(preview.importable.map((h) => toGgHandInput(h, null)), { skipExistingSourceHandIds: true })).rejects.toThrow()
    db.hands.hook('creating').unsubscribe(failOnThird)
    expect(n).toBe(3)
    expect(await db.hands.count()).toBe(0)
    expect(await repos.settings.get('lastHandSeq')).toBeUndefined()
    // 錯誤排除後重新匯入成功
    expect(await repos.hands.createMany(preview.importable.map((h) => toGgHandInput(h, null)))).toHaveLength(5)
  })
})

describe('HC21 重複匯入（8.6）', () => {
  it('HC21 同一檔案匯入兩次：第二次「可匯入 0 手 · 重複略過 N 手」', async () => {
    const { repos } = setup()
    const file = () => fileOf('gg.txt', ggExampleFile(4))
    expect((await importAll(repos, [file()])).hands).toHaveLength(4)
    const second = await previewOf(repos, [file()])
    expect([second.importable.length, second.duplicates, second.rejected]).toEqual([0, 4, 0])
    expect(await repos.hands.list()).toHaveLength(4)
  })

  it('HC21 同一次選兩個相同檔案：第二份全數計為重複', async () => {
    const { repos } = setup()
    const { preview, hands } = await importAll(repos, [fileOf('a.txt', ggExampleFile(3)), fileOf('copy.txt', ggExampleFile(3))])
    expect([preview.importable.length, preview.duplicates]).toEqual([3, 3])
    expect(hands).toHaveLength(3)
  })

  it('HC21 既有手牌的標籤、備註、關聯場次不被覆寫', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const [first] = (await importAll(repos, [fileOf('gg.txt', ggExampleFile(1))])).hands
    const edited = await repos.hands.update(first!.id, { tags: ['3bet'], note: '抽查', sessionId: session.id })
    const again = await importAll(repos, [fileOf('gg.txt', ggExampleFile(1))])
    expect(again.preview.duplicates).toBe(1)
    expect(again.hands).toEqual([])
    expect(await repos.hands.get(first!.id)).toEqual(edited)
  })

  it('8.6 預覽之後才被寫入的同一手：寫入時在同一個 transaction 內再次去重，不重複寫入', async () => {
    const { repos } = setup()
    const preview = await previewOf(repos, [fileOf('gg.txt', ggExampleFile(2))])
    await importAll(repos, [fileOf('gg.txt', ggExampleFile(1))])
    const written = await repos.hands.createMany(preview.importable.map((h) => toGgHandInput(h, null)), { skipExistingSourceHandIds: true })
    expect(written.map((h) => h.sourceHandId)).toEqual(['RC1000000002'])
    expect(await repos.hands.list()).toHaveLength(2)
  })
})

async function cashSession(repos: Repositories) {
  const stake = await repos.stakes.create(1, 2)
  return repos.sessions.create({ type: 'cash', startAt: '2026-09-20T20:00', durationMin: 60, buyIns: [{ amount: 1000, fee: 0 }], cashOut: 1500, stakeId: stake.id })
}

describe('12.3 H4 匯入時選擇關聯場次（8.2、HQ20）', () => {
  it('12.3 H4 選一個現金桌場次：所有匯入的手牌 sessionId 都是該場；不指定時全部為獨立手牌', async () => {
    const { repos } = setup()
    const session = await cashSession(repos)
    const { hands } = await importAll(repos, [fileOf('a.txt', ggExampleFile(3, 1))], session.id)
    expect(hands.map((h) => h.sessionId)).toEqual([session.id, session.id, session.id])
    expect((await repos.hands.listBySession(session.id)).length).toBe(3)
    const standalone = await importAll(repos, [fileOf('b.txt', ggExampleFile(2, 101))])
    expect(standalone.hands.map((h) => h.sessionId)).toEqual([null, null])
  })

  it('3.11 GG 手牌（現金桌）不能關聯錦標賽場次：整批不寫入', async () => {
    const { repos } = setup()
    const mtt = await repos.sessions.create({ type: 'mtt', startAt: '2026-09-14T13:00', durationMin: 60, buyIns: [{ amount: 1000, fee: 0 }], cashOut: 0 })
    await expect(importAll(repos, [fileOf('a.txt', ggExampleFile(2))], mtt.id)).rejects.toBeInstanceOf(SessionTypeMismatchError)
    expect(await repos.hands.list()).toEqual([])
  })
})
