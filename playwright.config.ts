import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E テスト設定
 *
 * ── このリポジトリでの E2E テストの位置づけ ──────────────────────────
 * - ユニットテスト（tests/*.test.ts, `npm test`, node --test 実行）とは完全に分離する。
 *   E2E スペックは tests/e2e/ 配下に置き、ファイル名は *.spec.ts とする
 *   （ユニット側の glob `tests/*.test.ts` はサブディレクトリを見ないため衝突しないが、
 *   拡張子も分けておくことで意図の混同を防ぐ）。
 * - 実行コマンドは `npm run test:e2e`（package.json の scripts 参照）。
 *
 * ── webServer: テスト対象アプリの起動 ────────────────────────────────
 * Playwright はテスト開始前に下記コマンドでアプリを自動起動し、URL が応答する
 * まで待ってからテストを流す。テスト終了時に自動停止する。
 * - `vite preview` ではなく `vite dev` を使う理由: preview は事前の `npm run build`
 *   （tsc -b 含む）が必要で、スモークテストの反復実行が遅くなるため。
 *   リリース前の最終確認としてビルド成果物を検証したい場合は、command を
 *   `npm run build && npm run preview -- --port 5173 --strictPort` に差し替えればよい。
 * - reuseExistingServer: ローカルで `npm run dev` を既に起動したまま
 *   テストを回す開発フローを許容する（CI では常に新規起動される）。
 */
export default defineConfig({
  testDir: './tests/e2e',

  // 地図タイルの描画待ちなどで1テストが長引くことがあるため、デフォルト(30s)より長めに取る
  timeout: 60_000,

  // expect() のポーリング上限。地図描画・トースト表示は非同期なので少し余裕を持たせる
  expect: { timeout: 10_000 },

  // スモークテストは相互依存がないため並列実行可
  fullyParallel: true,

  // CI では test.only の消し忘れを失敗として検出する
  forbidOnly: !!process.env.CI,

  // CI のみリトライを許可（ローカルでは flaky を隠さないため 0）
  retries: process.env.CI ? 2 : 0,

  // 失敗時の調査材料。trace はPlaywright Trace Viewerで再生できる実行記録
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // まずは Chromium のみ。横展開時に firefox / webkit を追加する場合は
  // projects に { name: 'firefox', use: { ...devices['Desktop Firefox'] } } 等を足す
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  // HTMLレポートは playwright-report/ に出力（.gitignore 対象にすること）。
  // open: 'never' — テスト失敗時に自動でブラウザが開くとCIや自動化フローの邪魔になるため
  reporter: [['html', { open: 'never' }], ['list']],
})
