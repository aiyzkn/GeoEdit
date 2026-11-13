/**
 * Undo / Redo のテスト（ヘッダーボタン + キーボードショートカット）。
 *
 * 状態復元は「ルート一覧の点数表記」で観測する。間引き（5点→2点）を基準操作にし、
 * Undo で 5点へ戻り、Redo で 2点へ戻ることを確認する。
 */
import { test, expect, setup, openFilesViaButton, selectMode } from './helpers'

/** 間引きで 5点 → 2点 にする基準操作。 */
async function thinOutTo2(page: import('@playwright/test').Page) {
  await selectMode(page, '間引き')
  await page.getByRole('spinbutton').fill('1000')
  await page.getByRole('button', { name: '間引き実行' }).click()
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('初期状態ではUndo/Redoボタンが無効', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  // 読み込み直後は編集履歴が無いので両方 disabled
  await expect(page.getByRole('button', { name: /元に戻す/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /やり直し/ })).toBeDisabled()
})

test('ヘッダーボタンでUndo・Redoできる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await thinOutTo2(page)

  // Undo → 5点に戻る
  await page.getByRole('button', { name: /元に戻す/ }).click()
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // Redo → 2点に戻る
  await page.getByRole('button', { name: /やり直し/ }).click()
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()
})

test('キーボードショートカット（Ctrl+Z / Ctrl+Y）でUndo・Redoできる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await thinOutTo2(page)

  await page.keyboard.press('Control+z')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await page.keyboard.press('Control+y')
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()
})

test('Ctrl+Shift+Z でもRedoできる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await thinOutTo2(page)
  await page.keyboard.press('Control+z')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()
})
