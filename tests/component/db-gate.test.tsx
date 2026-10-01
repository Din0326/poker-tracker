// 3.7 遷移失敗時的錯誤狀態（10.3 P5.5 第 3 項：畫面顯示 3.7 的錯誤訊息，不進入可寫入的畫面）
import { render, screen } from '@testing-library/react'
import { Dexie } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DbGate } from '../../src/components/DbGate'
import { SCHEMA_V1, createDb } from '../../src/db'

let seq = 0
const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

async function createV1(): Promise<string> {
  const name = `gate-${Date.now()}-${++seq}`
  names.push(name)
  const old = new Dexie(name)
  old.version(1).stores(SCHEMA_V1)
  await old.open()
  await old.table('settings').add({ key: 'lastType', value: 'cash' })
  old.close()
  return name
}

describe('3.7 DbGate', () => {
  it('P5.5 遷移失敗（upgrade 拋錯）：顯示「資料升級失敗，請關閉 App 後重新開啟；你的資料沒有遺失」，不渲染 App', async () => {
    const name = await createV1()
    const db = createDb(name, {
      upgradeV2: () => {
        throw new Error('simulated upgrade failure')
      },
    })
    render(
      <DbGate db={db}>
        <p>app content</p>
      </DbGate>,
    )
    const alert = await screen.findByTestId('db-upgrade-failed')
    expect(alert.textContent).toBe('資料升級失敗，請關閉 App 後重新開啟；你的資料沒有遺失')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(screen.queryByText('app content')).toBeNull()
    db.close()

    // 資料維持 version 1
    const old = new Dexie(name)
    old.version(1).stores(SCHEMA_V1)
    await old.open()
    expect(old.verno).toBe(1)
    expect(await old.table('settings').toArray()).toEqual([{ key: 'lastType', value: 'cash' }])
    old.close()
  })

  it('開啟（含遷移）成功後才渲染 App', async () => {
    const name = await createV1()
    const db = createDb(name)
    render(
      <DbGate db={db}>
        <p>app content</p>
      </DbGate>,
    )
    expect(screen.getByRole('status').textContent).toBe('載入中…')
    expect(await screen.findByText('app content')).toBeTruthy()
    expect(db.verno).toBe(2)
    db.close()
  })
})
