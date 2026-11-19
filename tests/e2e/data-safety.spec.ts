/**
 * 確認ダイアログ・自動保存と復元・保存していない変更（designs/機能追加・UI改善設計書.md C1〜C3）。
 * IndexedDB はテストごとの新しいブラウザコンテキストで空から始まる。
 */
import { test, expect, setup, openFilesViaButton, selectMode } from './helpers'

test('確認ダイアログ: 「確定して移動」で作成中のルートを確定してから、選んだモードへ移る', async ({ page }) => {
  await setup(page)
  await selectMode(page, '作成')
  await page.getByRole('checkbox', { name: '標高を自動取得' }).uncheck()
  const map = page.locator('.leaflet-container')
  await map.click({ modifiers: ['Control'], position: { x: 300, y: 150 } })
  await map.click({ modifiers: ['Control'], position: { x: 450, y: 250 } })
  await expect(page.getByText('地図をクリックしてポイントを追加（2 点）')).toBeVisible()
  await selectMode(page, '選択')
  await page.getByRole('dialog').getByRole('button', { name: '確定して移動' }).click()
  await expect(page.getByText(/ルートを作成しました（2 ポイント）/)).toBeVisible()
  await expect(page.getByText('1 ルート', { exact: true })).toBeVisible()
  await expect(page.getByText(/地図をクリックしてポイントを追加/)).toBeHidden()
})

test('自動保存: 再読み込みすると復元の帯が出て、「復元」でルートが戻る', async ({ page }) => {
  await setup(page)
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  // 1 秒後に保存される
  await page.waitForTimeout(1500)
  await page.reload()
  const banner = page.getByRole('status').filter({ hasText: '前回の編集内容があります' })
  await expect(banner).toContainText('1 ルート')
  // 自動では復元しない
  await expect(page.getByText('5 pts · 1 trk')).toBeHidden()
  await banner.getByRole('button', { name: '復元' }).click()
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await expect(banner).toBeHidden()
})

test('自動保存: 「破棄」で記録を消すと、次の再読み込みでは帯が出ない', async ({ page }) => {
  await setup(page)
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.reload()
  await page.getByRole('status').filter({ hasText: '前回の編集内容があります' }).getByRole('button', { name: '破棄' }).click()
  await page.reload()
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByText('前回の編集内容があります')).toBeHidden()
})

test('保存していない変更: 読み込んだ直後は印なし、編集すると「●」が付く', async ({ page }) => {
  await setup(page)
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  const mark = page.getByLabel('保存していない変更があります')
  await expect(mark).toHaveCount(0)
  await selectMode(page, '逆ルート')
  await page.getByRole('button', { name: '逆ルートにする' }).click()
  await expect(mark).toHaveCount(1)
})

test('離脱時の警告: 保存していない変更があると、ページを閉じる前に確認が出る', async ({ page }) => {
  await setup(page)
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await selectMode(page, '逆ルート')
  await page.getByRole('button', { name: '逆ルートにする' }).click()
  // beforeunload の確認は、利用者がページを操作したあとでないと出ない（ブラウザの決まり）
  await page.locator('.leaflet-container').click({ position: { x: 50, y: 50 } })
  const dialogPromise = page.waitForEvent('dialog')
  void page.close({ runBeforeUnload: true })
  const dialog = await dialogPromise
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
})
