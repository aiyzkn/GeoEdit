/**
 * 時刻の速度指定・形を保つ間引き・作成中の要約（designs/機能追加・UI改善設計書.md B3〜B5）。
 * 標高タイルは共通のモックで 1×1 の透明画像になるので、標高は標高 API のモック（10.0 m）から取られる（B6 の代替の経路）。
 */
import { test, expect, setup, openFilesViaButton, selectMode, switchTab, serveRoadTiles, serveLeafletCss, zoomIn, mockExternalNetwork } from './helpers'

test('間引き: 形を保つ方式で、まっすぐな所の点を落とす', async ({ page }) => {
  await setup(page)
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await selectMode(page, '間引き')
  await page.getByRole('radio', { name: '形を保つ' }).check()
  await page.getByRole('spinbutton', { name: '許容（m）' }).fill('100')
  await page.getByRole('button', { name: '間引き実行' }).click()
  await expect(page.getByText(/間引き完了: \d+ ポイント削除/)).toBeVisible()
  // 両端は残る（5 点より少なく、2 点以上）
  await expect(page.getByText(/^[234] pts · 1 trk$/)).toBeVisible()
})

test('時刻再計算: 一定の速度を選ぶと、所要時間がその速度になる', async ({ page }) => {
  await setup(page)
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await selectMode(page, '時刻編集')
  await page.getByRole('combobox', { name: '速度' }).selectOption('constant')
  await page.getByRole('spinbutton', { name: '一定の速度（km/h）' }).fill('36')
  await page.getByRole('spinbutton', { name: '一定の速度（km/h）' }).press('Enter')
  await page.getByRole('button', { name: '時刻再計算', exact: true }).click()
  await expect(page.getByText('時刻を再計算しました')).toBeVisible()
  // 統計の平均速度が 36 km/h になる
  await switchTab(page, '統計')
  await expect(page.getByText(/36(\.0)? km\/h/).first()).toBeVisible()
})

test('作成モード: 道のり・登り下り・見込みの所要時間を 1 行で出す', async ({ page }) => {
  await mockExternalNetwork(page)
  await serveLeafletCss(page)
  await serveRoadTiles(page)
  await page.goto('/')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await zoomIn(page, 6)
  await selectMode(page, '作成')
  await expect(page.getByRole('checkbox', { name: '点を間引く（形を保つ）' })).toBeChecked()
  const map = page.locator('.leaflet-container')
  await map.click({ position: { x: 300, y: 120 } })
  await map.click({ position: { x: 520, y: 230 } })
  const summary = page.getByTestId('draft-summary')
  await expect(summary).toContainText('見込み')
  // 標高がそろうと、登り・下りが出る（モックの標高は一定なので 0 m）
  await expect(summary).toContainText('登り 0 m / 下り 0 m')
  await expect(summary).not.toContainText('取得中')
  // 確定すると、間引いた点の数のルートになる（作成中に取った標高をそのまま使う）
  await page.getByRole('button', { name: '確定' }).click()
  await expect(page.getByText(/ルートを作成しました（\d+ ポイント）/)).toBeVisible()
})
