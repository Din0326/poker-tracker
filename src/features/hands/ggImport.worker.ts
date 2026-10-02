// SPEC-v2-hands 8.2 步驟 4、11.1：GG 匯入的寫入在 Web Worker 執行。
// 開啟與頁面相同的資料庫，以 handRepo.createMany 在單一 Dexie transaction 內寫入全部手牌並配發 exportSeq（7.4）；
// 任何錯誤整批還原。寫入前的驗證（3.1–3.9，每手數次重播）也在 Worker 內進行，主執行緒不凍結。
import { createDb, createHandRepo, type HandInput } from '../../db'

export interface GgImportWorkerRequest {
  dbName: string
  inputs: HandInput[]
}

export type GgImportWorkerResponse = { ok: true; written: number } | { ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GgImportWorkerRequest>) => void) | null
  postMessage: (message: GgImportWorkerResponse) => void
}

scope.onmessage = async (e) => {
  // 頁面升級資料庫版本時立即關閉連線（寫入已在進行中時 transaction 會失敗並整批還原）
  const db = createDb(e.data.dbName, { onVersionChange: () => undefined })
  try {
    const hands = await createHandRepo(db).createMany(e.data.inputs, { skipExistingSourceHandIds: true })
    scope.postMessage({ ok: true, written: hands.length })
  } catch (err) {
    scope.postMessage({ ok: false, error: String(err) })
  } finally {
    db.close()
  }
}
