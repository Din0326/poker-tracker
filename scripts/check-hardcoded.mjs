// DoD 10.1 機械式檢查：
//   strings：src 內除字串檔外，程式碼（排除註解）不得出現中文
//   colors：src/styles 以外不得出現色碼或 Tailwind 預設色盤 class
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const mode = process.argv[2]
const root = join(import.meta.dirname, '..')
const srcDir = join(root, 'src')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// 移除註解，但保留字串內容；以簡易狀態機處理引號與樣板字串
function stripComments(code) {
  let out = ''
  let i = 0
  let quote = null
  while (i < code.length) {
    const c = code[i]
    const n = code[i + 1]
    if (quote) {
      out += c
      if (c === '\\') {
        out += n ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
    } else if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      const end = code.indexOf('*/', i + 2)
      const block = code.slice(i, end < 0 ? code.length : end + 2)
      out += block.replace(/[^\n]/g, ' ')
      i = end < 0 ? code.length : end + 2
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c
      out += c
      i++
    }
  }
  return out
}

const rules = {
  strings: {
    files: (f) => /\.(tsx?|jsx?)$/.test(f) && !f.endsWith(`${sep}strings.ts`),
    patterns: [/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff01-\uff5e]/],
    message: '寫死的中文字串，請移到 src/strings.ts',
  },
  colors: {
    files: (f) => /\.(tsx?|jsx?|css)$/.test(f) && !f.includes(`${sep}styles${sep}`),
    patterns: [
      /#[0-9a-fA-F]{3,8}\b/,
      /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/,
      /\b(?:text|bg|border|fill|stroke|ring|outline|from|to|via|shadow|accent|caret|decoration)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b/,
    ],
    message: '寫死的顏色，請改用 styles/tokens.css 的 var(--color-*)',
  },
}

const rule = rules[mode]
if (!rule) {
  console.error('用法：node scripts/check-hardcoded.mjs <strings|colors>')
  process.exit(2)
}

const problems = []
for (const file of walk(srcDir).filter(rule.files)) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, idx) => {
    if (rule.patterns.some((re) => re.test(line))) {
      problems.push(`${relative(root, file)}:${idx + 1}  ${line.trim()}`)
    }
  })
}

if (problems.length) {
  console.error(`${rule.message}（${problems.length} 處）\n` + problems.join('\n'))
  process.exit(1)
}
console.log(`check:${mode} 通過`)
