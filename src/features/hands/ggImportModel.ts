// SPEC-v2-hands 8.1、8.2：GG 匯入頁的非畫面邏輯——讀取檔案（含 zip 解壓與 50 MB / 1,000 個項目限制）、
// 分批解析（每批最多 200 手後讓出主執行緒，可取消）、解析結果轉成寫入用的 HandInput。
// 解析本身（白名單、重播驗證、去重與摘要）在 domain/hands（parse/gg.ts、ggImport.ts）。
import type { HandInput } from '../../db'
import { GG_PARSER_VERSION, parseGgHand, splitGgHands, type GgImportItem, type ParsedGgHand } from '../../domain/hands'
import { ZipInvalidError, ZipTooLargeError, ZipTooManyEntriesError, extractTxtEntries } from '../../lib/unzip'

/** 8.1：單次匯入所有檔案（zip 以解壓後計）合計上限 50 MB（以 MiB 計：50 × 1024 × 1024 位元組） */
export const GG_IMPORT_MAX_BYTES = 50 * 1024 * 1024
/** 8.2：每批最多 200 手後讓出主執行緒 */
export const GG_PARSE_BATCH_SIZE = 200

/** 檔案選擇器的 accept（8.1） */
export const GG_FILE_ACCEPT = '.txt,.zip,text/plain,application/zip'

/** 只用到 File 的這些成員（測試可傳入替身，例如模擬 50 MB 的檔案大小而不實際產生內容） */
export interface ImportFileLike {
  name: string
  size: number
  type: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export type ReadFilesError = 'tooLarge' | 'tooManyEntries' | 'unzipFailed' | 'readFailed'

export interface ImportText {
  /** 檔名（zip 內為項目路徑），只用於除錯 */
  name: string
  text: string
}

export type ReadFilesResult = { ok: true; texts: ImportText[] } | { ok: false; error: ReadFilesError }

const isZip = (f: ImportFileLike) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed'

/** 8.1 文字解碼：UTF-8（非 fatal），去除開頭 BOM（TextDecoder 預設會去除；normalizeText 也會再處理） */
function decode(data: Uint8Array | ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(data)
}

/**
 * 讀取選擇的檔案（8.1）：`.zip` 以 fflate 解壓，只取其中的 `.txt`；其他檔案一律當文字讀取
 * （不是 GG 手牌的內容在拆手時忽略）。合計大小在讀取內容之前先以檔案大小檢查，zip 以解壓後的大小計。
 */
export async function readImportFiles(files: readonly ImportFileLike[], maxBytes: number = GG_IMPORT_MAX_BYTES): Promise<ReadFilesResult> {
  const textBytes = files.filter((f) => !isZip(f)).reduce((s, f) => s + f.size, 0)
  if (textBytes > maxBytes) return { ok: false, error: 'tooLarge' }
  let used = textBytes
  const texts: ImportText[] = []
  for (const f of files) {
    let buffer: ArrayBuffer
    try {
      buffer = await f.arrayBuffer()
    } catch {
      return { ok: false, error: 'readFailed' }
    }
    if (!isZip(f)) {
      texts.push({ name: f.name, text: decode(buffer) })
      continue
    }
    try {
      const entries = await extractTxtEntries(new Uint8Array(buffer), { maxBytes: maxBytes - used })
      for (const e of entries) {
        used += e.data.length
        texts.push({ name: `${f.name}/${e.name}`, text: decode(e.data) })
      }
    } catch (e) {
      if (e instanceof ZipTooLargeError) return { ok: false, error: 'tooLarge' }
      if (e instanceof ZipTooManyEntriesError) return { ok: false, error: 'tooManyEntries' }
      if (e instanceof ZipInvalidError) return { ok: false, error: 'unzipFailed' }
      return { ok: false, error: 'readFailed' }
    }
  }
  return { ok: true, texts }
}

/** 讓出主執行緒（8.2：`scheduler.yield` 或 `setTimeout` 0） */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof s?.yield === 'function') return s.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export interface ParseProgress {
  done: number
  total: number
}

export interface ParseOptions {
  /** 取消後不再解析，回傳 null */
  signal?: AbortSignal
  onProgress?: (p: ParseProgress) => void
  batchSize?: number
  yieldFn?: () => Promise<void>
}

/**
 * 8.2 步驟 2：拆手後分批解析，每批 batchSize 手之後讓出主執行緒並回報進度（解析中 1,200 / 3,500 手）；
 * 取消時回傳 null（不寫入任何資料）。
 */
export async function parseImportTexts(texts: readonly ImportText[], options: ParseOptions = {}): Promise<GgImportItem[] | null> {
  const batchSize = options.batchSize ?? GG_PARSE_BATCH_SIZE
  const yieldFn = options.yieldFn ?? yieldToMain
  const chunks = texts.flatMap((t, i) => splitGgHands(t.text).map((c) => ({ fileIndex: i + 1, handIndex: c.index, rawText: c.rawText })))
  const total = chunks.length
  options.onProgress?.({ done: 0, total })
  const items: GgImportItem[] = []
  for (let start = 0; start < total; start += batchSize) {
    await yieldFn()
    if (options.signal?.aborted) return null
    for (const c of chunks.slice(start, start + batchSize)) {
      items.push({ fileIndex: c.fileIndex, handIndex: c.handIndex, result: parseGgHand(c.rawText) })
    }
    options.onProgress?.({ done: items.length, total })
  }
  await yieldFn()
  if (options.signal?.aborted) return null
  return items
}

/** 8.3：解析成功的手牌 → 寫入用的 HandInput（source gg、parserVersion 1、tags []、note null、sessionId 依 8.2 選擇） */
export function toGgHandInput(hand: ParsedGgHand, sessionId: string | null): HandInput {
  return {
    source: 'gg',
    gameType: hand.gameType,
    playedAt: hand.playedAt,
    detail: hand.detail,
    board: hand.board,
    sessionId,
    tags: [],
    note: null,
    sourceHandId: hand.sourceHandId,
    rawText: hand.rawText,
    parserVersion: GG_PARSER_VERSION,
  }
}
