/**
 * 総合テスト（システムテスト）: 作図・結合の業務フロー。
 *   S2. 新規ルート作図→時刻付与→エクスポート（§6.1 作成 / §6.7 時間変更 / §9 出力）
 *   S3. 複数ファイル読込→結合→統計確認→再エクスポート（§4.2 / §6.5 結合 / §10 管理 / §12.1 統計）
 *
 * 地図canvasを使う作図は、マップマッチングのタイル解析を避けるため Ctrl+クリック
 * （マッチングをスキップする修飾）で座標を決定的にする（MapPane.tsx 参照）。
 */
import fs from 'node:fs/promises'
import { test, expect, setup, openFilesViaButton, selectMode, switchTab } from '../helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('S2: 地図で新規ルートを作図→時刻付与→GeoJSON出力', async ({ page }) => {
  // §6.1 作成モードに入る（開始日時はページ読込時刻で初期化済み → 作成時に時刻が配分される）
  await selectMode(page, '作成')
  await expect(page.getByText('地図をクリックしてポイントを追加（0 点）')).toBeVisible()
  // 標高自動取得はオフ（外部API非依存化）。開始日時の既定は残すので時刻は付与される
  await page.getByRole('checkbox', { name: '標高を自動取得' }).uncheck()

  // Ctrl+クリックでマップマッチングをスキップしつつ3点作図
  const map = page.locator('.leaflet-container')
  await map.click({ modifiers: ['Control'], position: { x: 300, y: 240 } })
  await map.click({ modifiers: ['Control'], position: { x: 420, y: 300 } })
  await map.click({ modifiers: ['Control'], position: { x: 540, y: 360 } })
  await expect(page.getByText('地図をクリックしてポイントを追加（3 点）')).toBeVisible()

  // §6.1 確定 → 新規ルート作成
  await page.getByRole('button', { name: '確定' }).click()
  await expect(page.getByText(/ルートを作成しました（3 ポイント）/)).toBeVisible()
  await expect(page.getByText('3 pts · 1 trk')).toBeVisible()

  // §9 GeoJSON出力 → 3座標＋時刻（coordTimes）が付与されていることを確認（§6.7）
  await page.getByTitle('エクスポート', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'GEOJSON', exact: true }).click()
  const dl = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  const json = JSON.parse(await fs.readFile(await (await dl).path(), 'utf-8'))

  const line = json.features.find((f: { geometry: { type: string } }) => f.geometry.type === 'LineString')
  expect(line.geometry.coordinates).toHaveLength(3)
  expect(line.properties.coordTimes).toHaveLength(3)
  // 時刻は単調増加
  const times = line.properties.coordTimes.map((t: string) => Date.parse(t))
  expect(times[1]).toBeGreaterThan(times[0])
  expect(times[2]).toBeGreaterThan(times[1])
})

test('S3: 2ファイル読込→結合→統計確認→GPX再エクスポート', async ({ page }) => {
  // §4.2 1ファイル内の2ルート（ルートA/B・各3点）を読み込む
  await openFilesViaButton(page, 'two-routes.geojson')
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()

  // §6.5 結合（単純接続）: A・Bを選択して結合
  await selectMode(page, '結合')
  await page.getByText('ルートA', { exact: true }).click()
  await page.getByText('ルートB', { exact: true }).click()
  await page.getByRole('radio', { name: 'トラックの単純接続' }).check()
  await page.getByRole('button', { name: '結合実行' }).click()
  await expect(page.getByText('ルートA と ルートB を結合しました')).toBeVisible()

  // §10 管理: 1ルートに集約され、2トラック・計6点になる
  await expect(page.getByText('1 ルート', { exact: true })).toBeVisible()
  await expect(page.getByText('6 pts · 2 trk')).toBeVisible()

  // §12.1 統計: 統合ルートの統計が表示される（ポイント総数など）
  await switchTab(page, '統計')
  await expect(page.getByText('ルートA の統計')).toBeVisible()
  await expect(page.getByText('トラックポイント総数')).toBeVisible()
  await switchTab(page, 'ルート')

  // §9 GPX再エクスポート: 2トラック・6点が出力される
  await page.getByTitle('エクスポート', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  const dl = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  const content = await fs.readFile(await (await dl).path(), 'utf-8')
  expect(content.match(/<trkseg>/g)).toHaveLength(2)
  expect(content.match(/<trkpt/g)).toHaveLength(6)
})
