// SPEC-v2-hands 8.2 步驟 4：寫入匯入的手牌（單一 transaction，任何錯誤整批還原），回傳實際寫入的手數。
// App 的資料庫以 Web Worker 寫入（ggImport.worker.ts）：驗證與 IndexedDB 寫入都不佔用主執行緒；
// 元件測試注入的資料庫（或不支援 Worker 的環境）直接在主執行緒以 handRepo.createMany 寫入，行為相同。
import type { HandInput, PokerDb, Repositories } from '../../db'
import { defaultAppData } from '../../lib/appData'
import type { GgImportWorkerRequest, GgImportWorkerResponse } from './ggImport.worker'

export type HandsWriter = (inputs: HandInput[]) => Promise<number>

function writeInWorker(dbName: string, inputs: HandInput[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ggImport.worker.ts', import.meta.url), { type: 'module' })
    const done = () => worker.terminate()
    worker.onmessage = (e: MessageEvent<GgImportWorkerResponse>) => {
      done()
      if (e.data.ok) resolve(e.data.written)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      done()
      reject(new Error(e.message))
    }
    const request: GgImportWorkerRequest = { dbName, inputs }
    worker.postMessage(request)
  })
}

export function handsWriterFor(db: PokerDb, repos: Repositories): HandsWriter {
  if (db === defaultAppData.db && typeof Worker !== 'undefined') return (inputs) => writeInWorker(db.name, inputs)
  return async (inputs) => (await repos.hands.createMany(inputs, { skipExistingSourceHandIds: true })).length
}
