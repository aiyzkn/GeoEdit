/**
 * 総合テスト（システムテスト）: 解析・同期の業務フロー。
 *   S5. 標高なしファイル読込→標高自動補完→統計反映（§4.2 / §7 / §12.1）
 *   S6. 地図↔タイムライン↔属性パネルの選択同期と編集の伝播（§3.4 / §7 / §15）
 */
import { test, expect, setup, openFilesViaButton, selectTimelinePoint, switchTab } from '../helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('S5: 標高なし読込→GSI APIで自動補完→統計に反映', async ({ page }) => {
  // §4.2 標高が1点も無いファイルを読み込むと、標高APIから自動補完される。
  // setup() の既定モックが getelevation.php に elevation=10 を返す。
  await openFilesViaButton(page, 'no-elevation.gpx')
  await expect(page.getByText('読み込み完了: no-elevation.gpx')).toBeVisible()

  // §4.2 自動補完の完了通知（全3点が補完される）
  await expect(page.getByText(/標高データを自動補完しました/)).toBeVisible()

  // §12.1 統計: 全点が 10m に補完されたため最高/最低標高がともに 10m になる
  await switchTab(page, '統計')
  await expect(page.getByText('10 m / 10 m')).toBeVisible()
})

test('S6: タイムライン選択→属性表示→標高インライン編集→統計へ伝播', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // 地図にルートが描画されている（§3.3）
  await expect(page.locator('.leaflet-overlay-pane path.leaflet-interactive').first()).toBeVisible()

  // §3.4 タイムラインでポイント#2を選択 → §7 属性パネルに同じポイントの詳細が出る
  await selectTimelinePoint(page, 2)
  await switchTab(page, '属性')
  await expect(page.getByText('選択ポイント [2]')).toBeVisible()
  await expect(page.getByText('累積距離')).toBeVisible()

  // §7 標高をインライン編集（step="0.1" が属性パネルの標高欄。タイムラインの緯度経度と区別）
  const eleInput = page.locator('input[step="0.1"]')
  await eleInput.fill('1500')
  await eleInput.blur()

  // 編集により Undo が有効化される（§8 と連動）
  await expect(page.getByRole('button', { name: /元に戻す/ })).toBeEnabled()

  // §12.1 統計へ伝播: 最高標高が編集値 1500m になる
  await switchTab(page, '統計')
  await expect(page.getByText('1500 m / 3 m')).toBeVisible()

  // §8 Undo で標高編集が取り消され、統計も元へ戻る（最高標高 8m ≒ 7.5四捨五入）
  await page.getByRole('button', { name: /元に戻す/ }).click()
  await switchTab(page, '統計')
  await expect(page.getByText('1500 m / 3 m')).toBeHidden()
})
