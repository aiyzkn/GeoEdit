// 2 段階の探索の試作: z12 の粗いグラフ（つながりを補う）→ z14 の回廊 → 全体での最適と比べる
import { loadBlock, lngLatToTile, haversine, worldToLngLat, EXTENT } from './lib.mjs'
import { buildGraph, components } from './graph.mjs'
import { search, nodeLL, summarize } from './search.mjs'

const [name, lng, lat, halfArg, nArg, seedArg, minKm, bufArg, endArg, zcArg] = process.argv.slice(2)
const E = EXTENT
const ZC = +(zcArg ?? 12), SC = 2 ** (14 - ZC)
const RULE = { mode: 'rim', freeRadius: 0, floor: 2 }
const t = lngLatToTile(+lng, +lat, 14), cx = Math.floor(t.x), cy = Math.floor(t.y), h = +halfArg
const fine = await loadBlock(14, cx - h, cy - h, cx + h, cy + h)
const G = buildGraph(fine.lines, 14, { tol: 1 }); G.ll = []
const { comp, sizes } = components(G); const big = sizes.indexOf(Math.max(...sizes))
console.log(`${name}: z14 ${fine.tiles} tiles ${(fine.bytes / 1048576).toFixed(0)} MB, nodes ${G.nodes.length}`)
const mPer = haversine(worldToLngLat(cx * E, cy * E, 14), worldToLngLat(cx * E + 1000, cy * E, 14)) / 1000 // m per z14 unit

// ---- 粗いグラフ ----
const c0 = { x: Math.floor((cx - h) / SC), y: Math.floor((cy - h) / SC) }, c1 = { x: Math.floor((cx + h) / SC), y: Math.floor((cy + h) / SC) }
const coarse = await loadBlock(ZC, c0.x, c0.y, c1.x, c1.y)
function buildCoarse() {
  const g = buildGraph(coarse.lines, ZC, { tol: 2 })
  const before = components(g).sizes
  const addEdge = (a, b, cls, len, virt) => { if (a === b) return; const i = g.edges.length; g.edges.push({ a, b, len, cls, lv: 0, ft: 2701, pts: [g.nodes[a], g.nodes[b]], virt }); g.adj[a].push(i); g.adj[b].push(i) }
  const mC = mPer * SC
  // (b) 近いノードどうし（TAU 格子以内）を長さ 0 の辺で結ぶ  (c) 行き止まり → 近い線分の両端へ
  const TAU = 3
  const cell = 64
  const ngrid = new Map()
  g.nodes.forEach((p, n) => { const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell); if (!ngrid.has(k)) ngrid.set(k, []); ngrid.get(k).push(n) })
  const near = (p, r) => { const out = []; const x0 = Math.floor((p[0] - r) / cell), x1 = Math.floor((p[0] + r) / cell), y0 = Math.floor((p[1] - r) / cell), y1 = Math.floor((p[1] + r) / cell); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const n of ngrid.get(x + ',' + y) ?? []) out.push(n); return out }
  let merged = 0, toSeg = 0, bridged = 0
  g.nodes.forEach((p, n) => { for (const m of near(p, TAU)) if (m > n && Math.hypot(g.nodes[m][0] - p[0], g.nodes[m][1] - p[1]) <= TAU && (g.edges[g.adj[n][0]].cls === 6) === (g.edges[g.adj[m][0]].cls === 6)) { addEdge(n, m, Math.max(g.edges[g.adj[n][0]].cls, 2), 0, 'merge'); merged++ } })
  const sgrid = new Map()
  const nReal = g.edges.length
  for (let ei = 0; ei < nReal; ei++) { const e = g.edges[ei]; if (e.virt) continue; for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1], b = e.pts[i]; for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++) for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) { const k = x + ',' + y; if (!sgrid.has(k)) sgrid.set(k, []); sgrid.get(k).push([ei, i]) } } }
  const deadEnds = []
  g.nodes.forEach((p, n) => { if (g.adj[n].length === 1) deadEnds.push(n) })
  for (const n of deadEnds) {
    const p = g.nodes[n]; let best = TAU + 0.001, hit = null
    for (let x = Math.floor((p[0] - TAU) / cell); x <= Math.floor((p[0] + TAU) / cell); x++) for (let y = Math.floor((p[1] - TAU) / cell); y <= Math.floor((p[1] + TAU) / cell); y++) for (const [ei, i] of sgrid.get(x + ',' + y) ?? []) {
      const e = g.edges[ei]; if (e.a === n || e.b === n) continue
      if ((e.cls === 6) !== (g.edges[g.adj[n][0]].cls === 6)) continue
      const a = e.pts[i - 1], b = e.pts[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy; let tt = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; tt = Math.max(0, Math.min(1, tt)); const d = Math.hypot(p[0] - a[0] - tt * dx, p[1] - a[1] - tt * dy)
      if (d < best) { best = d; hit = ei }
    }
    if (hit !== null) { const e = g.edges[hit]; const da = Math.hypot(g.nodes[e.a][0] - p[0], g.nodes[e.a][1] - p[1]) * mC, db = Math.hypot(g.nodes[e.b][0] - p[0], g.nodes[e.b][1] - p[1]) * mC; addEdge(n, e.a, e.cls, da, 'seg'); addEdge(n, e.b, e.cls, db, 'seg'); toSeg++ }
  }
  // (d) それでも行き止まりのもの: GAP m 以内の、別の成分のノードへ「市道の仮の辺」
  const GAP = 800 / mC
  let cc = components(g)
  for (const n of deadEnds) {
    if (g.adj[n].length !== 1) continue
    const p = g.nodes[n]; const cands = []
    const own = g.edges[g.adj[n][0]]; const is6 = own.cls === 6
    for (const m of near(p, GAP)) { if (m === own.a || m === own.b) continue; if (process.env.BR ? (is6 && g.edges[g.adj[m][0]].cls === 6) : cc.comp[m] === cc.comp[n]) continue; const d = Math.hypot(g.nodes[m][0] - p[0], g.nodes[m][1] - p[1]); if (d <= GAP) cands.push([d, m]) }
    cands.sort((a, b) => a[0] - b[0])
    for (const [d, m] of cands.slice(0, 2)) { addEdge(n, m, 2, d * mC * 1.3, 'gap'); bridged++ }
  }
  const after = components(g).sizes
  const top = (s) => Math.round(100 * Math.max(...s) / s.reduce((a, b) => a + b, 0))
  console.log(`coarse z${ZC}: ${coarse.tiles} tiles ${(coarse.bytes / 1024).toFixed(0)} KB nodes ${g.nodes.length}; comps ${before.length} (largest ${top(before)}%) → ${after.length} (largest ${top(after)}%); merged ${merged} toSeg ${toSeg} bridged ${bridged}`)
  g.ngrid = ngrid; g.near = near; g.mC = mC; g.addEdge = addEdge
  return g
}
const C = buildCoarse(); C.ll = []
const baseEdges = C.edges.length, baseNodes = C.nodes.length

function coarseRoute(pa, pb) {
  // 仮のノードを足す（終わったら戻す）
  const added = []
  const attach = (p) => {
    const q = [p[0] / SC, p[1] / SC]; const n = C.nodes.length; C.nodes.push(q); C.adj.push([]); C.ll[n] = undefined
    let R = 1500 / C.mC, cands = []
    for (; R <= 12000 / C.mC && cands.length < 3; R *= 2) { cands = []; for (const m of C.near(q, R)) { if (m >= baseNodes) continue; const d = Math.hypot(C.nodes[m][0] - q[0], C.nodes[m][1] - q[1]); if (d <= R) cands.push([d, m]) } }
    cands.sort((a, b) => a[0] - b[0])
    for (const [d, m] of cands.slice(0, 6)) C.addEdge(n, m, 2, d * C.mC * 1.3, 'end')
    added.push(n); return n
  }
  const a = attach(pa), b = attach(pb)
  const ALT = process.env.ALT ? [RULE, { ...RULE, maxClass: 4 }] : [RULE]; globalThis.__alt = ALT.length
  let pts = null
  for (const rule of ALT) { const r = search(C, a, b, rule); if (!r) continue; pts ??= []; let cur = a; for (const ei of r.edges) { const e = C.edges[ei]; const fw = e.a === cur; const ps = fw ? e.pts : e.pts.slice().reverse(); for (const p of ps) pts.push([p[0] * SC, p[1] * SC]); cur = fw ? e.b : e.a } pts.push(null) }
  // 戻す
  for (let i = C.edges.length - 1; i >= baseEdges; i--) { const e = C.edges[i]; C.adj[e.a] = C.adj[e.a].filter((x) => x !== i); C.adj[e.b] = C.adj[e.b].filter((x) => x !== i) }
  C.edges.length = baseEdges; C.nodes.length = baseNodes; C.adj.length = baseNodes; C.ll.length = baseNodes
  return pts
}

function corridorTiles(pts, pa, pb, bufM, endM) {
  const set = new Set()
  const mark = (p, r) => { const u = r / mPer; for (let x = Math.floor((p[0] - u) / E); x <= Math.floor((p[0] + u) / E); x++) for (let y = Math.floor((p[1] - u) / E); y <= Math.floor((p[1] + u) / E); y++) set.add(x + '/' + y) }
  const step = 150 / mPer
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (!a || !b) continue; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / step)); for (let k = 0; k <= n; k++) mark([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], bufM) }
  mark(pa, endM); mark(pb, endM)
  return set
}

const byTile = new Map()
for (const l of fine.lines) { const k = l.tx + '/' + l.ty; if (!byTile.has(k)) byTile.set(k, []); byTile.get(k).push(l) }
const X0 = (cx - h + 2) * E, X1 = (cx + h - 1) * E, Y0 = (cy - h + 2) * E, Y1 = (cy + h - 1) * E
const cand = []; G.nodes.forEach((p, n) => { if (comp[n] === big && p[0] > X0 && p[0] < X1 && p[1] > Y0 && p[1] < Y1 && p[0] % E !== 0 && p[1] % E !== 0) cand.push(n) })
let seed = +(seedArg ?? 1); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const BUF = +(bufArg ?? 700), END = +(endArg ?? 2500)
const rows = []
let n = 0, tries = 0
while (n < +nArg && tries++ < 5000) {
  const a = cand[Math.floor(rnd() * cand.length)], b = cand[Math.floor(rnd() * cand.length)]
  const pa = G.nodes[a], pb = G.nodes[b]; const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * mPer
  if (d < +minKm * 1000) continue
  n++
  const t0 = performance.now()
  const full = search(G, a, b, RULE)
  const t1 = performance.now()
  const cp = coarseRoute(pa, pb)
  const t2 = performance.now()
  if (!cp) { rows.push({ d, fail: 'coarse' }); console.log(`pair ${n} d=${(d / 1000).toFixed(1)} coarse: no route`); continue }
  const tiles = corridorTiles(cp, pa, pb, BUF, END)
  const lines = []; let nt = 0; for (const k of tiles) { const ls = byTile.get(k); if (ls) { nt++; for (const l of ls) lines.push(l) } }
  const g2 = buildGraph(lines, 14, { tol: 1 }); g2.ll = []
  const key = (p) => p[0] + ',' + p[1]; const idx = new Map(); g2.nodes.forEach((p, i) => idx.set(key(p), i))
  const a2 = idx.get(key(pa)), b2 = idx.get(key(pb))
  const t3 = performance.now()
  const r2 = a2 !== undefined && b2 !== undefined ? search(g2, a2, b2, RULE) : null
  const t4 = performance.now()
  // 全体の最適が通るタイルの数（理想の最小）
  const used = new Set(); for (const ei of full.edges) for (const p of G.edges[ei].pts) used.add(Math.floor(p[0] / E) + '/' + Math.floor(p[1] / E))
  let miss = 0; for (const k of used) if (!tiles.has(k)) miss++
  const row = { d, tiles: nt, used: used.size, miss, ratio: r2 ? r2.cost / full.cost : null, fullMs: t1 - t0, coarseMs: t2 - t1, buildMs: t3 - t2, fineMs: t4 - t3 }
  rows.push(row)
  console.log(`pair ${n} d=${(d / 1000).toFixed(1)}km full ${(full.dist / 1000).toFixed(1)}km | corridor tiles ${nt} (optimal path uses ${used.size}, missed ${miss}) cost ratio ${row.ratio?.toFixed(3) ?? 'NO ROUTE'} | ms full ${row.fullMs.toFixed(0)} coarse ${row.coarseMs.toFixed(0)} build ${row.buildMs.toFixed(0)} fine ${row.fineMs.toFixed(0)}`)
  if (row.ratio === null || row.ratio > 1.05) { console.log('   full   ', summarize(G, full).seq.slice(0, 200)); if (r2) console.log('   2stage ', summarize(g2, r2).seq.slice(0, 200)) }
}
const ok = rows.filter((r) => r.ratio !== null && r.ratio !== undefined)
const q = (arr, p) => arr.slice().sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(arr.length * p))]
console.log('alt', globalThis.__alt)
console.log(`SUMMARY ${name} buf=${BUF} end=${END} zc=${ZC}: n=${rows.length} fail=${rows.length - ok.length} exact(≤1.001)=${ok.filter((r) => r.ratio <= 1.001).length} ≤1.05=${ok.filter((r) => r.ratio <= 1.05).length} worst=${Math.max(...ok.map((r) => r.ratio)).toFixed(3)} tiles p50=${q(ok.map((r) => r.tiles), 0.5)} max=${q(ok.map((r) => r.tiles), 1)}`)
