// v1 3.7「升級前的備份提示」（v1.6，10.3 P7）：DbGate 在 Dexie 開啟（升級）之前，
// 舊版且有資料時顯示提示；【先匯出備份】在 click 的同步路徑中呼叫分享（之前不讀資料庫）、取消分享不視為已備份；
// 【繼續更新】/【直接更新】後才升級；升級成功後 lastBackupAt 設為升級前備份的 exportedAt。
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Dexie } from 'dexie'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DbGate } from '../../src/components/DbGate'
import { createDb, createSettingsRepo } from '../../src/db'
import { parseBackupText } from '../../src/domain'

type ShareFn = (data: { files?: File[] }) => Promise<void>

function stubShare(share: ShareFn) {
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
}

type Fixture = { sessions: Record<string, unknown>[]; venues: Record<string, unknown>[]; stakes: Record<string, unknown>[]; settings: Record<string, unknown> }
const V2 = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'backup-v2.json'), 'utf8')) as Fixture

let seq = 0
const names: string[] = []

afterEach(async () => {
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  vi.restoreAllMocks()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

/** 以原生 API 建立 Dexie version 2（原生 20）的資料庫並寫入 v2 fixture */
async function createV2(withData = true): Promise<string> {
  const name = `prompt-${Date.now()}-${++seq}`
  names.push(name)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 20)
    req.onupgradeneeded = () => {
      const d = req.result
      const s = d.createObjectStore('sessions', { keyPath: 'id' })
      for (const k of ['type', 'startAt', 'venueId', 'stakeId']) s.createIndex(k, k)
      const v = d.createObjectStore('venues', { keyPath: 'id' })
      v.createIndex('name', 'name')
      v.createIndex('archived', 'archived')
      d.createObjectStore('stakes', { keyPath: 'id' }).createIndex('archived', 'archived')
      d.createObjectStore('settings', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['sessions', 'venues', 'stakes', 'settings'], 'readwrite')
    if (withData) {
      for (const x of V2.sessions) tx.objectStore('sessions').put(x)
      for (const x of V2.venues) tx.objectStore('venues').put(x)
      for (const x of V2.stakes) tx.objectStore('stakes').put(x)
    }
    tx.objectStore('settings').put({ key: 'lastType', value: 'cash' })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return name
}

async function nativeVersion(name: string): Promise<number> {
  return (await indexedDB.databases()).find((d) => d.name === name)?.version ?? 0
}

function renderGate(name: string) {
  const db = createDb(name)
  const onReady = vi.fn()
  render(
    <DbGate db={db} onReady={onReady}>
      <p>app content</p>
    </DbGate>,
  )
  return { db, onReady }
}

const exportButton = () => screen.getByRole('button', { name: '先匯出備份' })

describe('3.7 升級前的備份提示（DbGate）', () => {
  it('3.7 第 5 步：舊版（version 2）且有資料 → 升級前顯示提示，不渲染 App；提示期間原生版本仍為 20', async () => {
    const name = await createV2()
    const { db, onReady } = renderGate(name)
    expect(await screen.findByRole('heading', { level: 1, name: '這次更新會升級資料庫' })).toBeTruthy()
    expect(screen.getByText('更新時會把資料轉換成新版格式，原有紀錄都會保留。為了以防萬一，建議先匯出一份備份檔再繼續。')).toBeTruthy()
    expect(screen.getByTestId('db-upgrade-data-count').textContent).toBe('3 場 · 1 個場地 · 1 個盲注')
    expect(screen.getByRole('button', { name: '直接更新' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '繼續更新' })).toBeNull()
    expect(screen.queryByText('app content')).toBeNull()
    expect(onReady).not.toHaveBeenCalled()
    expect(db.isOpen()).toBe(false)
    expect(await nativeVersion(name)).toBe(20)
  })

  it('3.7 第 5 步：【先匯出備份】在 click 的同步路徑中呼叫 share，之前沒有開啟資料庫；備份 schemaVersion 2 可匯入', async () => {
    const name = await createV2()
    const share = vi.fn<ShareFn>(async () => undefined)
    stubShare(share)
    const { db } = renderGate(name)
    await screen.findByTestId('db-upgrade-prompt')
    const opens = vi.spyOn(indexedDB, 'open')
    fireEvent.click(exportButton())
    // 同步檢查：沒有 await 任何東西
    expect(share).toHaveBeenCalledTimes(1)
    expect(opens).not.toHaveBeenCalled()
    const file = share.mock.calls[0]![0].files![0]!
    expect(file.name).toMatch(/^poker-backup-\d{8}-\d{4}\.json$/)
    const backup = JSON.parse(await file.text()) as Record<string, unknown>
    expect(backup.schemaVersion).toBe(2)
    expect('hands' in backup).toBe(false)
    expect(parseBackupText(await file.text()).ok).toBe(true)

    // 分享完成：按鈕旁顯示「已備份」並出現【繼續更新】，【直接更新】不再顯示
    expect(await screen.findByTestId('db-upgrade-backed-up')).toBeTruthy()
    expect(screen.getByTestId('db-upgrade-backed-up').textContent).toBe('已備份')
    expect(screen.getByRole('button', { name: '再匯出一次' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '直接更新' })).toBeNull()
    expect(db.isOpen()).toBe(false)
    expect(await nativeVersion(name)).toBe(20)

    // 【繼續更新】：升級成功後渲染 App，lastBackupAt = 備份的 exportedAt
    fireEvent.click(screen.getByRole('button', { name: '繼續更新' }))
    expect(await screen.findByText('app content')).toBeTruthy()
    expect(db.verno).toBe(3)
    expect(await createSettingsRepo(db).get('lastBackupAt')).toBe(backup.exportedAt)
    expect(await db.sessions.count()).toBe(V2.sessions.length)
    db.close()
  })

  it('3.7 第 5 步：分享選單按取消（AbortError）不視為已備份、不顯示錯誤，【直接更新】仍在', async () => {
    const name = await createV2()
    const share = vi.fn<ShareFn>(async () => {
      throw new DOMException('Share canceled', 'AbortError')
    })
    stubShare(share)
    renderGate(name)
    await screen.findByTestId('db-upgrade-prompt')
    fireEvent.click(exportButton())
    expect(share).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(exportButton().hasAttribute('disabled')).toBe(false))
    expect(screen.queryByTestId('db-upgrade-backed-up')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '繼續更新' })).toBeNull()
    expect(screen.getByRole('button', { name: '直接更新' })).toBeTruthy()
  })

  it('3.7 第 5 步：失去使用者手勢（NotAllowedError）時提示再按一次；其他錯誤提示匯出失敗', async () => {
    const name = await createV2()
    let error = new DOMException('no gesture', 'NotAllowedError')
    stubShare(async () => {
      throw error
    })
    renderGate(name)
    await screen.findByTestId('db-upgrade-prompt')
    fireEvent.click(exportButton())
    expect((await screen.findByRole('alert')).textContent).toBe('檔案已準備好，請再按一次匯出')
    error = new DOMException('boom', 'DataError')
    fireEvent.click(exportButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('匯出失敗，請再試一次'))
    expect(screen.queryByTestId('db-upgrade-backed-up')).toBeNull()
  })

  it('3.7 第 5 步：【直接更新】不備份直接升級，不寫入 lastBackupAt', async () => {
    const name = await createV2()
    const { db, onReady } = renderGate(name)
    await screen.findByTestId('db-upgrade-prompt')
    fireEvent.click(screen.getByRole('button', { name: '直接更新' }))
    expect(await screen.findByText('app content')).toBeTruthy()
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(db.verno).toBe(3)
    expect(await createSettingsRepo(db).get('lastBackupAt')).toBeUndefined()
    db.close()
  })

  it('3.7 第 4 步：舊版但沒有場次、場地、盲注（只有 settings）→ 不提示，直接升級', async () => {
    const name = await createV2(false)
    const { db } = renderGate(name)
    expect(await screen.findByText('app content')).toBeTruthy()
    expect(screen.queryByTestId('db-upgrade-prompt')).toBeNull()
    expect(db.verno).toBe(3)
    db.close()
  })

  it('3.7 第 2 步：全新安裝（沒有資料庫）→ 不提示，載入中 → App', async () => {
    const name = `prompt-fresh-${Date.now()}-${++seq}`
    names.push(name)
    const { db, onReady } = renderGate(name)
    expect(screen.getByRole('status').textContent).toBe('載入中…')
    expect(await screen.findByText('app content')).toBeTruthy()
    expect(screen.queryByTestId('db-upgrade-prompt')).toBeNull()
    expect(onReady).toHaveBeenCalledTimes(1)
    db.close()
  })

  it('3.7 第 2 步：已是最新版本 → 不提示', async () => {
    const name = `prompt-current-${Date.now()}-${++seq}`
    names.push(name)
    const first = createDb(name)
    await first.open()
    await first.venues.put(V2.venues[0] as never)
    first.close()
    const { db } = renderGate(name)
    expect(await screen.findByText('app content')).toBeTruthy()
    expect(screen.queryByTestId('db-upgrade-prompt')).toBeNull()
    db.close()
  })

  it('3.7 第 6 步：按【繼續更新】後升級失敗 → 顯示 3.7 的錯誤訊息，不渲染 App、不寫入 lastBackupAt；資料維持 version 2', async () => {
    const name = await createV2()
    stubShare(async () => undefined)
    const db = createDb(name, {
      upgradeV3: () => {
        throw new Error('simulated upgrade failure')
      },
    })
    render(
      <DbGate db={db}>
        <p>app content</p>
      </DbGate>,
    )
    await screen.findByTestId('db-upgrade-prompt')
    fireEvent.click(exportButton())
    fireEvent.click(await screen.findByRole('button', { name: '繼續更新' }))
    const alert = await screen.findByTestId('db-upgrade-failed')
    expect(alert.textContent).toBe('資料升級失敗，請關閉 App 後重新開啟；你的資料沒有遺失')
    expect(screen.queryByText('app content')).toBeNull()
    db.close()
    expect(await nativeVersion(name)).toBe(20)
    // 以原生 API（不指定版本）確認 settings 未被寫入 lastBackupAt
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const settings = await new Promise<unknown[]>((resolve, reject) => {
      const req = raw.transaction('settings').objectStore('settings').getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    raw.close()
    expect(settings).toEqual([{ key: 'lastType', value: 'cash' }])
  })
})
