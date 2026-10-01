// 產生 App 圖示（11.3 Q10：撲克牌圖案，v1.3 使用者確認）；顏色全部取自深色主題 token
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readTokens } from './read-tokens.mjs'

const { dark } = readTokens()
function token(name) {
  const value = dark[name]
  if (!value) throw new Error(`tokens.css 缺少深色 ${name}`)
  return value
}
const bg = token('--color-bg')
const backFill = token('--color-surface-raised')
const accent = token('--color-accent')

const outDir = fileURLToPath(new URL('../public/icons/', import.meta.url))
mkdirSync(outDir, { recursive: true })

// 黑桃路徑（以 (0,0) 為中心）
const spade =
  'M0,-58 C14,-36 56,-14 56,14 C56,38 34,50 14,38 C17,52 23,60 32,66 L-32,66 C-23,60 -17,52 -14,38 C-34,50 -56,38 -56,14 C-56,-14 -14,-36 0,-58 Z'

/** 一張牌：以 (cx, cy) 為中心旋轉 deg 度，牌 220×300、圓角 26 */
function card(cx, cy, deg, rectAttrs, inner = '') {
  return `<g transform="translate(${cx} ${cy}) rotate(${deg})">
    <rect x="-110" y="-150" width="220" height="300" rx="26" ${rectAttrs}/>${inner}
  </g>`
}

// 兩張牌（以 512×512 畫布設計）：後牌描邊、前牌金色加黑桃，中心同高 y=256、左右對稱傾斜
const cards = [
  card(216, 256, -10, `fill="${backFill}" stroke="${accent}" stroke-width="10"`),
  card(296, 256, 10, `fill="${accent}"`, `<path d="${spade}" transform="scale(1.15)" fill="${bg}"/>`),
].join('\n')

/**
 * scale：整組牌相對 512 設計稿的縮放（以畫布中心為原點）。
 * maskable 圖示必須讓內容落在中央 80% 安全區（直徑 0.8 的圓）內，見 MASKABLE_SCALE。
 */
function svg(size, scale) {
  const k = (size / 512) * scale
  const offset = (size - 512 * k) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${offset} ${offset}) scale(${k})">
${cards}
  </g>
</svg>`
}

// 整組牌（含描邊、不計圓角）離畫布中心 (256,256) 最遠的角 r ≈ 223.7（後牌的角），
// 安全區半徑 = 512 × 0.4 = 204.8 → 縮放 0.86 後最遠點約 192.4，完整落在安全區內並留些許餘裕
const MASKABLE_SCALE = 0.86

const targets = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: MASKABLE_SCALE },
  { file: 'apple-touch-icon-180.png', size: 180, scale: 1 },
]

for (const t of targets) {
  // flatten：確保不透明（iOS 主畫面圖示的透明處會變黑）
  await sharp(Buffer.from(svg(t.size, t.scale))).flatten({ background: bg }).png().toFile(outDir + t.file)
  console.log('generated', t.file)
}

// 預覽圖（給 MR 用）：npm run icons -- --preview <輸出路徑>
// 左：512 原圖；中：iOS 主畫面圓角遮罩外觀（180 圖示放大）；右：maskable 套用 80% 安全區圓形遮罩
const previewIndex = process.argv.indexOf('--preview')
if (previewIndex > 0) {
  const previewPath = process.argv[previewIndex + 1]
  if (!previewPath) throw new Error('--preview 需要輸出路徑')
  const tile = 512
  const gap = 32
  // 遮罩只取不透明度（dest-in），填色無意義；iOS 圖示圓角約為邊長的 22.37%
  const roundMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}"><rect width="${tile}" height="${tile}" rx="${tile * 0.2237}" fill="${bg}"/></svg>`,
  )
  const circleMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}"><circle cx="${tile / 2}" cy="${tile / 2}" r="${tile * 0.4}" fill="${bg}"/></svg>`,
  )
  const masked = (file, mask) =>
    sharp(outDir + file)
      .resize(tile, tile)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer()
  const tiles = [
    await sharp(outDir + 'icon-512.png').png().toBuffer(),
    await masked('apple-touch-icon-180.png', roundMask),
    await masked('icon-maskable-512.png', circleMask),
  ]
  await sharp({
    create: { width: tile * 3 + gap * 4, height: tile + gap * 2, channels: 4, background: backFill },
  })
    .composite(tiles.map((input, i) => ({ input, left: gap + i * (tile + gap), top: gap })))
    .png()
    .toFile(previewPath)
  console.log('generated preview', previewPath)
}
