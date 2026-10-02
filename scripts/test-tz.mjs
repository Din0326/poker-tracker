// 以多個時區各跑一次 vitest，抓出依賴執行環境時區的測試（CI 為 UTC、開發者電腦多為 Asia/Taipei）
// SPEC-v2-hands 第 9 節：往返測試在裝置時區 Asia/Taipei 與 America/New_York 各執行一次，結果必須相同（H3 加入 Asia/Taipei）
// 以子行程的 env 設定 TZ：Windows 的 Git Bash（MSYS）會丟掉含 `/` 的 TZ 值（如 TZ=America/New_York），
// 直接在指令列前綴設定無效，透過 Node 傳給子行程則在各平台都生效
import { spawnSync } from 'node:child_process'

const zones = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['UTC', 'Asia/Taipei', 'America/New_York']

for (const tz of zones) {
  console.log(`\n=== vitest（TZ=${tz}）===`)
  const result = spawnSync('npx vitest run', { shell: true, stdio: 'inherit', env: { ...process.env, TZ: tz } })
  if (result.status !== 0) {
    console.error(`\nTZ=${tz} 的測試失敗`)
    process.exit(result.status ?? 1)
  }
}
