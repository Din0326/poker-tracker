// SPEC-v2-hands 12.3 H5 第 1 項的準備：重新產生 GTO Wizard 驗證檔到 docs/gto-wizard-check/（npm run gto-check）。
// 內容由專案的 exportPokerStars 產生（見 tests/unit/helpers/gtoWizardCheck.ts），不手寫輸出文字；
// README.md 為手寫說明，不由本腳本產生。匯出程式變更後須重新執行，tests/unit/gto-wizard-check.test.ts 會檢查是否同步。
// 以 jiti 執行（TypeScript 直接載入 src/domain）：node_modules/.bin/jiti scripts/make-gto-wizard-check.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gtoWizardCheckFiles } from '../tests/unit/helpers/gtoWizardCheck'

const outDir = join(import.meta.dirname, '..', 'docs', 'gto-wizard-check')
mkdirSync(outDir, { recursive: true })
for (const { name, text } of gtoWizardCheckFiles()) {
  // 7.2：UTF-8 不加 BOM、`\n` 換行（以 Buffer 寫出，不經任何換行轉換）
  writeFileSync(join(outDir, name), Buffer.from(text, 'utf8'))
  console.log(`已產生 docs/gto-wizard-check/${name}`)
}
