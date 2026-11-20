/**
 * 既存の軌跡を道に合わせる（designs/トラックのマップマッチング設計書.md §8）。
 * 道路タイルは保存した実タイルを返す（route-draft-apply.spec.ts と同じ）。
 * 道の選び方の正しさは単体（tests/match*.test.ts）で確かめるので、ここでは
 * 「ボタン → 下書き → 確定 → 取り消し」の導線がつながっていることだけを見る。
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
  await selectMode(page, '道なり補正')
}

test('道に合わせる: トラック全体を下書きにし、確定すると線が置き換わる。取り消すと元に戻る', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'トラック全体を道に合わせる' }).click()
  await expect(page.getByText(/道に合わせました（観測 \d+ 点のうち \d+ 点/)).toBeVisible({ timeout: 30_000 })
  // 確定するまで元のトラックは変わらない
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await expect(page.getByRole('button', { name: '確定' })).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('button', { name: '確定' }).click()
  await expect(page.getByText(/道に合わせて確定しました（\d+ ポイント。時刻・標高・ウェイポイントは元の点から移しました）/)).toBeVisible()
  await expect(page.getByText(/^\d+ pts · 1 trk$/)).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
})

test('道に合わせる: 選んだ区間を下書きにし、キャンセルするとルートは変わらない', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: '道に合わせる', exact: true })).toBeDisabled()
  await selectTimelinePoint(page, 1)
  await selectTimelinePoint(page, 3)
  await page.getByRole('button', { name: '道に合わせる', exact: true }).click()
  await expect(page.getByText(/道に合わせました（観測 \d+ 点のうち \d+ 点/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'キャンセル' }).click()
  await expect(page.getByRole('button', { name: 'トラック全体を道に合わせる' })).toBeVisible()
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
})
