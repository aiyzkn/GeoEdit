/**
 * 作成モードの経路探索（designs/経路探索詳細設計書.md §9.2）。
 *
 * 道路タイルは serveRoadTiles() で保存した実タイルに差し替える。
 * 途中の状態は、区間の線の色（SVG の stroke）で見る:
 *   実線の青 #2563eb = 経路探索で結んだ / 薄い青 #93c5fd = 探索中 / 橙 #f59e0b = 探索できず直線
 * 線の点の数は地図からは読みにくいので、確定後のトーストの「N ポイント」で確かめる。
 */
import type { Page } from '@playwright/test'
import { test, expect, mockExternalNetwork, selectMode, serveLeafletCss, serveRoadTiles, zoomIn } from './helpers'

const ROUTED = 'path[stroke="#2563eb"]:not([stroke-dasharray])'
const FALLBACK = 'path[stroke="#f59e0b"]'
const ANY_LEG = 'path[stroke="#2563eb"], path[stroke="#93c5fd"], path[stroke="#f59e0b"]'

/** 標準の setup と同じだが、Leaflet の CSS を返し、必要なら道路タイルも返してから開く */
async function open(page: Page, roads: boolean) {
  await mockExternalNetwork(page)
  await serveLeafletCss(page)
  if (roads) await serveRoadTiles(page)
  await page.goto('/')
  await expect(page.locator('.leaflet-container')).toBeVisible()
}

async function startCreate(page: Page) {
  await zoomIn(page, 6) // z10 → z16（クリック 2 点の間を数百 m にする）
  await selectMode(page, '作成')
  await page.getByRole('checkbox', { name: '標高を自動取得' }).uncheck()
  await expect(page.getByRole('checkbox', { name: '経路探索' })).toBeChecked()
}

async function createdPointCount(page: Page): Promise<number> {
  await page.getByRole('button', { name: '確定' }).click()
  const toast = page.getByText(/ルートを作成しました（\d+ ポイント）/)
  await expect(toast).toBeVisible()
  const m = (await toast.textContent())!.match(/（(\d+) ポイント）/)
  return Number(m![1])
}

test.describe('道路タイルあり', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, true)
  })

  test('クリック 2 回で、道なりの経路が引かれる', async ({ page }) => {
    await startCreate(page)
    const map = page.locator('.leaflet-container')
    await map.click({ position: { x: 300, y: 120 } })
    await map.click({ position: { x: 520, y: 230 } })
    await expect(page.getByText('地図をクリックしてポイントを追加（2 点）')).toBeVisible()
    await expect(page.locator(ROUTED)).toHaveCount(1)
    await expect(page.getByText(/^\d+\.\d\d km$/)).toBeVisible()
    expect(await createdPointCount(page)).toBeGreaterThan(2)
  })

  test('Ctrl + クリックの区間は直線（2 点）', async ({ page }) => {
    await startCreate(page)
    const map = page.locator('.leaflet-container')
    await map.click({ modifiers: ['Control'], position: { x: 300, y: 120 } })
    await map.click({ modifiers: ['Control'], position: { x: 520, y: 230 } })
    await expect(page.getByText('地図をクリックしてポイントを追加（2 点）')).toBeVisible()
    expect(await createdPointCount(page)).toBe(2)
  })

  test('Ctrl+Z で通過点の追加を取り消し、Ctrl+Y でやり直せる', async ({ page }) => {
    await startCreate(page)
    const map = page.locator('.leaflet-container')
    await map.click({ position: { x: 300, y: 120 } })
    await map.click({ position: { x: 520, y: 230 } })
    await expect(page.locator(ROUTED)).toHaveCount(1)
    await page.keyboard.press('Control+z')
    await expect(page.getByText('地図をクリックしてポイントを追加（1 点）')).toBeVisible()
    await expect(page.locator(ANY_LEG)).toHaveCount(0)
    await page.keyboard.press('Control+y')
    await expect(page.getByText('地図をクリックしてポイントを追加（2 点）')).toBeVisible()
    await expect(page.locator(ROUTED)).toHaveCount(1)
  })

  test('通過点をドラッグすると、前後の区間が引き直される', async ({ page }) => {
    await startCreate(page)
    const map = page.locator('.leaflet-container')
    await map.click({ position: { x: 300, y: 120 } })
    await map.click({ position: { x: 520, y: 230 } })
    await expect(page.locator(ROUTED)).toHaveCount(1)
    const before = await page.locator(ROUTED).getAttribute('d')
    // 2 点目のマーカー（末尾は大きい 14px の丸）をドラッグする
    const marker = page.locator('.leaflet-marker-icon').last()
    const box = (await marker.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y - 120, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByText('地図をクリックしてポイントを追加（2 点）')).toBeVisible()
    await expect(page.locator(ROUTED)).toHaveCount(1)
    await expect.poll(async () => page.locator(ROUTED).getAttribute('d')).not.toBe(before)
  })

  test('設定を「最短」にすると、再読み込みしても残る。「既定に戻す」で標準に戻る', async ({ page }) => {
    await zoomIn(page, 1)
    await selectMode(page, '作成')
    await page.getByRole('button', { name: '経路探索の設定' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /最短/ }).check()
    await dialog.getByRole('button', { name: '閉じる' }).click()
    await page.reload()
    await selectMode(page, '作成')
    await page.getByRole('button', { name: '経路探索の設定' }).click()
    await expect(page.getByRole('dialog').getByRole('radio', { name: /最短/ })).toBeChecked()
    await page.getByRole('dialog').getByRole('button', { name: '既定に戻す' }).click()
    await expect(page.getByRole('dialog').getByRole('radio', { name: /標準/ })).toBeChecked()
  })
})

test.describe('道路タイルなし', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, false) // 道路タイルは 404
  })

  test('道路が無ければ、橙の点線とトーストで知らせる', async ({ page }) => {
    await startCreate(page)
    const map = page.locator('.leaflet-container')
    await map.click({ position: { x: 300, y: 120 } })
    await map.click({ position: { x: 520, y: 230 } })
    await expect(page.locator(FALLBACK)).toHaveCount(1)
    await expect(page.getByText('近くに道路が無いため、直線で結びました')).toBeVisible()
    expect(await createdPointCount(page)).toBe(2)
  })

  test('経路探索を OFF にすると、いまの作成モードと同じ（直線）', async ({ page }) => {
    await startCreate(page)
    await page.getByRole('checkbox', { name: '経路探索' }).uncheck()
    const map = page.locator('.leaflet-container')
    await map.click({ modifiers: ['Control'], position: { x: 300, y: 120 } })
    await map.click({ modifiers: ['Control'], position: { x: 520, y: 230 } })
    await expect(page.locator(FALLBACK)).toHaveCount(0)
    expect(await createdPointCount(page)).toBe(2)
    // 設定はブラウザに残るので戻しておく（ほかのテストは別のブラウザコンテキストなので影響しないが念のため）
  })
})
