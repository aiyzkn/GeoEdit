// 分離帯のある道路で、車線に合わせる前（赤）と後（青）の線を、z18 の標準地図に重ねて PNG に書き出す（詳細設計書 §13）
// 使い方: node lane-check.ts 緯度1 経度1 緯度2 経度2 出力.png [画像の幅]
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const SRC = new URL('../../../src/lib/routing/', import.meta.url).href
const { Router } = await import(SRC + 'index.ts')
const { resolveRoutingOptions, DEFAULT_ROUTING_SETTINGS } = await import(SRC + 'settings.ts')
const CACHE = new URL('./cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.mkdirSync(CACHE, { recursive: true })
async function get(url: string, f: string): Promise<Buffer | null> {
  if (fs.existsSync(f)) { const b = fs.readFileSync(f); return b.length ? b : null }
  const r = await fetch(url); const b = r.ok ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0)
  fs.writeFileSync(f, b); return b.length ? b : null
}
const raster = async (z: number, x: number, y: number) => {
  const b = await get(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`, `${CACHE}std_${z}_${x}_${y}.png`)
  if (!b) return null
  const p = PNG.sync.read(b); return { width: p.width, height: p.height, data: p.data }
}
const vec = (z: number) => async (x: number, y: number) => { const b = await get(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`, `${CACHE}${z}_${x}_${y}.pbf`); return b ? new Uint8Array(b).buffer : null }
const [la1, ln1, la2, ln2, out, sizeS] = process.argv.slice(2)
const A = { lat: +la1, lng: +ln1 }, B = { lat: +la2, lng: +ln2 }
const router = new Router(vec(14), { coarseLoader: vec(12), raster })
const on = resolveRoutingOptions({ ...DEFAULT_ROUTING_SETTINGS, laneMatch: true })
const off = resolveRoutingOptions({ ...DEFAULT_ROUTING_SETTINGS, laneMatch: false })
const r0 = await router.routeLeg(A, B, off), r1 = await router.routeLeg(A, B, on), r2 = await router.routeLeg(B, A, on)
const latAt = (pts: { lat: number; lng: number }[], lng: number) => { for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if ((a.lng - lng) * (b.lng - lng) <= 0 && a.lng !== b.lng) return a.lat + (b.lat - a.lat) * (lng - a.lng) / (b.lng - a.lng) } return NaN }
if (process.env.PROFILE) for (let k = 1; k < 10; k++) { const lng = A.lng + (B.lng - A.lng) * k / 10; const base = latAt(r0.points, lng); console.log(`lng ${lng.toFixed(5)}  A→B ${((latAt(r1.points, lng) - base) * 111000).toFixed(1)} m  B→A ${((latAt(r2.points, lng) - base) * 111000).toFixed(1)} m (+ = 北)`) }
console.log(`off ${r0.points.length} pts ${r0.distance.toFixed(0)} m / on A→B ${r1.points.length} pts / on B→A ${r2.points.length} pts`)
const z = 18, Wd = 256 * 2 ** z
const toPx = (p: { lat: number; lng: number }) => [(p.lng + 180) / 360 * Wd, (1 - Math.log(Math.tan(p.lat * Math.PI / 180) + 1 / Math.cos(p.lat * Math.PI / 180)) / Math.PI) / 2 * Wd]
const all = [...r0.points, ...r1.points].map(toPx)
const S = +(sizeS ?? 512)
const cx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2, cy = (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2
const x0 = Math.round(cx - S / 2), y0 = Math.round(cy - S / 2)
const img = new PNG({ width: S, height: S })
for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + S) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + S) / 256); tx++) {
  const t = await raster(z, tx, ty); if (!t) continue
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const X = tx * 256 + i - x0, Y = ty * 256 + j - y0; if (X < 0 || Y < 0 || X >= S || Y >= S) continue; const o = (j * 256 + i) * 4, d = (Y * S + X) * 4; for (let c = 0; c < 4; c++) img.data[d + c] = t.data[o + c] }
}
const draw = (pts: { lat: number; lng: number }[], rgb: number[]) => {
  for (let q = 1; q < pts.length; q++) {
    const [ax, ay] = toPx(pts[q - 1]), [bx, by] = toPx(pts[q]); const n = Math.ceil(Math.hypot(bx - ax, by - ay)) + 1
    for (let s = 0; s <= n; s++) { const X = Math.round(ax + (bx - ax) * s / n) - x0, Y = Math.round(ay + (by - ay) * s / n) - y0; if (X < 0 || Y < 0 || X >= S || Y >= S) continue; const d = (Y * S + X) * 4; img.data[d] = rgb[0]; img.data[d + 1] = rgb[1]; img.data[d + 2] = rgb[2]; img.data[d + 3] = 255 }
  }
}
draw(r0.points, [255, 0, 0]); draw(r1.points, [0, 90, 255]); draw(r2.points, [0, 170, 0])
fs.writeFileSync(out, PNG.sync.write(img))
