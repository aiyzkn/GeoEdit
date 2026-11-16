// 階級つき探索の試作。状態 = (ノード, 直前の辺の階級 1..6, 相 0=登り 1=降り)
import { worldToLngLat, haversine } from './lib.mjs'

export const DEFAULTS = {
  weight: [0, 8.0, 4.0, 2.4, 1.6, 1.2, 1.0], // index = cls
  valley: 2000,      // 降りの相で 1 階級上がるごとの罰則（m 相当）
  freeRadius: 300,   // 始点・終点からこの距離までは罰則なし
  maxClass: 6,
  dipFree: 0,        // 降りてからこの道のり以内に元の階級以上へ戻るなら「降り」と見なさない（未使用なら 0）
}

class Heap {
  constructor() { this.k = []; this.v = [] }
  get size() { return this.k.length }
  push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p } k[i] = key; v[i] = val }
  pop() { const k = this.k, v = this.v; const top = v[0]; const lk = k.pop(), lv = v.pop(); const n = k.length; if (n > 0) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c } k[i] = lk; v[i] = lv } return top }
}

export function nodeLL(g, n) { return g.ll[n] ?? (g.ll[n] = worldToLngLat(g.nodes[n][0], g.nodes[n][1], g.z)) }

/** ノードからノードへ。返り値 { cost, dist, edges:[edgeIdx], valleys, expanded } */
export function search(g, src, dst, opt = {}) {
  const o = { ...DEFAULTS, ...opt }
  g.ll ??= []
  const W = o.weight
  const minW = Math.min(...W.slice(1, o.maxClass + 1))
  const RIM = o.mode === 'rim'
  const S = RIM ? 49 : 14
  const N = g.nodes.length
  const best = new Map()
  const prev = new Map()
  const tLL = nodeLL(g, dst), sLL = nodeLL(g, src)
  const h = (n) => haversine(nodeLL(g, n), tLL) * minW
  const heap = new Heap()
  const s0 = src * S // cls 0, phase 0
  best.set(s0, 0)
  heap.push(h(src), s0)
  let expanded = 0
  let goal = -1
  while (heap.size) {
    const st = heap.pop()
    const node = Math.floor(st / S), r = st % S, lastCls = RIM ? Math.floor(r / 7) : r >> 1, phase = RIM ? r % 7 : r & 1
    const gCost = best.get(st)
    if (gCost === undefined) continue
    if (prev.get(st)?.done) continue
    if (node === dst) { goal = st; break }
    const pr = prev.get(st); if (pr) pr.done = true; else prev.set(st, { done: true, root: true })
    expanded++
    const nl = nodeLL(g, node)
    const free = o.valley === 0 || haversine(nl, sLL) <= o.freeRadius || haversine(nl, tLL) <= o.freeRadius
    for (const ei of g.adj[node]) {
      const e = g.edges[ei]
      if (e.cls > o.maxClass) continue
      const v = e.a === node ? e.b : e.a
      let np = phase, pen = 0
      if (RIM) {
        // phase = これまでの最高の階級（top）
        const top = phase
        const lo = Math.max(lastCls, o.floor ?? 1), hi = Math.min(top, e.cls)
        if (lastCls !== 0 && hi > lo && !free) pen = o.valley * (hi - lo)
        np = Math.max(top, e.cls)
      } else if (lastCls !== 0) {
        if (e.cls < lastCls) np = 1
        else if (e.cls > lastCls && phase === 1 && !free) pen = o.valley * (e.cls - lastCls)
      }
      const ns = RIM ? v * S + e.cls * 7 + np : v * S + (e.cls << 1) + np
      const nc = gCost + e.len * W[e.cls] + pen
      const b = best.get(ns)
      if (b !== undefined && b <= nc) continue
      best.set(ns, nc)
      prev.set(ns, { from: st, ei, pen })
      heap.push(nc + h(v), ns)
    }
  }
  if (goal < 0) return null
  const edges = []
  let valleys = 0, dist = 0
  for (let st = goal; ;) { const p = prev.get(st); if (!p || p.root || p.from === undefined) break; edges.push(p.ei); if (p.pen > 0) valleys++; dist += g.edges[p.ei].len; st = p.from }
  edges.reverse()
  return { cost: best.get(goal), dist, edges, valleys, expanded }
}

export function summarize(g, res) {
  const byCls = [0, 0, 0, 0, 0, 0, 0]
  const seq = []
  for (const ei of res.edges) { const e = g.edges[ei]; byCls[e.cls] += e.len; const last = seq[seq.length - 1]; if (last && last[0] === e.cls) last[1] += e.len; else seq.push([e.cls, e.len]) }
  return { km: (res.dist / 1000).toFixed(2), share: byCls.slice(1).map((d) => Math.round((100 * d) / res.dist)).join('/'), seq: seq.map(([c, d]) => `${c}:${Math.round(d)}`).join(' '), valleys: res.valleys, expanded: res.expanded }
}
