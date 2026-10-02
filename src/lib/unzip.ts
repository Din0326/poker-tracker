// SPEC-v2-hands 8.1、第 2 節：zip 解壓（包 fflate；domain 不得 import fflate）。
// fflate 以 dynamic import() 載入：只有選了 .zip 檔時才下載，不在主 chunk；PWA 預先快取所有建置產物，離線照常可用（11.2）。
// 使用同步解壓（unzipSync）：不需另開 Web Worker，且能在逐一解壓前以 filter 檢查項目數與解壓後大小。

/** 8.1：壓縮檔內的項目數上限 */
export const ZIP_MAX_ENTRIES = 1000

export class ZipTooManyEntriesError extends Error {
  constructor() {
    super('zip has too many entries')
    this.name = 'ZipTooManyEntriesError'
  }
}

export class ZipTooLargeError extends Error {
  constructor() {
    super('zip text entries exceed the size limit')
    this.name = 'ZipTooLargeError'
  }
}

export class ZipInvalidError extends Error {
  constructor(cause?: unknown) {
    super('cannot unzip', { cause })
    this.name = 'ZipInvalidError'
  }
}

export interface ZipTextEntry {
  name: string
  data: Uint8Array
}

/**
 * 8.1：只處理副檔名為 `.txt`（不分大小寫）的項目；忽略資料夾、其他副檔名（含巢狀 zip）、`__MACOSX/` 底下的項目、
 * 檔名以 `.` 開頭的項目。
 */
export function isImportableZipEntry(name: string): boolean {
  if (name.endsWith('/')) return false
  const parts = name.split('/')
  if (parts.includes('__MACOSX')) return false
  const base = parts[parts.length - 1] ?? ''
  if (base.startsWith('.')) return false
  return /\.txt$/i.test(base)
}

/**
 * 解壓 zip 中可匯入的 `.txt` 項目（依壓縮檔內的順序）。
 * - 項目數（含資料夾與略過的項目）> maxEntries → ZipTooManyEntriesError
 * - `.txt` 項目解壓後合計 > maxBytes → ZipTooLargeError（以項目標頭的原始大小在解壓前檢查，解壓後再以實際大小確認）
 * - 其他任何錯誤（不是 zip、損毀、不支援的壓縮方式）→ ZipInvalidError
 */
export async function extractTxtEntries(data: Uint8Array, limits: { maxEntries?: number; maxBytes: number }): Promise<ZipTextEntry[]> {
  const maxEntries = limits.maxEntries ?? ZIP_MAX_ENTRIES
  let fflate: typeof import('fflate')
  try {
    fflate = await import('fflate')
  } catch (e) {
    throw new ZipInvalidError(e)
  }
  let count = 0
  let declared = 0
  const order: string[] = []
  let files: Record<string, Uint8Array>
  try {
    files = fflate.unzipSync(data, {
      filter: (file) => {
        count++
        if (count > maxEntries) throw new ZipTooManyEntriesError()
        if (!isImportableZipEntry(file.name)) return false
        declared += file.originalSize
        if (declared > limits.maxBytes) throw new ZipTooLargeError()
        order.push(file.name)
        return true
      },
    })
  } catch (e) {
    if (e instanceof ZipTooManyEntriesError || e instanceof ZipTooLargeError) throw e
    throw new ZipInvalidError(e)
  }
  const entries = order.flatMap((name) => {
    const d = files[name]
    return d ? [{ name, data: d }] : []
  })
  if (entries.reduce((s, e) => s + e.data.length, 0) > limits.maxBytes) throw new ZipTooLargeError()
  return entries
}
