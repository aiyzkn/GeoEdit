/**
 * 総合テスト（システムテスト）: 実際の利用シナリオを通しで検証する。
 *
 * ── 既存E2Eとの違い ────────────────────────────────────────────────────
 * 機能別E2E（tests/e2e/*.spec.ts）は「1機能=1テスト」で部品を個別検証する。
 * 総合テストは要件定義書の受入シナリオに沿って、複数機能をまたぐ一連の業務フローが
 * 端から端まで成立するかを検証する。各ステップに要件定義書の節番号を併記し、
 * 要件トレーサビリティを持たせる。
 *
 * 基盤・方針は機能別E2Eと共通（tests/e2e/helpers.ts）。外部API（タイル/標高/地名）は
 * 全モックしネットワーク非依存にする。
 *
 * 本ファイルのシナリオ:
 *   S1. GPXログ編集の一連フロー（§4 読込 / §6 編集 / §8 Undo / §9 出力）
 *   S4. フォーマット変換ワークフロー（§4.5 要素種別 / §9 出力）
 */
import fs from 'node:fs/promises'
import { test, expect, setup, openFilesViaButton, selectMode, switchTab } from '../helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('S1: 読込→逆順→間引き→Undo→GPX出力（編集ログの一連フロー）', async ({ page }) => {
  // §4.2 読み込み
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // §6.10 逆ルート: 時刻データが除去される
  await selectMode(page, '逆順')
  await page.getByRole('button', { name: '逆順にする' }).click()
  await expect(page.getByText('トラックを逆順にしました')).toBeVisible()
  await switchTab(page, '統計')
  await expect(page.getByText('—（時刻データなし）')).toBeVisible()
  await switchTab(page, 'ルート')

  // §6.6 間引き: 5点→2点
  await selectMode(page, '間引き')
  await page.getByRole('spinbutton').fill('1000')
  await page.getByRole('button', { name: '間引き実行' }).click()
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()

  // §8 Undo: 直前の間引きを取り消し → 5点（逆順は維持）へ
  await page.getByRole('button', { name: /元に戻す/ }).click()
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // §9 出力: GPXとして書き出し、逆順（時刻なし・順序反転）が反映されていることを確認
  await page.getByTitle('エクスポート', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'エクスポート' })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  const content = await fs.readFile(await (await downloadPromise).path(), 'utf-8')

  expect(content.match(/<trkpt/g)).toHaveLength(5)
  // 逆順で先頭が元の末尾座標（lat 35.6855）になっている
  expect(content).toMatch(/lat="35\.6855"/)
  const firstLat = content.match(/lat="([\d.]+)"/)![1]
  expect(firstLat).toBe('35.6855')
  // 逆順により時刻は全て除去されている
  expect(content).not.toContain('<time>')
})

test('S4: GPX読込→要素種別変換→別形式でエクスポート（フォーマット変換）', async ({ page }) => {
  // §4.2 GPX（トラック）を読み込む
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await expect(page.getByTitle(/要素種別: トラック/)).toBeVisible()

  // §4.5 トラック→ルートへ変換し、GPXが <rte> で出力されることを確認
  await page.getByTitle(/要素種別: トラック/).click()
  await expect(page.getByTitle(/要素種別: ルート/)).toBeVisible()

  await page.getByTitle('エクスポート', { exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'GPX', exact: true }).click()
  let dl = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  let content = await fs.readFile(await (await dl).path(), 'utf-8')
  expect(content).toContain('<rte>')
  expect(content.match(/<rtept/g)).toHaveLength(5)

  // §4.5 さらにウェイポイントへ変換 → "5 wpt"、KML出力で Point になることを確認
  await page.getByTitle(/要素種別: ルート/).click()
  await expect(page.getByText('5 wpt')).toBeVisible()

  await page.getByTitle('エクスポート', { exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'KML', exact: true }).click()
  dl = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'ダウンロード' }).click()
  content = await fs.readFile(await (await dl).path(), 'utf-8')
  expect(content.match(/<Point>/g)).toHaveLength(5)
})
