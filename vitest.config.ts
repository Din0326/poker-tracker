import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// unit：domain 與 db（node 環境）；component：React 元件（happy-dom + fake-indexeddb）
// .claude/ 內可能有 agent 的 git worktree（含整份測試），排除以免被掃到
export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        // service worker 註冊模組由 vite-plugin-pwa 在建置時產生，元件測試改用替身
        resolve: {
          alias: {
            'virtual:pwa-register/react': fileURLToPath(new URL('./tests/component/mocks/pwaRegister.ts', import.meta.url)),
          },
        },
        test: {
          name: 'component',
          include: ['tests/component/**/*.test.tsx'],
          environment: 'happy-dom',
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
  },
})
