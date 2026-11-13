/**
 * ルート一覧（RouteList）の操作テスト。
 *   - 複数ルート間の選択切替
 *   - ルート削除
 *   - 要素種別の循環変換（トラック→ルート→ウェイポイント）
 *   - 描画色の変更
 *   - ヘッダーのルート数カウンタ
 */
import { test, expect, setup, openFilesViaButton, switchTab } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('複数ルートの選択を切り替えられる', async ({ page }) => {
  await openFilesViaButton(page, 'two-routes.geojson')
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()

  // ルート行のコンテナは name の span を含む。クリックで選択され青枠になる。
  // 最初に読み込まれた routeA が自動選択されているので、routeB をクリックして切替
  const routeB = page.getByText('ルートB', { exact: true })
  await routeB.click()

  // 統計タブでルートBが選択されていることを確認（統計見出しに選択中ルート名が出る）
  await switchTab(page, '統計')
  await expect(page.getByText('ルートB の統計')).toBeVisible()

  // ルートAへ戻す
  await switchTab(page, 'ルート')
  await page.getByText('ルートA', { exact: true }).click()
  await switchTab(page, '統計')
  await expect(page.getByText('ルートA の統計')).toBeVisible()
})

test('ルートを削除できる', async ({ page }) => {
  await openFilesViaButton(page, 'two-routes.geojson')
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()

  // ルートAの行の削除ボタン（title="削除"）を押す。
  // exact: true が必須 — 既定の部分一致だとツールバーの「区間削除」ボタンにも
  // マッチしてDOM上先に来るそちらを掴んでしまう。exact で行内の「削除」に限定する。
  // 行は複数あるので first() で先頭=ルートA。
  await page.getByTitle('削除', { exact: true }).first().click()

  await expect(page.getByText('ルートA', { exact: true })).toBeHidden()
  await expect(page.getByText('ルートB', { exact: true })).toBeVisible()
  await expect(page.getByText('1 ルート', { exact: true })).toBeVisible()
})

test('要素種別を循環変換できる（トラック→ルート→ウェイポイント）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // 初期はトラック。種別ボタンの title に現在種別が入る
  await expect(page.getByTitle(/要素種別: トラック/)).toBeVisible()

  // 1回クリック → ルート
  await page.getByTitle(/要素種別: トラック/).click()
  await expect(page.getByTitle(/要素種別: ルート/)).toBeVisible()
  // Undoスタックに操作が積まれる（Undoボタンの title に直近操作の説明が入る）
  await expect(page.getByTitle('元に戻す (Ctrl+Z) — 要素種別変換')).toBeVisible()

  // もう1回 → ウェイポイント（トラックポイントが standaloneWaypoints へ平坦化 → "5 wpt"）
  await page.getByTitle(/要素種別: ルート/).click()
  await expect(page.getByTitle(/要素種別: ウェイポイント/)).toBeVisible()
  await expect(page.getByText('5 wpt')).toBeVisible()

  // 属性タブでも要素種別を確認
  await switchTab(page, '属性')
  await expect(page.getByText('ウェイポイント (<wpt>)')).toBeVisible()
})

test('ルートの描画色を変更できる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // カラースウォッチの <input type="color">。fill でHEX値を設定できる
  const colorInput = page.locator('input[type="color"]').first()
  await colorInput.fill('#ff0000')
  await expect(colorInput).toHaveValue('#ff0000')
})
