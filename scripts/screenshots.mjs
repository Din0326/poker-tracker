// 產生 MR 用截圖：npm run screenshots -- p0 → docs/screenshots/p0/
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const phase = process.argv[2] ?? 'p0'
const dir = `docs/screenshots/${phase}`
mkdirSync(dir, { recursive: true })
const result = spawnSync('npx', ['playwright', 'test', 'tests/e2e/screenshots.spec.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SCREENSHOTS_DIR: dir },
})
process.exit(result.status ?? 1)
