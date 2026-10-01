import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const domainMessage = 'src/domain must stay pure: no React, Dexie or src/db imports (SPEC 2, DoD 10.3 P1).'
const devImportRestriction = {
  group: ['**/dev', '**/dev/**', 'src/dev', 'src/dev/**', '@/dev', '@/dev/**'],
  message: 'src/dev is development-only and must not be imported by production code (A9).',
}

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'test-results', 'playwright-report', '.claude/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },
  // A9：開發用 seed 產生器（src/dev）不得被正式程式碼 import，確保不進 production bundle
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/dev/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [devImportRestriction] }],
    },
  },
  // no-restricted-imports 不檢查 dynamic import()，另以 no-restricted-syntax 禁止；
  // 唯一例外是設定頁的開發用 seed 按鈕（Q6），它只在 import.meta.env.DEV 條件內 dynamic import，正式建置會被移除
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/dev/**', 'src/features/settings/DevSeedSection.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/(^|\\/)dev(\\/|$)/]',
          message: devImportRestriction.message,
        },
      ],
    },
  },
  // DoD 10.3 P1：domain/ 為純函式，不得 import React、Dexie 或 db 層
  // （flat config 同一規則後者覆蓋前者，所以這裡也要重複 dev 的限制）
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: domainMessage },
            { name: 'react-dom', message: domainMessage },
            { name: 'dexie', message: domainMessage },
          ],
          patterns: [
            { group: ['react/*', 'react-dom/*', 'dexie/*'], message: domainMessage },
            { group: ['**/db', '**/db/**', 'src/db', 'src/db/**', '@/db', '@/db/**'], message: domainMessage },
            devImportRestriction,
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
)
