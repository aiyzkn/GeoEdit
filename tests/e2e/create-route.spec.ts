/**
 * ルート作成モードのテスト（地図canvasクリックを伴う数少ないケース）。
 *
 * 地図クリックは Ctrl（マップマッチングをスキップする修飾）を押しながら行う。
 * これにより matchPoint のタイル画像解析（非同期・タイルモック依存）を回避し、
 * クリック座標がそのまま採用されて決定的になる（MapPane.tsx の handleClick 参照）。
 *
 * あわせて「未確定ポイントがある状態で離脱すると確認ダイアログが出る」ガード
 * （confirmDiscardCreatePoints）も検証する。
 */
import { test, expect, setup, selectMode } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('地図クリックで新規ルートを作成できる', async ({ page }) => {
  await selectMode(page, '作成')
  // 作成パネルが出る（初期は0点）
  await expect(page.getByText('地図をクリックしてポイントを追加（0 点）')).toBeVisible()

  // 標高自動取得はオフにして外部API依存を無くす
  await page.getByRole('checkbox', { name: '標高を自動取得' }).uncheck()

  // Ctrl+クリックでマップマッチングをスキップしつつ2点追加
  const map = page.locator('.leaflet-container')
  await map.click({ modifiers: ['Control'], position: { x: 300, y: 250 } })
  await expect(page.getByText('地図をクリックしてポイントを追加（1 点）')).toBeVisible()
  await map.click({ modifiers: ['Control'], position: { x: 500, y: 350 } })
  await expect(page.getByText('地図をクリックしてポイントを追加（2 点）')).toBeVisible()

  // 確定 → 新規ルート作成
  await page.getByRole('button', { name: '確定' }).click()
  await expect(page.getByText(/ルートを作成しました（2 ポイント）/)).toBeVisible()
  await expect(page.getByText('新規ルート 1', { exact: true })).toBeVisible()
  await expect(page.getByText('1 ルート', { exact: true })).toBeVisible()
})

test('未確定ポイントがある状態での離脱は確認ダイアログでキャンセルできる', async ({ page }) => {
  await selectMode(page, '作成')
  await page.getByRole('checkbox', { name: '標高を自動取得' }).uncheck()

  const map = page.locator('.leaflet-container')
  await map.click({ modifiers: ['Control'], position: { x: 300, y: 250 } })
  await expect(page.getByText('地図をクリックしてポイントを追加（1 点）')).toBeVisible()

  // Escape 離脱時に window.confirm が出る。dismiss（キャンセル）すると作成モードに留まる
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('未確定のポイントが 1 点あります')
    dialog.dismiss()
  })
  await page.keyboard.press('Escape')
  // まだ作成モードでポイントも保持されている
  await expect(page.getByText('地図をクリックしてポイントを追加（1 点）')).toBeVisible()

  // 今度は accept（破棄OK）→ モードを抜ける
  page.once('dialog', (dialog) => dialog.accept())
  await page.keyboard.press('Escape')
  await expect(page.getByText(/地図をクリックしてポイントを追加/)).toBeHidden()
})
