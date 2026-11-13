/**
 * E2E テスト共有ヘルパー
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  横展開の中核となる方針をここに集約する。個別スペックはここから import して
 *  使うことで、方針（特に外部ネットワークのモック）の実装漏れを防ぐ。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── E2E とユニットテストの役割分担 ──────────────────────────────────────
 *   - E2E  : UI操作の導線がつながっているか（ボタン→ダイアログ→状態反映→トースト）
 *   - unit : パーサー/シリアライザ/ジオメトリ計算の入出力の正しさ（tests/*.test.ts）
 * E2E で変換ロジックの網羅的な数値検証まではしない。「読み込んだデータが失われず
 * 反映・出力される」ことの確認に留め、細かい計算はユニット側に委ねる。
 *
 * ── セレクタの優先順位 ──────────────────────────────────────────────────
 * このアプリには data-testid が無いため、次の優先順位でセレクタを選ぶ:
 *   1. ユーザーに見えるテキスト/ロール（getByRole, getByText）— 文言変更で気づける
 *   2. title 属性（アイコンのみのボタン用。アプリが操作説明として付与している）
 *   3. role="dialog"（Modal.tsx が付与）でダイアログ内に検索をスコープする
 *   4. Leaflet の構造クラス（.leaflet-*）— canvas内の描画物はDOMテキストを持たないため
 * より堅牢にするならアプリ側に data-testid を足してから置き換えるのが正道。
 *
 * ── 状態検証の考え方 ────────────────────────────────────────────────────
 * Zustandストアはwindowに公開していないため、状態は「ユーザーに見える結果」で
 * 検証する。主な観測点:
 *   - トースト通知（addToast）: 操作の成否フィードバックの正式経路
 *   - ルート一覧の "{n} pts · {m} trk" / "{n} wpt" 表記（RouteList.tsx）
 *   - ヘッダーの "{n} ルート" カウンタ（AppHeader.tsx）
 *   - 統計/属性タブの表示値（StatsPanel/PropertiesPanel）
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// package.json が "type": "module" のため __dirname は使えない。import.meta.url から導出する
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURES_DIR = path.join(__dirname, 'fixtures')

/** フィクスチャファイルの絶対パスを返す。 */
export function fixture(name: string): string {
  return path.join(FIXTURES_DIR, name)
}

/** フィクスチャの中身を文字列で読む（ドラッグ&ドロップのシミュレート等でファイル内容が必要な場合に使う）。 */
export function fixtureContent(name: string): string {
  return fs.readFileSync(fixture(name), 'utf-8')
}

// タイルリクエストへ返す 1x1 透明 PNG。実画像でなくても Leaflet は正常動作し、
// タイル読み込みエラー（灰色タイル＋コンソールエラー）を出さずに済む
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

/**
 * localhost 以外への全 HTTP(S) リクエストを遮断してダミー応答を返す。
 *
 * 個別ホストの許可リスト方式ではなく「外部は全部ブロック」方式にしている理由:
 * tileLayers.ts には30以上のタイルソースがあり、レイヤー切替テストを追加する
 * たびにモック対象が漏れるのを防ぐため。個別テストで特定APIの応答を差し替えたい
 * 場合は、テスト内で page.route() を「後から」登録すればよい（Playwright は後勝ち）。
 *
 * 対象API:
 *   - 標高API（getelevation.php）    : 決定的な標高値を返す
 *   - ジオコーディング（msearch.gsi） : 既定は空配列（"見つからない"の確認用）
 *   - それ以外（ほぼタイル画像）        : 透明PNG
 */
export async function mockExternalNetwork(page: Page) {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (route) => {
    const url = route.request().url()
    if (url.includes('getelevation.php')) {
      await route.fulfill({ json: { elevation: 10.0, hsrc: '5m（レーザ）' } })
    } else if (url.includes('msearch.gsi.go.jp')) {
      await route.fulfill({ json: [] })
    } else {
      await route.fulfill({ contentType: 'image/png', body: TRANSPARENT_PNG })
    }
  })
}

/**
 * 「開く」ボタン経由でファイルを読み込む。
 *
 * アプリは <input type="file"> をDOMに常設せず、クリック時に動的生成して .click()
 * する実装（useFileLoader.ts の openFiles）。この方式では setInputFiles(selector) が
 * 使えないため、filechooser イベントを待ち受けてファイルを渡す。
 * 複数ファイル同時読み込みは配列で渡す。
 * 注意: waitForEvent はクリック「前」に仕掛ける（クリック後だと取り逃がす）。
 */
export async function openFilesViaButton(page: Page, fixtureNames: string | string[]) {
  const files = (Array.isArray(fixtureNames) ? fixtureNames : [fixtureNames]).map(fixture)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '開く' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(files)
}

/**
 * ファイルをドラッグ&ドロップで読み込む（MapPane の onDrop 経路）。
 *
 * Playwright には本物のファイルD&Dのショートカットが無いため、ブラウザ内で
 * DataTransfer を組み立て、Leaflet コンテナに dragover→drop を dispatch する。
 * ファイル内容は Node 側で読んで文字列として evaluate に渡す。
 */
export async function dropFileOnMap(page: Page, fixtureName: string) {
  const content = fixtureContent(fixtureName)
  const dataTransfer = await page.evaluateHandle(
    ({ content, name }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([content], name, { type: 'application/octet-stream' }))
      return dt
    },
    { content, name: fixtureName }
  )
  const map = page.locator('.leaflet-container')
  await map.dispatchEvent('dragover', { dataTransfer })
  await map.dispatchEvent('drop', { dataTransfer })
}

/**
 * タイムラインのカードをクリックして指定インデックスのポイントを選択する。
 *
 * 地図canvas上のポイントはDOMセレクタで掴めないが、タイムラインのカードは
 * 通常のDOM要素（"#0" 等のテキストを持つ）なので、ポイント選択が必要な編集
 * （分割・区間削除・詳細）はタイムライン経由で行うのが安定する。
 * modifiers で Shift/Ctrl クリック（範囲選択・個別複数選択）も指定できる。
 */
export async function selectTimelinePoint(
  page: Page,
  index: number,
  opts?: { modifiers?: Array<'Control' | 'Shift'> }
) {
  await page.getByText(`#${index}`, { exact: true }).click({ modifiers: opts?.modifiers })
}

/** 編集ツールバーのモードボタンを押す（label はツールバーの表示ラベル: 選択/作成/分割…）。 */
export async function selectMode(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
}

/** 右サイドバーのタブを切り替える（ルート/レイヤー/属性/統計）。 */
export async function switchTab(page: Page, label: 'ルート' | 'レイヤー' | '属性' | '統計') {
  await page.getByRole('button', { name: label, exact: true }).click()
}

/** goto + 外部ネットワークモックをまとめた標準セットアップ。全スペックの beforeEach で呼ぶ。 */
export async function setup(page: Page) {
  await mockExternalNetwork(page)
  await page.goto('/')
  // 地図初期化（Leafletコンテナ生成）を待つ。以降のD&Dやマップクリックの前提
  await expect(page.locator('.leaflet-container')).toBeVisible()
}

export { test, expect }
