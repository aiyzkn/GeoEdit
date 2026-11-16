// 最適な経路が、始点–終点の線分からどれだけ横に離れるか（回廊の幅を決める）
import { loadBlock, lngLatToTile, haversine, worldToLngLat } from './lib.mjs'
import { buildGraph, components } from './graph.mjs'
import { search, nodeLL } from './search.mjs'
const [name, lng, lat, half, nArg, seedArg] = process.argv.slice(2)
const z = 14, t = lngLatToTile(+lng, +lat, z), cx = Math.floor(t.x), cy = Math.floor(t.y), h = +half
const { lines } = await loadBlock(z, cx - h, cy - h, cx + h, cy + h)
const g = buildGraph(lines, z, { tol: 1 }); g.ll = []
const { comp, sizes } = components(g); const big = sizes.indexOf(Math.max(...sizes))
// 外周の影響を避けるため、中央の (2h-1)/ (2h+1) の範囲から選ぶ
const E = 4096, X0 = (cx - h + 1.5) * E, X1 = (cx + h - 0.5) * E, Y0 = (cy - h + 1.5) * E, Y1 = (cy + h - 0.5) * E
const cand = []; g.nodes.forEach((p, n) => { if (comp[n] === big && p[0] > X0 && p[0] < X1 && p[1] > Y0 && p[1] < Y1) cand.push(n) })
let seed = +(seedArg ?? 1); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const mPer = haversine(worldToLngLat(cx * E, cy * E, z), worldToLngLat(cx * E + 1000, cy * E, z)) / 1000
const rows = []
let n = 0
while (n < +nArg) {
  const a = cand[Math.floor(rnd() * cand.length)], b = cand[Math.floor(rnd() * cand.length)]
  const pa = g.nodes[a], pb = g.nodes[b]; const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * mPer
  if (d < 1000) continue
  n++
  const r = search(g, a, b, { mode: 'rim', freeRadius: 0, floor: 2 })
  let dev = 0
  for (const ei of r.edges) for (const p of g.edges[ei].pts) { const dx = pb[0] - pa[0], dy = pb[1] - pa[1]; let tt = ((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dy) / (dx * dx + dy * dy); tt = Math.max(0, Math.min(1, tt)); dev = Math.max(dev, Math.hypot(p[0] - pa[0] - tt * dx, p[1] - pa[1] - tt * dy) * mPer) }
  rows.push({ d, dev, ratio: dev / d, detour: r.dist / d })
}
const q = (arr, p) => arr.slice().sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(arr.length * p))]
for (const [lo, hi] of [[1000, 2500], [2500, 5000], [5000, 20000]]) {
  const rs = rows.filter((r) => r.d >= lo && r.d < hi); if (!rs.length) continue
  console.log(`${name} d ${lo}-${hi} n=${rs.length}: dev(m) p50 ${q(rs.map((r) => r.dev), 0.5).toFixed(0)} p90 ${q(rs.map((r) => r.dev), 0.9).toFixed(0)} max ${q(rs.map((r) => r.dev), 1).toFixed(0)} | dev/d p50 ${q(rs.map((r) => r.ratio), 0.5).toFixed(2)} p90 ${q(rs.map((r) => r.ratio), 0.9).toFixed(2)} max ${q(rs.map((r) => r.ratio), 1).toFixed(2)} | detour p50 ${q(rs.map((r) => r.detour), 0.5).toFixed(2)} p90 ${q(rs.map((r) => r.detour), 0.9).toFixed(2)}`)
}
