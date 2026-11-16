import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Pbf from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CACHE = path.join(HERE, 'cache')
fs.mkdirSync(CACHE, { recursive: true })
export const EXTENT = 4096

export function lngLatToTile(lng, lat, z) {
  const n = 2 ** z
  const x = ((lng + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  return { x, y }
}
export function worldToLngLat(wx, wy, z) {
  const n = 2 ** z * EXTENT
  const lng = (wx / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / n))) * 180) / Math.PI
  return { lng, lat }
}
export function haversine(a, b) {
  const R = 6371008.8, t = Math.PI / 180
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export async function fetchTile(z, x, y) {
  const f = path.join(CACHE, `${z}_${x}_${y}.pbf`)
  if (fs.existsSync(f)) return fs.readFileSync(f)
  const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`)
  if (res.status === 404) { fs.writeFileSync(f, Buffer.alloc(0)); return Buffer.alloc(0) }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${z}/${x}/${y}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(f, buf)
  return buf
}

/** road レイヤーの線を、世界座標（整数格子）の折れ線の配列にする */
export async function loadRoadLines(z, x, y) {
  const buf = await fetchTile(z, x, y)
  if (buf.length === 0) return { lines: [], bytes: 0 }
  const vt = new VectorTile(new Pbf(buf))
  const layer = vt.layers.road
  const lines = []
  if (!layer) return { lines, bytes: buf.length }
  const k = EXTENT / layer.extent
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    if (f.type !== 2) continue
    const p = f.properties
    for (const ring of f.loadGeometry()) {
      lines.push({
        props: p, tx: x, ty: y,
        local: ring.map((q) => [q.x * k, q.y * k]),
        pts: ring.map((q) => [x * EXTENT + q.x * k, y * EXTENT + q.y * k]),
      })
    }
  }
  return { lines, bytes: buf.length }
}

export async function loadBlock(z, x0, y0, x1, y1, conc = 6) {
  const jobs = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y])
  const out = []
  let bytes = 0
  let i = 0
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < jobs.length) {
      const [x, y] = jobs[i++]
      const r = await loadRoadLines(z, x, y)
      bytes += r.bytes
      out.push(...r.lines)
    }
  }))
  return { lines: out, bytes, tiles: jobs.length }
}

export function count(arr, fn) {
  const m = new Map()
  for (const a of arr) { const k = fn(a); m.set(k, (m.get(k) || 0) + 1) }
  return Object.fromEntries([...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true })))
}
