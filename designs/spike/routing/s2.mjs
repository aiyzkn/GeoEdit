// 検証 2・5: タイルで切ってから縫い合わせる方式、連結成分、端点を共有しない交差（立体交差）
import { loadBlock, lngLatToTile, count, EXTENT } from './lib.mjs'
import { buildGraph, components } from './graph.mjs'

const [name, lng, lat, half] = process.argv.slice(2)
const z = 14
const t = lngLatToTile(+lng, +lat, z)
const cx = Math.floor(t.x), cy = Math.floor(t.y), h = +half
const { lines } = await loadBlock(z, cx - h, cy - h, cx + h, cy + h)
for (const tol of [0, 1, 2, 4]) {
  const t0 = performance.now()
  const g = buildGraph(lines, z, { tol })
  const ms = performance.now() - t0
  const { sizes } = components(g)
  sizes.sort((a, b) => b - a)
  // ブロックの外周を除いた「相手のいない境界の端点」
  console.log(`${name} tol=${tol}: nodes ${g.nodes.length} edges ${g.edges.length} build ${ms.toFixed(0)}ms`, JSON.stringify(g.stats), `comps ${sizes.length} largest ${sizes.slice(0, 4).join(',')} (${(100 * sizes[0] / g.nodes.length).toFixed(2)}%)`)
}
const g = buildGraph(lines, z, { tol: 1 })
console.log('deg', JSON.stringify(count(g.adj, (a) => a.length)))

// 端点を共有しない交差: 格子で粗く分けて線分どうしを調べる
const CELL = 256
const grid = new Map()
const segsAll = []
g.edges.forEach((e, ei) => { for (let i = 1; i < e.pts.length; i++) { const s = { ei, a: e.pts[i - 1], b: e.pts[i] }; segsAll.push(s)
  const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / CELL), x1 = Math.floor(Math.max(s.a[0], s.b[0]) / CELL), y0 = Math.floor(Math.min(s.a[1], s.b[1]) / CELL), y1 = Math.floor(Math.max(s.a[1], s.b[1]) / CELL)
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x + ',' + y; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s) } } })
const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
const proper = (s, u) => { const d1 = cross(s.a, s.b, u.a), d2 = cross(s.a, s.b, u.b), d3 = cross(u.a, u.b, s.a), d4 = cross(u.a, u.b, s.b); return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) }
const found = new Set()
const kinds = []
for (const arr of grid.values()) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
  const s = arr[i], u = arr[j]
  if (s.ei === u.ei) continue
  if (!proper(s, u)) continue
  const k = Math.min(s.ei, u.ei) + '_' + Math.max(s.ei, u.ei)
  if (found.has(k)) continue
  found.add(k)
  const e1 = g.edges[s.ei], e2 = g.edges[u.ei]
  const st = (e) => (e.ft % 10 === 3 ? 'bridge' : e.ft % 10 === 4 ? 'tunnel' : 'normal')
  const pair = [st(e1) + '/lv' + e1.lv, st(e2) + '/lv' + e2.lv].sort().join(' x ')
  kinds.push(e1.lv === e2.lv && st(e1) === 'normal' && st(e2) === 'normal' ? 'SAME-LEVEL normal x normal lv' + e1.lv : pair)
}
console.log(`crossings without shared node: ${found.size}`)
console.log(JSON.stringify(count(kinds, (k) => k), null, 1))
