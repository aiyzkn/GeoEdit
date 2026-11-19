/**
 * エクスポートの網羅テスト。
 *   - 3形式（GeoJSON/GPX/KML）それぞれのダウンロードと内容ラウンドトリップ
 *   - GPXの出力モード切替（ウェイポイント含む/除く 等）
 *   - ファイル名編集
 *   - EditModePanel の「出力」モード経由のエクスポート
 *
 * ダウンロード内容の検証方針: XMLの厳密等価性はユニット側の責務。ここでは
 * 「読み込んだ主要データ（座標・名前・点数）が失われず書き出されている」ことを確認する。
 */
import fs from 'node:fs/promises'
import { test, expect, setup, openFilesViaButton, selectMode } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

/** ルート行のダウンロードアイコンからエクスポートダイアログを開き、形式ボタンを選ぶ。 */
async function openExportDialog(page: import('@playwright/test').Page, format: 'GEOJSON' | 'GPX' | 'KML') {
  await page.getByTitle('エクスポート').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'エクスポート' })).toBeVisible()
  await dialog.getByRole('button', { name: format, exact: true }).click()
  return dialog
}

/** ダイアログでダウンロードを実行し、保存されたファイルの中身を文字列で返す。 */
async function download(page: import('@playwright/test').Page, dialog: import('@playwright/test').Locator) {
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  const dl = await downloadPromise
  const content = await fs.readFile(await dl.path(), 'utf-8')
  return { dl, content }
}

test('GPXとしてエクスポートできる（既定形式・座標と点数が保持される）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  const dialog = await openExportDialog(page, 'GPX')
  const { dl, content } = await download(page, dialog)

  expect(dl.suggestedFilename()).toBe('sample_ed.gpx')
  expect(content).toContain('<gpx')
  expect(content.match(/<trkpt/g)).toHaveLength(5)
  expect(content).toContain('lat="35.681236"')
})

test('GeoJSONとしてエクスポートできる（FeatureCollection・LineString）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  const dialog = await openExportDialog(page, 'GEOJSON')
  const { dl, content } = await download(page, dialog)

  expect(dl.suggestedFilename()).toBe('sample_ed.geojson')
  const json = JSON.parse(content)
  expect(json.type).toBe('FeatureCollection')
  expect(json.features[0].geometry.type).toBe('LineString')
  // [lng, lat, ele] 順で5点
  expect(json.features[0].geometry.coordinates).toHaveLength(5)
  expect(json.features[0].geometry.coordinates[0]).toEqual([139.767125, 35.681236, 3])
})

test('KMLとしてエクスポートできる（Placemark・LineString）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  const dialog = await openExportDialog(page, 'KML')
  const { dl, content } = await download(page, dialog)

  expect(dl.suggestedFilename()).toBe('sample_ed.kml')
  expect(content).toContain('<kml')
  expect(content).toContain('<LineString>')
  expect(content).toContain('<coordinates>')
  // KMLは lng,lat,ele 形式
  expect(content).toContain('139.767125,35.681236,3')
})

test('GPX出力モードを切り替えられる（最小形式）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  const dialog = await openExportDialog(page, 'GPX')
  // GPXモードのラジオ群が表示される（GPX選択時のみ）
  await dialog.getByRole('radio', { name: '最小形式（ウェイポイント含む）' }).check()
  const { content } = await download(page, dialog)

  expect(content).toContain('<gpx')
  expect(content.match(/<trkpt/g)).toHaveLength(5)
})

test('ファイル名を編集してエクスポートできる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await page.getByTitle('エクスポート').click()
  const dialog = page.getByRole('dialog')
  const nameInput = dialog.getByRole('textbox')
  await expect(nameInput).toHaveValue('sample_ed')
  await nameInput.fill('my-custom-name')

  const { dl } = await download(page, dialog)
  expect(dl.suggestedFilename()).toBe('my-custom-name.gpx')
  await expect(page.getByText('エクスポート完了: my-custom-name.gpx')).toBeVisible()
})

test('ヘッダーの「出力」から、選択中のルートを直接エクスポートできる', async ({ page }) => {
  // ルートを選んでいなければ押せない
  await expect(page.getByRole('button', { name: '出力', exact: true })).toBeDisabled()
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // ヘッダーの「出力」→ すぐにエクスポートダイアログ（モードを経由しない）
  await page.getByRole('button', { name: '出力', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'エクスポート' })).toBeVisible()
  const { dl } = await download(page, dialog)
  expect(dl.suggestedFilename()).toBe('sample_ed.gpx')
})
