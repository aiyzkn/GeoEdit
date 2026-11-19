/**
 * 右側のパネル・下側のタイムラインを完全に折りたたみ、地図を画面いっぱいに広げる。
 * 状態はブラウザに残る（再読み込みしても折りたたんだまま）。
 */
import { test, expect, setup, openFilesViaButton } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('右側のパネルとタイムラインを折りたたむと、地図がその分広がる。再読み込みしても残り、ヘッダーのボタンで戻る', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  const map = page.locator('.leaflet-container')
  const before = (await map.boundingBox())!
  const viewport = page.viewportSize()!

  // パネルの中のボタンで折りたたむ
  await page.locator('[aria-label="右側のパネルを折りたたむ"]').last().click()
  await page.getByRole('button', { name: 'タイムラインを折りたたむ' }).last().click()

  await expect(page.getByText('タイムライン', { exact: true })).toBeHidden()
  await expect(page.getByText('5 pts · 1 trk')).toBeHidden()
  await expect(page.getByRole('separator')).toHaveCount(0)

  // 地図が横は画面の幅いっぱい、縦は画面の下端まで
  await expect.poll(async () => (await map.boundingBox())!.width).toBeGreaterThan(viewport.width - 2)
  const after = (await map.boundingBox())!
  expect(after.y + after.height).toBeGreaterThan(viewport.height - 2)
  expect(after.height).toBeGreaterThan(before.height + 150)

  // 広がった部分にもタイルの入れ物が届いている（Leaflet が大きさの変化を知っている）
  const size = await page.evaluate(async () => {
    const ms = await import('/src/stores/mapStore.ts')
    const m = ms.useMapStore.getState().mapInstance!
    return m.getSize()
  })
  expect(size.x).toBeGreaterThan(viewport.width - 2)

  // 再読み込みしても折りたたんだまま
  await page.reload()
  await expect(page.getByRole('button', { name: '右側のパネルを開く' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'タイムラインを開く' })).toBeVisible()
  await expect(page.getByRole('separator')).toHaveCount(0)

  // ヘッダーのボタンで戻る
  await page.getByRole('button', { name: '右側のパネルを開く' }).click()
  await page.getByRole('button', { name: 'タイムラインを開く' }).click()
  await expect(page.getByText('タイムライン', { exact: true })).toBeVisible()
  await expect(page.getByRole('separator')).toHaveCount(2)
  await expect.poll(async () => (await map.boundingBox())!.width).toBeLessThan(viewport.width - 100)
})

test('右側のパネルを折りたたんでいても、「ポイント情報」に入ると開く', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await page.getByRole('button', { name: '右側のパネルを折りたたむ' }).first().click()
  await expect(page.getByText('5 pts · 1 trk')).toBeHidden()
  await page.getByRole('button', { name: 'ポイント情報', exact: true }).click()
  await expect(page.getByRole('button', { name: '属性', exact: true })).toBeVisible()
})
