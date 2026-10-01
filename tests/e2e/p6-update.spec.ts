import { spawn } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { readSettings } from './helpers/idb'
import { startStaticServer, type StaticServer } from './helpers/staticServer'

// 10.3 P6「發布新版後出現更新提示，填到一半的表單更新後草稿仍在」的自動化驗收（使用者決定以自動化取代實機）：
// 建置兩個只有版本號不同的版本（JS 與 service worker precache 因此不同），以可切換資料夾的靜態伺服器
// 先提供 v1、再改提供 v2，模擬「發布新版」。

const V1 = { version: '1.0.0-p6.1', outDir: 'dist-p6-v1' }
const V2 = { version: '1.0.0-p6.2', outDir: 'dist-p6-v2' }

/** 以 vite.config.ts 支援的測試用環境變數建置到指定資料夾 */
function build({ version, outDir }: { version: string; outDir: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', 'build', '--logLevel', 'warn'], {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, P6_APP_VERSION: version, P6_OUT_DIR: outDir },
    })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`建置 ${outDir} 失敗（exit ${code}）`))))
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  await Promise.all([build(V1), build(V2)])
})

const buyIn = (page: Page) => page.getByLabel('買入（含服務費）', { exact: true })
const nameInput = (page: Page) => page.getByLabel('名稱', { exact: true })
const cashOut = (page: Page) => page.getByLabel('到手金額')

async function appVersionShown(page: Page): Promise<string> {
  await page.getByRole('navigation', { name: '主要分頁' }).getByRole('link', { name: '設定' }).click()
  const row = page.getByTestId('info-version')
  await expect(row).toBeVisible()
  return (await row.locator('dd').textContent()) ?? ''
}

test('P6-3 發布新版後出現更新提示（不自動重整），按重新載入後受新 SW 控制、版本為 v2、草稿完整還原', async ({
  page,
}) => {
  test.setTimeout(120_000)
  let server: StaticServer | null = await startStaticServer(V1.outDir)
  try {
    // 1. 載入 v1，等 service worker 安裝並控制頁面
    await page.goto(server.url)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    expect(await appVersionShown(page)).toBe(V1.version)

    // 2. 在新增頁填到一半（買入、到手、名稱），等草稿寫入（輸入停止 500ms 後寫入，5.6）
    await page.getByRole('navigation', { name: '主要分頁' }).getByRole('link', { name: '新增' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增場次')
    await buyIn(page).fill('3400')
    await cashOut(page).fill('5800')
    await nameInput(page).fill('P6 更新測試')
    await expect
      .poll(async () => JSON.stringify((await readSettings(page)).recordDraft ?? null))
      .toMatch(/3400[\s\S]*5800|5800[\s\S]*3400/)
    expect(JSON.stringify((await readSettings(page)).recordDraft)).toContain('P6 更新測試')

    // 3. 發布新版：伺服器改提供 v2，觸發 service worker 更新檢查
    server.setRoot(V2.outDir)
    // 標記目前這次載入；若 App 自動重整，標記會消失
    await page.evaluate(() => {
      ;(window as unknown as { __p6Marker?: number }).__p6Marker = 1
    })
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
    })
    const prompt = page.getByText('有新版本')
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    const reloadButton = page.getByRole('button', { name: '重新載入' })
    await expect(reloadButton).toBeVisible()
    // 新 SW 停在 waiting，不自動接手、不自動重整
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => (window as unknown as { __p6Marker?: number }).__p6Marker)).toBe(1)
    expect(
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        return { waiting: !!reg?.waiting, controlled: !!navigator.serviceWorker.controller }
      }),
    ).toEqual({ waiting: true, controlled: true })
    // 畫面上的表單內容沒被動到
    await expect(buyIn(page)).toHaveValue('3,400')

    // 4. 按「重新載入」：新 SW 接手後重整頁面
    await reloadButton.click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __p6Marker?: number }).__p6Marker ?? null), {
        timeout: 30_000,
      })
      .toBeNull()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('新增場次')
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    expect(
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        return { waiting: !!reg?.waiting, activeIsController: reg?.active?.scriptURL === navigator.serviceWorker.controller?.scriptURL }
      }),
    ).toEqual({ waiting: false, activeIsController: true })
    await expect(page.getByText('有新版本')).toHaveCount(0)

    // 5. 草稿完整還原
    await expect(buyIn(page)).toHaveValue('3,400')
    await expect(cashOut(page)).toHaveValue('5,800')
    await expect(nameInput(page)).toHaveValue('P6 更新測試')

    // 6. 設定頁顯示 v2 版本號
    expect(await appVersionShown(page)).toBe(V2.version)

    // 7. 確認頁面由新 SW 的 precache 提供：關掉伺服器後重新載入，仍是 v2、草稿仍在
    await server.close()
    server = null
    await page.reload()
    expect(await appVersionShown(page)).toBe(V2.version)
    await page.getByRole('navigation', { name: '主要分頁' }).getByRole('link', { name: '新增' }).click()
    await expect(buyIn(page)).toHaveValue('3,400')
    await expect(nameInput(page)).toHaveValue('P6 更新測試')
  } finally {
    await server?.close()
  }
})
