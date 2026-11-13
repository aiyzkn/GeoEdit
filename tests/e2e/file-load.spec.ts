/**
 * ファイル読み込みの網羅テスト。
 *   - 3形式（GPX/GeoJSON/KML）の読み込みと反映
 *   - openAsKind セレクタ（種別指定読み込み）
 *   - 1ファイル複数ルート / 複数ファイル同時
 *   - ドラッグ&ドロップ
 *   - ルート名の衝突（同一ファイル内・別ファイル間のいずれも自動リネームで全件読み込む）
 *   - エラー系（未対応拡張子・不正XML）
 */
import { test, expect, setup, openFilesViaButton, dropFileOnMap, switchTab } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('GeoJSONを読み込む（ルート名はFeatureのnameプロパティ由来）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.geojson')
  await expect(page.getByText('読み込み完了: sample.geojson')).toBeVisible()
  await expect(page.getByText('GeoJSON Route', { exact: true })).toBeVisible()
  await expect(page.getByText('4 pts · 1 trk')).toBeVisible()
})

test('KMLを読み込む（ルート名はPlacemarkのname由来）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.kml')
  await expect(page.getByText('読み込み完了: sample.kml')).toBeVisible()
  await expect(page.getByText('KML Route', { exact: true })).toBeVisible()
  await expect(page.getByText('3 pts · 1 trk')).toBeVisible()
})

test('Point Featureのみのファイルは、既定の「トラックとして開く」ではトラックへ変換される', async ({ page }) => {
  // パーサーは Point のみのファイルを kind='waypoint' として読むが、loadFiles は
  // openAsKind（既定 'track'）で convertRouteKind を通す。waypoint→track 変換により
  // 単独ウェイポイントが1本のトラックのポイントへ昇格するため "2 pts · 1 trk" になる。
  // （ウェイポイントのまま読みたい場合の挙動は次の openAsKind テストで検証する）
  await openFilesViaButton(page, 'waypoints.geojson')
  await expect(page.getByText('読み込み完了: waypoints.geojson')).toBeVisible()
  await expect(page.getByText('waypoints', { exact: true })).toBeVisible()
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()
})

test('Point Featureのみのファイルを「ウェイポイントとして開く」とwptになる', async ({ page }) => {
  await page.getByRole('combobox').selectOption({ label: 'ウェイポイントとして開く' })
  await openFilesViaButton(page, 'waypoints.geojson')
  await expect(page.getByText('読み込み完了: waypoints.geojson')).toBeVisible()
  await expect(page.getByText('2 wpt')).toBeVisible()
})

test('openAsKindで種別を指定して開く（トラック→ウェイポイントとして読み込み）', async ({ page }) => {
  // ヘッダーのセレクタで「ウェイポイントとして開く」を選択してからGPXを読む。
  // convertRouteKind により全トラックポイントが standaloneWaypoints へ平坦化される
  await page.getByRole('combobox').selectOption({ label: 'ウェイポイントとして開く' })
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('読み込み完了: sample.gpx')).toBeVisible()
  await expect(page.getByText('5 wpt')).toBeVisible()

  // 属性タブでも要素種別が ウェイポイント になっていることを確認
  await switchTab(page, '属性')
  await expect(page.getByText('ウェイポイント (<wpt>)')).toBeVisible()
})

test('1ファイルに複数Featureがある場合、それぞれ別ルートとして読み込まれる', async ({ page }) => {
  await openFilesViaButton(page, 'two-routes.geojson')
  await expect(page.getByText('読み込み完了: two-routes.geojson（2 ルート）')).toBeVisible()
  await expect(page.getByText('ルートA', { exact: true })).toBeVisible()
  await expect(page.getByText('ルートB', { exact: true })).toBeVisible()
  // exact: true でヘッダーのカウンタに限定する（読み込みトースト「（2 ルート）」との
  // 部分一致による strict mode 違反を避けるため）
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()
})

test('複数ファイルを同時に読み込む', async ({ page }) => {
  await openFilesViaButton(page, ['sample.gpx', 'sample.kml'])
  await expect(page.getByText('読み込み完了: sample.gpx')).toBeVisible()
  await expect(page.getByText('読み込み完了: sample.kml')).toBeVisible()
  await expect(page.getByText('sample', { exact: true })).toBeVisible()
  await expect(page.getByText('KML Route', { exact: true })).toBeVisible()
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()
})

test('ドラッグ&ドロップでファイルを読み込む', async ({ page }) => {
  await dropFileOnMap(page, 'sample.gpx')
  await expect(page.getByText('読み込み完了: sample.gpx')).toBeVisible()
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
})

test('未対応の拡張子はエラートーストを表示する', async ({ page }) => {
  await openFilesViaButton(page, 'unsupported.txt')
  await expect(page.getByText('未対応のファイル形式: unsupported.txt')).toBeVisible()
  // ルートは追加されない
  await expect(page.getByText('ルートが読み込まれていません')).toBeVisible()
})

test('不正なXMLはエラートーストを表示し、ルートを追加しない', async ({ page }) => {
  await openFilesViaButton(page, 'invalid.gpx')
  await expect(page.getByText(/読み込みエラー: invalid\.gpx/)).toBeVisible()
  await expect(page.getByText('ルートが読み込まれていません')).toBeVisible()
})

test('同じファイルを再度読み込むと自動リネームして追加される（別ファイル間の同名も同様）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  // 同じファイルを再度開く → ルート名 'sample' が衝突するが、拒否せずリネームして読み込む
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('同名ルートを自動リネームしました: sample → sample (2)')).toBeVisible()
  await expect(page.getByText('sample', { exact: true })).toBeVisible()
  await expect(page.getByText('sample (2)', { exact: true })).toBeVisible()
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()
})

test('1ファイル内の同名ルートは自動リネームして全件読み込まれる', async ({ page }) => {
  // dup-names.geojson は同名（重複ルート）のFeatureを3つ含む。以前は2件目以降が
  // 「同名のルート」としてスキップされていたため、リネームで救済されることを確認する
  await openFilesViaButton(page, 'dup-names.geojson')
  await expect(page.getByText('読み込み完了: dup-names.geojson（3 ルート）')).toBeVisible()
  await expect(page.getByText(/同名ルートを自動リネームしました/)).toBeVisible()
  await expect(page.getByText('重複ルート', { exact: true })).toBeVisible()
  await expect(page.getByText('重複ルート (2)', { exact: true })).toBeVisible()
  await expect(page.getByText('重複ルート (3)', { exact: true })).toBeVisible()
  await expect(page.getByText('3 ルート', { exact: true })).toBeVisible()
})
