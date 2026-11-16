// z12 / z9 のつながり方: なぜ切れているか
import { loadBlock, lngLatToTile, count, EXTENT } from './lib.mjs'
import { buildGraph, components } from './graph.mjs'
const [name, lng, lat, zArg, halfArg] = process.argv.slice(2)
const z = +zArg, half = +halfArg
const t = lngLatToTile(+lng, +lat, z), cx = Math.floor(t.x), cy = Math.floor(t.y)
const b = await loadBlock(z, cx - half, cy - half, cx + half, cy + half)
const g = buildGraph(b.lines, z, { tol: 1 })
const { comp, sizes } = components(g)
const order = sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0])
console.log(`z${z} ${b.tiles} tiles nodes ${g.nodes.length} edges ${g.edges.length} comps ${sizes.length} top ${order.slice(0, 8).map((o) => o[0]).join(',')}`)
// 次数 1 のノード（行き止まり）から、ほかの成分の最寄りの線分までの距離
const X0 = (cx - half) * EXTENT, X1 = (cx + half + 1) * EXTENT, Y0 = (cy - half) * EXTENT, Y1 = (cy + half + 1) * EXTENT
const segs = []; g.edges.forEach((e) => { for (let i = 1; i < e.pts.length; i++) segs.push([e.pts[i - 1], e.pts[i], comp[e.a], e.cls]) })
const ds = []; const kinds = []
g.nodes.forEach((p, n) => {
  if (g.adj[n].length !== 1) return
  if (p[0] <= X0 + 1 || p[0] >= X1 - 1 || p[1] <= Y0 + 1 || p[1] >= Y1 - 1) return
  let best = Infinity, bc = 0
  for (const [a, c, cm, cls] of segs) { if (cm === comp[n]) continue; const dx = c[0] - a[0], dy = c[1] - a[1]; const L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); if (d < best) { best = d; bc = cls } }
  ds.push(best); kinds.push(g.edges[g.adj[n][0]].cls + '→' + bc + (best <= 8 ? ' near' : ' far'))
})
const bucket = (d) => d <= 1 ? '≤1' : d <= 4 ? '≤4' : d <= 16 ? '≤16' : d <= 64 ? '≤64' : d <= 256 ? '≤256' : '>256'
console.log('dead ends (inner):', ds.length, 'dist to other component (grid units):', JSON.stringify(count(ds, bucket)))
console.log(JSON.stringify(count(kinds, (k) => k)))
console.log('by class edges', JSON.stringify(count(g.edges, (e) => e.cls)), 'dead-end total deg1', g.adj.filter((a) => a.length === 1).length)
