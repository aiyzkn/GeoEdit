// z12 / z9 / z16 のタイルの性質と、z14 との形の差
import { loadBlock, lngLatToTile, count, EXTENT, worldToLngLat, haversine } from './lib.mjs'
import { buildGraph, components } from './graph.mjs'
const [name, lng, lat] = process.argv.slice(2)
async function block(z, half) { const t = lngLatToTile(+lng, +lat, z), cx = Math.floor(t.x), cy = Math.floor(t.y); return loadBlock(z, cx - half, cy - half, cx + half, cy + half) }
const res = {}
for (const [z, half] of [[9, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 2]]) {
  const b = await block(z, half)
  const g = buildGraph(b.lines, z, { tol: 1 })
  const { sizes } = components(g); sizes.sort((a, b) => b - a)
  let range = [Infinity, -Infinity]; for (const l of b.lines) for (const p of l.local) { range[0] = Math.min(range[0], p[0], p[1]); range[1] = Math.max(range[1], p[0], p[1]) }
  let len = 0, verts = 0; for (const e of g.edges) { len += e.len; verts += e.pts.length }
  console.log(`z${z}: ${b.tiles} tiles ${(b.bytes / 1024 / b.tiles).toFixed(0)} KB/tile lines ${b.lines.length} range ${range} ft ${JSON.stringify(count(b.lines, (l) => l.props.ftCode))} rdCtg ${JSON.stringify(count(b.lines, (l) => l.props.rdCtg))} rnk ${JSON.stringify(count(b.lines, (l) => l.props.rnkWidth))} org ${JSON.stringify(count(b.lines, (l) => l.props.orgGILvl))}`)
  console.log(`     graph nodes ${g.nodes.length} edges ${g.edges.length} comps ${sizes.length} largest ${(100 * sizes[0] / g.nodes.length).toFixed(1)}% stats ${JSON.stringify(g.stats)} km ${(len / 1000).toFixed(0)} verts ${verts} keys ${Object.keys(b.lines[0]?.props ?? {})}`)
  res[z] = g
}
// 形の差: zA の頂点から、z14 の線分までの最短距離（m）。同じ範囲（z14 の中央タイル）に限る
function segIndex(g, cell) { const m = new Map(); const sc = 2 ** (14 - g.z); for (const e of g.edges) for (let i = 1; i < e.pts.length; i++) { const a = [e.pts[i - 1][0] * sc, e.pts[i - 1][1] * sc], b = [e.pts[i][0] * sc, e.pts[i][1] * sc]; for (let x = Math.floor(Math.min(a[0], b[0]) / cell) - 1; x <= Math.floor(Math.max(a[0], b[0]) / cell) + 1; x++) for (let y = Math.floor(Math.min(a[1], b[1]) / cell) - 1; y <= Math.floor(Math.max(a[1], b[1]) / cell) + 1; y++) { const k = x + ',' + y; if (!m.has(k)) m.set(k, []); m.get(k).push([a, b, e.cls]) } } return m }
const CELL = 128
const idx14 = segIndex(res[14], CELL)
const t14 = lngLatToTile(+lng, +lat, 14); const X0 = Math.floor(t14.x) * EXTENT, Y0 = Math.floor(t14.y) * EXTENT
const mPerUnit = haversine(worldToLngLat(X0, Y0, 14), worldToLngLat(X0 + 1000, Y0, 14)) / 1000
for (const z of [9, 12, 13, 15, 16]) {
  const g = res[z], sc = 2 ** (14 - z); const ds = []
  for (const e of g.edges) { if (e.cls < 3 && z < 14) continue; for (const p of e.pts) { const q = [p[0] * sc, p[1] * sc]; if (q[0] < X0 || q[0] > X0 + EXTENT || q[1] < Y0 || q[1] > Y0 + EXTENT) continue
    let best = Infinity; for (const [a, b] of idx14.get(Math.floor(q[0] / CELL) + ',' + Math.floor(q[1] / CELL)) ?? []) { const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy; let t = L ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy); if (d < best) best = d }
    ds.push(best * mPerUnit) } }
  ds.sort((a, b) => a - b); const q = (p) => ds[Math.floor(ds.length * p)]
  console.log(`z${z} vertices → z14 lines: n=${ds.length} median ${q(0.5)?.toFixed(2)} m p90 ${q(0.9)?.toFixed(2)} p99 ${q(0.99)?.toFixed(2)} max ${ds[ds.length - 1] === Infinity ? '>cell(' + (CELL * mPerUnit).toFixed(0) + 'm)' : ds[ds.length - 1]?.toFixed(1)} ; >cell: ${ds.filter((d) => d === Infinity).length}`)
}
