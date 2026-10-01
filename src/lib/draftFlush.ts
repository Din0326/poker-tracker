// 8.10：版本更新前，立即寫入新增頁尚未寫入的草稿（5.6 的 500ms 防抖期間內的輸入）。
// 新增表單掛載時註冊 flusher；UpdatePrompt 在呼叫 updateServiceWorker 之前 await flushPendingDrafts()。

type Flusher = () => Promise<void>

const flushers = new Set<Flusher>()

/** 註冊草稿 flusher，回傳取消註冊的函式 */
export function registerDraftFlusher(flusher: Flusher): () => void {
  flushers.add(flusher)
  return () => {
    flushers.delete(flusher)
  }
}

/** 立即寫入所有尚未寫入的草稿；個別失敗不影響其他（草稿寫入失敗不應阻止更新） */
export async function flushPendingDrafts(): Promise<void> {
  await Promise.allSettled([...flushers].map((f) => f()))
}
