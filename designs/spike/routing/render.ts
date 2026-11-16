import fs from 'node:fs'
import { createRequire } from 'node:module'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const CACHE = new URL('./cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.mkdirSync(CACHE, { recursive: true })
const [latS, lngS, out] = process.argv.slice(2)
const lat = +latS, lng = +lngS, z = 17
const W = 256 * 2 ** z
const px = (lng + 180) / 360 * W, py = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * W
const S = 200, x0 = Math.round(px - S / 2), y0 = Math.round(py - S / 2)
const img = new PNG({ width: S, height: S })
const get = async (url: string, f: string) => { if (fs.existsSync(f)) return fs.readFileSync(f); const r = await fetch(url); const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f, b); return b }
for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + S) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + S) / 256); tx++) {
  const t = PNG.sync.read(await get(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${tx}/${ty}.png`, `${CACHE}std_${z}_${tx}_${ty}.png`))
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const X = tx * 256 + i - x0, Y = ty * 256 + j - y0; if (X < 0 || Y < 0 || X >= S || Y >= S) continue; const o = (j * 256 + i) * 4, d = (Y * S + X) * 4; for (let c = 0; c < 4; c++) img.data[d + c] = t.data[o + c] }
}
const k = 2 ** (z - 14) * 256 / 4096
const t14x = Math.floor(px / 256 / 8), t14y = Math.floor(py / 256 / 8)
for (let x = t14x - 1; x <= t14x + 1; x++) for (let y = t14y - 1; y <= t14y + 1; y++) {
  const b = await get(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/14/${x}/${y}.pbf`, `${CACHE}14_${x}_${y}.pbf`)
  if (!b.length) continue
  const layer = new VectorTile(new Pbf(b)).layers.road
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i); const ft = f.properties.ftCode as number
    if (ft < 2700 || ft > 2799) continue
    for (const ring of f.loadGeometry()) for (let q = 1; q < ring.length; q++) {
      const ax = (x * 4096 + ring[q - 1].x) * k - x0, ay = (y * 4096 + ring[q - 1].y) * k - y0, bx = (x * 4096 + ring[q].x) * k - x0, by = (y * 4096 + ring[q].y) * k - y0
      const n = Math.ceil(Math.hypot(bx - ax, by - ay)) + 1
      for (let s = 0; s <= n; s++) { const X = Math.round(ax + (bx - ax) * s / n), Y = Math.round(ay + (by - ay) * s / n); if (X < 0 || Y < 0 || X >= S || Y >= S) continue; const d = (Y * S + X) * 4; img.data[d] = 255; img.data[d + 1] = 0; img.data[d + 2] = 0; img.data[d + 3] = 255 }
    }
  }
}
const d = ((S / 2) * S + S / 2) * 4
for (let a = -3; a <= 3; a++) for (const [X, Y] of [[S / 2 + a, S / 2], [S / 2, S / 2 + a]]) { const o = (Y * S + X) * 4; img.data[o] = 0; img.data[o + 1] = 160; img.data[o + 2] = 0; img.data[o + 3] = 255 }
fs.writeFileSync(out, PNG.sync.write(img))
