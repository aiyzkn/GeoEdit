/**
 * タイムラインのスクロール性能（designs/機能追加・UI改善設計書.md E3）。
 *
 * 計り方: 本物のホイールのイベント（横方向）を一定の間隔で送り、そのあいだの requestAnimationFrame の
 * 間隔から fps の中央値と下位 5 %（遅いほうから 5 % の位置のフレームの fps）を出す。
 * 以前の計り方（scrollLeft を rAF ごとに書き換える）は、実際のスクロールと負荷が違うおそれがあった。
 *
 * 完了の条件: 10,000 点の中央値が 55 fps 以上（設計書）。中央値だけだと、ときどき長く止まるのが見えないので、
 * 平均（フレーム数 ÷ 時間）と下位 5 % も出す。
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function makeGpx(n: number): string {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
  const pts: string[] = []
  for (let i = 0; i < n; i++) {
    const lat = 35.6 + i * 0.00002
    const lng = 139.7 + Math.sin(i / 50) * 0.001 + i * 0.00001
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${(10 + Math.sin(i / 30) * 5).toFixed(1)}</ele><time>${new Date(t0 + i * 1000).toISOString()}</time></trkpt>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="perf" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>perf</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

async function measure(page: Page, n: number) {
  const file = path.join(os.tmpdir(), `geoedit-perf-${n}.gpx`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, makeGpx(n))

  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '開く', exact: true }).click()
  await (await chooser).setFiles(file)
  await expect(page.getByText(`${n.toLocaleString('en-US')} pts`).or(page.getByText(`${n} pts`)).first()).toBeVisible({ timeout: 60_000 })

  // タイムラインの横スクロールの入れ物の上にマウスを置く
  const scroller = page.locator('.overflow-x-auto.overflow-y-hidden').first()
  const box = (await scroller.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(500)

  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean }
    w.__frames = []
    w.__stop = false
    let last = performance.now()
    const tick = (now: number) => {
      w.__frames.push(now - last)
      last = now
      if (!w.__stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  // 約 3 秒、16 ms ごとに横へ 120 px のホイール
  const end = Date.now() + 3000
  while (Date.now() < end) {
    await page.mouse.wheel(120, 0)
    await page.waitForTimeout(16)
  }
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean }
    w.__stop = true
    return w.__frames.slice(5) // 最初の数フレームは捨てる
  })
  const sorted = [...frames].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const scrolled = await scroller.evaluate((el) => el.scrollLeft)
  const total = frames.reduce((a, b) => a + b, 0)
  const result = {
    points: n, frames: frames.length,
    medianFps: +(1000 / median).toFixed(1),
    meanFps: +((frames.length * 1000) / total).toFixed(1),
    low5Fps: +(1000 / p95).toFixed(1),
    scrolledPx: scrolled,
  }
  console.log(JSON.stringify(result))
  expect(scrolled).toBeGreaterThan(1000) // 本当にスクロールした
  return result
}

test('タイムライン 10,000 点: 中央値 55 fps 以上', async ({ page }) => {
  const r = await measure(page, 10_000)
  expect(r.medianFps).toBeGreaterThanOrEqual(55)
})

test('タイムライン 50,000 点（参考。合否は付けない）', async ({ page }) => {
  await measure(page, 50_000)
})
