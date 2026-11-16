// 中心線（ベクトルタイル z14）と、標準地図の画像の道路中心とのズレを測る（詳細設計書 §12 の 1）。
// 線分の中ほどの点（交差点から 25 m 以上離れた所）を、アプリのマップマッチング（analyzePatch）で画像の道路中心へ寄せ、
// 寄せた量（m）を集計する。寄せた量が小さい = 中心線が画像の道路中心に合っている。
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
const REPO = new URL('../../../src/lib/', import.meta.url).href
const { analyzePatch, PATCH_RADIUS } = await import(REPO + 'mapMatch/matcher.ts')
const { classifyPixel } = await import(REPO + 'mapMatch/palette.ts')
const { roadClassOf, roadStructOf } = await import(REPO + 'routing/roadClass.ts')
const { clipLine } = await import(REPO + 'routing/roadTiles.ts')
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const CACHE = new URL('./cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.mkdirSync(CACHE, { recursive: true })
async function get(url: string, file: string): Promise<Buffer | null> {
  if (fs.existsSync(file)) { const b = fs.readFileSync(file); return b.length ? b : null }
  const r = await fetch(url)
  const b = r.ok ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0)
  fs.writeFileSync(file, b)
  return b.length ? b : null
}
const pngCache = new Map<string, any>()
async function stdTile(z: number, x: number, y: number) {
  const k = `${z}/${x}/${y}`
  if (pngCache.has(k)) return pngCache.get(k)
  const b = await get(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`, `${CACHE}std_${z}_${x}_${y}.png`)
  const png = b ? PNG.sync.read(b) : null
  pngCache.set(k, png)
  return png
}
async function patchAt(z: number, cx: number, cy: number) {
  const R = PATCH_RADIUS, size = 2 * R + 1
  const cls = new Uint8Array(size * size)
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const px = cx - R + i, py = cy - R + j
    const t = await stdTile(z, Math.floor(px / 256), Math.floor(py / 256))
    if (!t) return null
    const o = ((py & 255) * 256 + (px & 255)) * 4
    cls[j * size + i] = classifyPixel('gsi-std', t.data[o], t.data[o + 1], t.data[o + 2])
  }
  return { cls, size }
}

const [name, lngS, latS, halfS, nS, seedS] = process.argv.slice(2)
const lat = +latS, lng = +lngS, half = +halfS
const n2 = 2 ** 14
const tx = Math.floor((lng + 180) / 360 * n2), ty = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n2)
type S = { wx: number; wy: number; cls: number; org: string; div: boolean; ux: number; uy: number; seg: number }
const samples: S[] = []
for (let x = tx - half; x <= tx + half; x++) for (let y = ty - half; y <= ty + half; y++) {
  const b = await get(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/14/${x}/${y}.pbf`, `${CACHE}14_${x}_${y}.pbf`)
  if (!b) continue
  const layer = new VectorTile(new Pbf(b)).layers.road
  if (!layer) continue
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    const c = roadClassOf(f.properties)
    if (c < 2 || c > 4 || roadStructOf(f.properties) !== 0) continue // 一般道の通常部（市区町村道〜国道）
    for (const ring of f.loadGeometry()) {
      for (const l of clipLine(ring.flatMap((q: any) => [q.x, q.y]))) {
        // 線分の中ほどで、両端（交差点）から 50 格子（約 25 m）以上離れた点
        let total = 0
        const segs: number[] = []
        for (let k = 2; k < l.length; k += 2) { const d = Math.hypot(l[k] - l[k - 2], l[k + 1] - l[k - 1]); segs.push(d); total += d }
        if (total < 140) continue
        let acc = 0
        const target = total / 2
        for (let k = 0; k < segs.length; k++) {
          if (acc + segs[k] >= target) {
            const f2 = (target - acc) / segs[k]
            samples.push({ wx: x * 4096 + l[2 * k] + (l[2 * k + 2] - l[2 * k]) * f2, wy: y * 4096 + l[2 * k + 1] + (l[2 * k + 3] - l[2 * k + 1]) * f2, cls: c, org: String(f.properties.orgGILvl), div: Number(f.properties.medSect) > 0, ux: (l[2 * k + 2] - l[2 * k]) / segs[k], uy: (l[2 * k + 3] - l[2 * k + 1]) / segs[k], seg: samples.length })
            break
          }
          acc += segs[k]
        }
      }
    }
  }
}
let seed = +seedS
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
for (let i = samples.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [samples[i], samples[j]] = [samples[j], samples[i]] }
const N = +nS
const res: Record<string, number[]> = {}
let none = 0, inter = 0
const big: string[] = []
const worldLL = (wx: number, wy: number) => { const W = 4096 * 2 ** 14; const lng2 = wx / W * 360 - 180; const lat2 = Math.atan(Math.sinh(Math.PI * (1 - 2 * wy / W))) * 180 / Math.PI; return `${lat2.toFixed(6)},${lng2.toFixed(6)}` }
const mpp = (z: number) => 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** z
for (const z of [16, 17]) {
  let used = 0
  for (const s of samples) {
    if (used >= N) break
    const k = 256 * 2 ** (z - 14) / 4096
    const cx = Math.round(s.wx * k), cy = Math.round(s.wy * k)
    const p = await patchAt(z, cx, cy)
    if (!p) continue
    used++
    const o = analyzePatch(p.cls, p.size)
    if (o.kind === 'none') { none++; continue }
    if (o.kind === 'intersection') { inter++; continue }
    const perp = Math.abs(-s.uy * o.dx + s.ux * o.dy) * mpp(z)
    const key = `z${z} org${s.org} ${s.div ? '分離帯あり' : (s.cls === 2 ? '市道' : '県道国道')}`
    ;(res[key] ??= []).push(perp)
    if (perp > 5 && z === 17 && big.length < 6) big.push(`${(perp).toFixed(1)}m cls${s.cls} ${worldLL(s.wx, s.wy)}`)
  }
}
console.log(`${name}: samples ${samples.length}, none ${none}, intersection ${inter}`)
for (const [k, v] of Object.entries(res).sort()) {
  v.sort((a, b) => a - b)
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))].toFixed(2)
  console.log(`  ${k.padEnd(14)} n=${String(v.length).padStart(3)}  median ${q(0.5)} m  p90 ${q(0.9)} m  p99 ${q(0.99)} m  >2m ${v.filter((x) => x > 2).length}  >5m ${v.filter((x) => x > 5).length}`)
}
console.log('  examples >5 m (z17):', big.join(' | '))
