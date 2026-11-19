/**
 * 現在地へ移動（designs/機能追加・UI改善設計書.md E1）。
 */
import { test, expect, setup } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('許可されていれば、現在地へ移動し、マーカーと精度の円を出す', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 35.0116, longitude: 135.7681, accuracy: 30 }) // 京都市役所のあたり
  await page.getByRole('button', { name: '現在地へ移動' }).click()

  await expect.poll(async () => page.evaluate(async () => {
    const ms = await import('/src/stores/mapStore.ts')
    const c = ms.useMapStore.getState().mapInstance!.getCenter()
    return Math.abs(c.lat - 35.0116) < 0.01 && Math.abs(c.lng - 135.7681) < 0.01
  })).toBe(true)
  // 精度の円（path）とマーカー（path）
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(2)
  // 作成モードでなくても、地図のクリックとして扱われない（ボタンの上のクリックは地図に伝わらない）
})

test('作成モードでボタンを押しても、通過点は増えない', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 35.6812, longitude: 139.7671 })
  await page.getByRole('button', { name: '作成', exact: true }).click()
  await page.getByRole('button', { name: '現在地へ移動' }).click()
  await expect(page.getByText('地図をクリックしてポイントを追加（0 点）')).toBeVisible()
})

test('許可されていなければ、トーストで知らせる', async ({ page }) => {
  await page.getByRole('button', { name: '現在地へ移動' }).click()
  await expect(page.getByText('位置情報の利用が許可されていません')).toBeVisible()
})
