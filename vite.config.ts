import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readTokens } from './scripts/read-tokens.mjs'
import { strings } from './src/strings.ts'
import pkg from './package.json' with { type: 'json' }

// manifest 的 theme_color / background_color 取自深色主題 token（第 2 節 PWA 設定）
const darkBg = readTokens().dark['--color-bg']
if (!darkBg) throw new Error('tokens.css 缺少深色 --color-bg')

// 把 index.html 內的佔位字換成 token 與 App 名稱，避免重複定義
function htmlPlaceholders(): Plugin {
  return {
    name: 'html-placeholders',
    transformIndexHtml: (html) =>
      html.replaceAll('%THEME_COLOR%', darkBg!).replaceAll('%APP_NAME%', strings.app.name),
  }
}

// 僅供 E2E（P6-3 版本更新）使用：以環境變數覆寫版本號與輸出資料夾，建置兩個內容不同的版本；未設定時行為不變
const appVersion = process.env.P6_APP_VERSION ?? pkg.version
const outDir = process.env.P6_OUT_DIR ?? 'dist'

export default defineConfig({
  // 相對路徑，GitHub Pages 子路徑（/<repo>/）也能運作
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    htmlPlaceholders(),
    VitePWA({
      // 8.10：prompt 模式，偵測到新版由使用者按下才更新
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon-180.png'],
      manifest: {
        name: strings.app.name,
        short_name: strings.app.name,
        lang: 'zh-Hant-TW',
        display: 'standalone',
        start_url: './#/',
        scope: './',
        theme_color: darkBg,
        background_color: darkBg,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 預先快取所有建置產物，離線完整可用
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { outDir },
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true },
})
