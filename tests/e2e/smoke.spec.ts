/**
 * E2E スモークテスト: 「ファイル読み込み → 地図表示 → エクスポート」のハッピーパス1本。
 *
 * これはスイート全体の「配線チェック」であり、最短の通しフローが動くことを保証する。
 * 詳細な機能別テストは file-load / export / edit-operations などの各スペックに分離した。
 * 共有の方針・ヘルパーは helpers.ts に集約している（外部ネットワークモック等）。
 */
import fs from 'node:fs/promises'
import { test, expect, setup, fixture, openFilesViaButton } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('GPXを読み込み、地図に描画され、GPXとしてエクスポートできる', async ({ page }) => {
  // 前提: 初期状態はプレースホルダーが見えている
  await expect(
    page.getByText('ファイルをドラッグ＆ドロップ、または「開く」ボタンから読み込み')
  ).toBeVisible()

  // Step 1: 読み込み
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('読み込み完了: sample.gpx')).toBeVisible()

  // Step 2: UIへの反映（ルート名はファイル名由来 = "sample"。gpxParser.ts 参照）
  await expect(page.getByText('sample', { exact: true })).toBeVisible()
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await expect(page.getByText('1 ルート')).toBeVisible()

  // Step 3: 地図上への描画（polyline = SVG path。タイルとは独立したレイヤー）
  await expect(
    page.locator('.leaflet-overlay-pane path.leaflet-interactive').first()
  ).toBeVisible()

  // Step 4: エクスポート（ルート行のダウンロードアイコンからダイアログを開く）
  await page.getByTitle('エクスポート').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'エクスポート' })).toBeVisible()
  await expect(dialog.getByRole('textbox')).toHaveValue('sample_ed')

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sample_ed.gpx')

  // Step 5: エクスポート内容の検証（データが失われず出力されているか）
  const content = await fs.readFile(await download.path(), 'utf-8')
  expect(content).toContain('<gpx')
  expect(content).toContain('E2E Sample Track')
  expect(content.match(/<trkpt/g)).toHaveLength(5)
  expect(content).toContain('lat="35.681236"')
  expect(content).toContain('lon="139.767125"')

  await expect(page.getByText('エクスポート完了: sample_ed.gpx')).toBeVisible()
})
