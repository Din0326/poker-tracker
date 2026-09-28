# 德州記帳

德州撲克個人記帳 PWA。規格見 [docs/SPEC.md](docs/SPEC.md)。

## 開發

```bash
npm install
npx playwright install webkit
npm run dev
```

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 開發伺服器 |
| `npm run build` | 型別檢查後建置到 `dist/` |
| `npm run check` | typecheck、ESLint、寫死中文與色碼檢查、Vitest |
| `npm run e2e` | Playwright（WebKit、iPhone 14），會先建置再以 preview 測試 |
| `npm run screenshots -- p0` | 產生深淺色截圖到 `docs/screenshots/p0/` |
| `npm run icons` | 依 token 重新產生佔位圖示 |

## 約定

- 顏色只定義在 `src/styles/tokens.css`，元件以 `text-(--color-*)` 等方式使用；Tailwind 預設色盤已移除。
- 畫面文字集中在 `src/strings.ts`。
- `npm run check:strings`、`npm run check:colors` 會擋下寫死的中文與色碼（註解除外）。

## 部署

推到 `main` 後由 GitHub Actions 部署到 GitHub Pages（`.github/workflows/deploy.yml`）。
