// SPEC-v2-hands 第 2 節、12.1：domain/hands/ 不得 import React、Dexie、fflate（ESLint 強制）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const handsDir = join(root, 'src', 'domain', 'hands')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('12.1 domain/hands 為純函式', () => {
  it('domain/hands/ 內沒有任何 import 自 React、Dexie、fflate、src/db', () => {
    const files = walk(handsDir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(5)
    const forbidden = /from\s+['"](react|react-dom|dexie|fflate)(\/[^'"]*)?['"]|from\s+['"][./]*\/db(\/[^'"]*)?['"]|import\(\s*['"](react|dexie|fflate)/
    for (const f of files) expect(forbidden.test(readFileSync(f, 'utf8')), f).toBe(false)
  })

  it('ESLint 規則涵蓋 src/domain/hands/**：import React、Dexie、fflate、db 層都報錯', async () => {
    const eslint = new ESLint({ cwd: root })
    for (const mod of ['react', 'dexie', 'fflate', 'fflate/esm', '../../db']) {
      const [result] = await eslint.lintText(`import x from '${mod}'\nexport const y = x\n`, {
        filePath: join(handsDir, 'probe.ts'),
      })
      const messages = result!.messages.filter((m) => m.ruleId === 'no-restricted-imports')
      expect(messages.length, mod).toBeGreaterThan(0)
    }
    // 對照：一般模組不報錯
    const [ok] = await eslint.lintText(`import { z } from 'zod'\nexport const y = z\n`, { filePath: join(handsDir, 'probe.ts') })
    expect(ok!.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([])
  }, 60_000)
})
