import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// unit：domain 與 db（node 環境）；component：React 元件（happy-dom + fake-indexeddb）
export default defineConfig({
  plugins: [react()],
  test: {
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
