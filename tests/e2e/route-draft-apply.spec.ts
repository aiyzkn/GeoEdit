/**
 * 既存ルートの道なり補正と、ルートへの追記（designs/機能追加・UI改善設計書.md B0〜B2）。
 * 道路タイルは保存した実タイルを返す（create-route-routing.spec.ts と同じ）。
 */
import type { Page } from '@playwright/test'
import { test, expect, mockExternalNetwork, openFilesViaButton, selectMode, selectTimelinePoint, serveLeafletCss, serveRoadTiles } from './helpers'

async function open(page: Page) {
  await mockExternalNetwork(page)
  await serveLeafletCss(page)
  await serveRoadTiles(page)
  await page.goto('/')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
}

test('道なり補正: 2 点を選んで引き直し、確定すると間の点が置き換わる。両端の点は残る', async ({ page }) => {
  await open(page)
  await selectMode(page, '道なり補正')
  await expect(page.getByRole('button', { name: '引き直す' })).toBeDisabled()
  await selectTimelinePoint(page, 1)
  await selectTimelinePoint(page, 3)
  await page.getByRole('button', { name: '引き直す' }).click()
  await expect(page.getByText('道なり補正:')).toBeVisible()
  await expect(page.getByRole('button', { name: '確定' })).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('button', { name: '確定' }).click()
  await expect(page.getByText(/道なりに引き直しました（\d+ ポイント）/)).toBeVisible()
  // 間の 1 点（#2）が、引き直した点に置き換わる。両端（#1・#3）と外側（#0・#4）は残る
  await expect(page.getByText(/^\d+ pts · 1 trk$/)).toBeVisible()
  // 取り消すと元の 5 点に戻る
  await page.keyboard.press('Control+z')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
})

test('道なり補正: キャンセルすると、ルートは変わらない', async ({ page }) => {
  await open(page)
  await selectMode(page, '道なり補正')
  await selectTimelinePoint(page, 0)
  await selectTimelinePoint(page, 4)
  await page.getByRole('button', { name: '引き直す' }).click()
  await page.getByRole('button', { name: 'キャンセル' }).click()
  await expect(page.getByRole('button', { name: '引き直す' })).toBeVisible()
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
})

test('追記: 末尾から続きを描き、確定するとルートの点が増える', async ({ page }) => {
  await open(page)
  await selectMode(page, '作成')
  const target = page.getByRole('combobox', { name: '作成先' })
  await target.selectOption('append-tail')
  await expect(page.getByText('ルートに追記:')).toBeVisible()
  // ルート名・日時の欄は出ない
  await expect(page.getByPlaceholder('ルート名')).toBeHidden()
  await page.locator('.leaflet-container').click({ modifiers: ['Control'], position: { x: 200, y: 150 } })
  await expect(target).toBeDisabled() // 通過点を置いたあとは変えられない
  await page.getByRole('button', { name: '確定' }).click()
  await expect(page.getByText(/ルートに追記しました（1 ポイント）/)).toBeVisible()
  await expect(page.getByText('6 pts · 1 trk')).toBeVisible()
  await expect(page.getByText('1 ルート', { exact: true })).toBeVisible()
})
