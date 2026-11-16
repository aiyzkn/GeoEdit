// 階級つきの最短経路探索（詳細設計書 §4）。純粋関数。
//
// 状態 = (ノード, 直前の辺の階級 c, これまでの最高の階級 top)。
// 辺（階級 c'）へ進むコスト = 長さ × weight[c'] + 罰則。
//   lo = max(c, valleyFloor), hi = min(top, c')
//   罰則 = hi > lo ? valley × (hi − lo) : 0       ← 谷の深さで罰する（行きと帰りで同じ結果になる）
//   新しい top = max(top, c')

import { haversine } from './geo.ts'
import type { RoadGraph } from './graph.ts'
import type { GraphPos, SearchParams, SearchResult, SearchStep } from './types.ts'

const S = 49

class MinHeap {
  private keys: number[] = []
  private vals: number[] = []
  get size(): number { return this.keys.length }
  push(key: number, val: number) {
    const k = this.keys, v = this.vals
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.keys, v = this.vals
    const top = v[0]
    const lk = k.pop()!, lv = v.pop()!
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1] < k[c]) c++
        if (k[c] >= lk) break
        k[i] = k[c]; v[i] = v[c]; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

export function valleyPenalty(c: number, top: number, next: number, p: SearchParams): number {
  const lo = Math.max(c, p.valleyFloor)
  const hi = Math.min(top, next)
  return hi > lo ? p.valley * (hi - lo) : 0
}

interface Prev { from: number; step: SearchStep; pen: number }
interface Goal { cost: number; from: number; step: SearchStep; pen: number }

export function search(
  g: RoadGraph,
  from: GraphPos,
  to: GraphPos,
  p: SearchParams,
  shouldStop?: () => boolean,
): SearchResult | null {
  const W = p.weight
  let minW = Infinity
  for (let c = 1; c <= p.maxClass; c++) minW = Math.min(minW, W[c])
  if (!(minW > 0) || !Number.isFinite(minW)) minW = 0
  const e0 = from.edge, eG = to.edge
  const c0 = g.edgeCls[e0], cG = g.edgeCls[eG]
  if (c0 > p.maxClass || cG > p.maxClass) return null
  const L0 = g.edgeLen[e0], LG = g.edgeLen[eG]
  const aG = g.edgeA[eG], bG = g.edgeB[eG]

  const best = new Map<number, number>()
  const prev = new Map<number, Prev>()
  const closed = new Set<number>()
  const goals: Goal[] = []
  const heap = new MinHeap()
  const h = (n: number) => haversine(g.nodeLat[n], g.nodeLng[n], to.lat, to.lng) * minW

  const relax = (state: number, node: number, cost: number, pr: Prev) => {
    const b = best.get(state)
    if (b !== undefined && b <= cost) return
    best.set(state, cost)
    prev.set(state, pr)
    heap.push(cost + h(node), state)
  }
  const pushGoal = (goal: Goal) => {
    goals.push(goal)
    heap.push(goal.cost, -goals.length)
  }

  // 始点: 寄せた辺の両端へ
  const st0 = c0 * 7 + c0
  relax(g.edgeA[e0] * S + st0, g.edgeA[e0], from.t * L0 * W[c0], { from: -1, step: { edge: e0, from: from.t, to: 0 }, pen: 0 })
  relax(g.edgeB[e0] * S + st0, g.edgeB[e0], (1 - from.t) * L0 * W[c0], { from: -1, step: { edge: e0, from: from.t, to: 1 }, pen: 0 })
  // 始点と終点が同じ辺の上
  if (e0 === eG) pushGoal({ cost: Math.abs(to.t - from.t) * L0 * W[c0], from: -1, step: { edge: e0, from: from.t, to: to.t }, pen: 0 })

  let expanded = 0
  let found: Goal | null = null
  while (heap.size > 0) {
    const v = heap.pop()
    if (v < 0) { found = goals[-v - 1]; break }
    if (closed.has(v)) continue
    closed.add(v)
    const gCost = best.get(v)!
    const node = Math.floor(v / S)
    const r = v % S
    const c = Math.floor(r / 7), top = r % 7
    if (++expanded > p.maxExpand) return null
    if (expanded % 500 === 0 && shouldStop?.()) return null

    // 終点の辺へ入る
    if (node === aG || node === bG) {
      const pen = valleyPenalty(c, top, cG, p)
      if (node === aG) pushGoal({ cost: gCost + to.t * LG * W[cG] + pen, from: v, step: { edge: eG, from: 0, to: to.t }, pen })
      if (node === bG) pushGoal({ cost: gCost + (1 - to.t) * LG * W[cG] + pen, from: v, step: { edge: eG, from: 1, to: to.t }, pen })
    }

    for (const e of g.adj[node]) {
      const ce = g.edgeCls[e]
      if (ce > p.maxClass) continue
      const forward = g.edgeA[e] === node
      const next = forward ? g.edgeB[e] : g.edgeA[e]
      const pen = valleyPenalty(c, top, ce, p)
      const ntop = Math.max(top, ce)
      relax(next * S + ce * 7 + ntop, next, gCost + g.edgeLen[e] * W[ce] + pen, {
        from: v, step: { edge: e, from: forward ? 0 : 1, to: forward ? 1 : 0 }, pen,
      })
    }
  }
  if (!found) return null

  const steps: SearchStep[] = [found.step]
  let valleys = found.pen > 0 ? 1 : 0
  for (let s = found.from; s >= 0;) {
    const pr = prev.get(s)!
    steps.push(pr.step)
    if (pr.pen > 0) valleys++
    s = pr.from
  }
  steps.reverse()
  let distance = 0
  for (const s of steps) distance += Math.abs(s.to - s.from) * g.edgeLen[s.edge]
  return { steps, distance, cost: found.cost, valleys }
}

/** 探索の結果を点列にする（つなぎ目の同じ点は 1 つに） */
export function stepsToPoints(g: RoadGraph, steps: SearchStep[]): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = []
  for (const s of steps) {
    if (s.from === s.to) continue
    const pts = g.subShape(s.edge, s.from, s.to)
    for (const q of pts) {
      const last = out[out.length - 1]
      if (last && Math.abs(last.lat - q.lat) < 1e-9 && Math.abs(last.lng - q.lng) < 1e-9) continue
      out.push(q)
    }
  }
  return out
}
