import { defineConfig, devices } from '@playwright/test'

/**
 * 性能の計測（designs/機能追加・UI改善設計書.md E3）。ふだんの E2E（playwright.config.ts）とは分ける。
 * 本番ビルド（vite build + vite preview）で計る（dev サーバーは React が開発版で、数値が大きく違う）。
 * `npm run test:perf`
 */
export default defineConfig({
  testDir: './tests/perf',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
