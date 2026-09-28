// 產生佔位圖示（11.3 Q10：純色底加文字）；顏色取自深色主題 token
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readTokens } from './read-tokens.mjs'

const { dark } = readTokens()
const bg = dark['--color-bg']
const fg = dark['--color-accent']
const glyph = '德'
const outDir = fileURLToPath(new URL('../public/icons/', import.meta.url))
mkdirSync(outDir, { recursive: true })

// scale：文字佔畫布比例；maskable 需落在中央 80% 安全區內，所以縮小
function svg(size, scale) {
  const fontSize = Math.round(size * scale)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <text x="50%" y="50%" dy="0.36em" text-anchor="middle" font-size="${fontSize}" font-weight="700"
    font-family="Microsoft JhengHei, PingFang TC, Noto Sans CJK TC, sans-serif" fill="${fg}">${glyph}</text>
</svg>`
}

const targets = [
  { file: 'icon-192.png', size: 192, scale: 0.62 },
  { file: 'icon-512.png', size: 512, scale: 0.62 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.46 },
  { file: 'apple-touch-icon-180.png', size: 180, scale: 0.62 },
]

for (const t of targets) {
  await sharp(Buffer.from(svg(t.size, t.scale))).flatten({ background: bg }).png().toFile(outDir + t.file)
  console.log('generated', t.file)
}
