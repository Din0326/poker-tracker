// 從 src/styles/tokens.css 讀出淺色與深色主題的顏色 token，供 vite 設定、圖示產生與對比度測試共用
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const tokensPath = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url))

function parseVars(block) {
  const vars = {}
  for (const m of block.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    vars[m[1]] = m[2].toLowerCase()
  }
  return vars
}

export function readTokens() {
  const css = readFileSync(tokensPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)')
  if (darkStart < 0) throw new Error('tokens.css 缺少深色主題區塊')
  const light = parseVars(css.slice(0, darkStart))
  const dark = { ...light, ...parseVars(css.slice(darkStart)) }
  return { light, dark }
}
