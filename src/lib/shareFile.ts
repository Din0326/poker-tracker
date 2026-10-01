// 8.4、8.6 匯出檔案：可分享檔案時開啟系統分享選單（iOS 主畫面模式的主要路徑），
// 否則以 Blob + <a download> 下載。

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled'

/** 釋放 Blob URL 前的等待時間：部分瀏覽器在 click 後才非同步開始下載 */
const REVOKE_DELAY_MS = 10_000

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

/**
 * 匯出檔案。回傳：
 * - 'shared'：分享選單完成
 * - 'downloaded'：已觸發下載
 * - 'cancelled'：使用者在分享選單按取消（AbortError），呼叫端不應更新 lastBackupAt、不顯示錯誤
 * 其他錯誤原樣丟出（包含失去使用者手勢時的 NotAllowedError，由呼叫端提示再按一次）。
 *
 * 【iOS 使用者手勢】navigator.share 必須在 transient user activation 內呼叫。
 * 本函式在第一個 await 之前就同步呼叫 share（或觸發下載），呼叫端必須在 click 事件處理的同步路徑中
 * 呼叫本函式，之前不得有任何 await（例如讀 DB）。
 */
export async function exportFile(file: File): Promise<ExportOutcome> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }
  let canShareFiles: boolean
  try {
    canShareFiles = typeof nav.share === 'function' && nav.canShare?.({ files: [file] }) === true
  } catch {
    canShareFiles = false
  }
  if (canShareFiles) {
    try {
      // 同步呼叫（這一行之前沒有任何 await）
      await nav.share!({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  downloadFile(file)
  return 'downloaded'
}
