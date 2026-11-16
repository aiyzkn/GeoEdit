// タイル → グラフ の試作（詳細設計の検証用）
import { EXTENT, worldToLngLat, haversine } from './lib.mjs'

/** 折れ線を、タイル自身の範囲 [0,E]×[0,E]（local 座標）で切る。Liang–Barsky を線分ごとに */
export function clipLine(local, E = EXTENT) {
  const out = []
  let cur = null
  const inside = (p) => p[0] >= 0 && p[0] <= E && p[1] >= 0 && p[1] <= E
  for (let i = 0; i < local.length - 1; i++) {
    const a = local[i], b = local[i + 1]
    let t0 = 0, t1 = 1
    const dx = b[0] - a[0], dy = b[1] - a[1]
    let ok = true
    for (const [p, q] of [[-dx, a[0]], [dx, E - a[0]], [-dy, a[1]], [dy, E - a[1]]]) {
      if (p === 0) { if (q < 0) { ok = false; break } }
      else { const r = q / p; if (p < 0) { if (r > t1) { ok = false; break } if (r > t0) t0 = r } else { if (r < t0) { ok = false; break } if (r < t1) t1 = r } }
    }
    if (!ok) { if (cur) { out.push(cur); cur = null } continue }
    const pa = t0 === 0 ? a : [Math.round(a[0] + dx * t0), Math.round(a[1] + dy * t0)]
    const pb = t1 === 1 ? b : [Math.round(a[0] + dx * t1), Math.round(a[1] + dy * t1)]
    if (!cur) cur = [pa]
    else if (cur[cur.length - 1][0] !== pa[0] || cur[cur.length - 1][1] !== pa[1]) { out.push(cur); cur = [pa] }
    if (pb[0] !== pa[0] || pb[1] !== pa[1]) cur.push(pb)
    if (t1 < 1) { out.push(cur); cur = null }
  }
  if (cur) out.push(cur)
  return out.filter((l) => l.length >= 2)
}

export function classOf(p) {
  const ft = p.ftCode
  if (p.motorway === 1 || p.rdCtg === 3) return 6
  if (p.tollSect === 1) return 5
  if (ft >= 2710 && ft <= 2739) return 1 // 庭園路・徒歩道・石段
  if (p.rdCtg === 0) return 4
  if (p.rdCtg === 1) return 3
  if (p.rdCtg === 2) return p.rnkWidth === 0 ? 1 : 2
  return 1
}

/**
 * lines: lib.loadBlock の結果。opts.tol: 境界の縫い合わせの許容（格子）
 * 返り値: { nodes: [[wx,wy]], adj: [[edgeIdx...]], edges: [{a,b,len,cls,lv,pts}] , stats }
 */
export function buildGraph(lines, z, opts = {}) {
  const tol = opts.tol ?? 1
  const E = EXTENT
  const segs = []
  for (const l of lines) {
    const ft = l.props.ftCode
    if (!(ft >= 2700 && ft <= 2799)) continue
    for (const c of clipLine(l.local)) {
      segs.push({ props: l.props, tx: l.tx, ty: l.ty, pts: c.map((q) => [l.tx * E + q[0], l.ty * E + q[1]]), local: c })
    }
  }
  const key = (p) => p[0] * 67108864 + p[1] // wx < 2^26 at z14
  const nodeId = new Map()
  const nodes = []
  const getNode = (p) => { const k = key(p); let id = nodeId.get(k); if (id === undefined) { id = nodes.length; nodes.push(p); nodeId.set(k, id) } return id }

  // 境界上の端点: 許容差つきでまとめる。境界線ごとに並べて寄せる
  const stats = { boundaryEnds: 0, exact: 0, snapped: 0, alone: 0 }
  const bmap = new Map() // 'v:wx' / 'h:wy' → [{pos, p}]
  const onB = (q) => q[0] === 0 || q[0] === E || q[1] === 0 || q[1] === E
  const canon = new Map() // key(p) → 代表の点
  for (const s of segs) for (const i of [0, s.pts.length - 1]) {
    if (!onB(s.local[i])) continue
    const p = s.pts[i]
    const ks = []
    if (s.local[i][0] === 0 || s.local[i][0] === E) ks.push(['v:' + p[0], p[1]])
    if (s.local[i][1] === 0 || s.local[i][1] === E) ks.push(['h:' + p[1], p[0]])
    for (const [bk, pos] of ks) { if (!bmap.has(bk)) bmap.set(bk, []); bmap.get(bk).push({ pos, p, s }) }
  }
  for (const arr of bmap.values()) {
    arr.sort((a, b) => a.pos - b.pos)
    let i = 0
    while (i < arr.length) {
      let j = i + 1
      while (j < arr.length && arr[j].pos - arr[j - 1].pos <= tol) j++
      const grp = arr.slice(i, j)
      const tiles = new Set(grp.map((g) => g.s.tx + '/' + g.s.ty))
      stats.boundaryEnds += grp.length
      if (tiles.size >= 2) { if (grp.every((g) => g.pos === grp[0].pos)) stats.exact += grp.length; else stats.snapped += grp.length }
      else stats.alone += grp.length
      for (const g of grp) canon.set(key(g.p), grp[0].p)
      i = j
    }
  }
  const rep = (p) => canon.get(key(p)) ?? p

  // 端点の集合（途中の点が端点と一致したら、そこで切る）
  const endKeys = new Set()
  for (const s of segs) { endKeys.add(key(rep(s.pts[0]))); endKeys.add(key(rep(s.pts[s.pts.length - 1]))) }
  const edges = []
  const seen = new Set()
  let splitMid = 0, dup = 0
  const lenOf = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += haversine(worldToLngLat(pts[i - 1][0], pts[i - 1][1], z), worldToLngLat(pts[i][0], pts[i][1], z)); return d }
  const push = (pts, s) => {
    const a = getNode(rep(pts[0])), b = getNode(rep(pts[pts.length - 1]))
    if (a === b && pts.length <= 2) return
    const len = lenOf(pts)
    const sig = (a < b ? a + '_' + b : b + '_' + a) + '_' + pts.length + '_' + Math.round(len * 10)
    if (seen.has(sig)) { dup++; return }
    seen.add(sig)
    edges.push({ a, b, len, cls: classOf(s.props), lv: s.props.lvOrder, ft: s.props.ftCode, props: s.props, pts })
  }
  for (const s of segs) {
    let start = 0
    for (let i = 1; i < s.pts.length - 1; i++) {
      if (endKeys.has(key(s.pts[i]))) { push(s.pts.slice(start, i + 1), s); start = i; splitMid++ }
    }
    push(s.pts.slice(start), s)
  }
  const adj = nodes.map(() => [])
  edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i) })
  stats.splitMid = splitMid; stats.dup = dup; stats.segs = segs.length
  return { nodes, adj, edges, stats, z }
}

export function components(g) {
  const comp = new Int32Array(g.nodes.length).fill(-1)
  const sizes = []
  for (let s = 0; s < g.nodes.length; s++) {
    if (comp[s] !== -1) continue
    const id = sizes.length
    let n = 0
    const st = [s]; comp[s] = id
    while (st.length) { const u = st.pop(); n++; for (const ei of g.adj[u]) { const e = g.edges[ei]; const v = e.a === u ? e.b : e.a; if (comp[v] === -1) { comp[v] = id; st.push(v) } } }
    sizes.push(n)
  }
  return { comp, sizes }
}
