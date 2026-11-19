// 階級つきの最短経路探索（詳細設計書 §4）。純粋関数。
//
// 状態 = (向きつきの辺, これまでの最高の階級 top)。直前の辺の階級 c は辺から決まる。
// 向きつきの辺を状態にするのは、一方通行と「高速道路での折り返しの禁止」を正しく扱うため（§14）。
// 辺（階級 c'）へ進むコスト = 長さ × weight[c'] + 罰則。
//   lo = max(c, valleyFloor), hi = min(top, c')
//   罰則 = hi > lo ? valley × (hi − lo) : 0       ← 谷の深さで罰する（行きと帰りで同じ結果になる）
//   新しい top = max(top, c')
// ただし、有料道路・高速道路（階級 5 以上）は抜け道の勘定に入れない: 乗るときは罰則なし、乗ったら top を 0 に戻す

import { haversine } from './geo.ts'
import type { RoadGraph } from './graph.ts'
import type { GraphPos, SearchParams, SearchResult, SearchStep } from './types.ts'


/** 探索に要るグラフの項目。RoadGraph（z14）と CoarseGraph（z12。coarse.ts）の両方が満たす */
export interface SearchGraph {
  adj: number[][]
  edgeA: number[]
  edgeB: number[]
  edgeLen: number[]
  edgeCls: number[]
  nodeLat: number[]
  nodeLng: number[]
  /** 一方通行: 1 = a → b だけ、-1 = b → a だけ、0 = 両方向。無ければ全部 両方向 */
  oneway?(e: number): number
  /** 辺 e1 を dir1 の向きに通ったあと、辺 e2 を dir2 の向きに進むときに足すコスト（m 相当。Infinity = 進めない。向きは 0 = a → b、1 = b → a）。無ければ 0 */
  turnCost?(e1: number, dir1: number, e2: number, dir2: number): number
}

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

/**
 * 抜け道の勘定に入れない階級（有料道路・高速道路）。
 * 高速道路に乗る・降りるのは抜け道ではない（インターチェンジの取付道路は、市区町村道のことがある。
 * 関越道 所沢 IC の出口は、料金所 → 市区町村道 → 国道）。これらの階級に乗ると、勘定をやり直す
 */
export const VALLEY_EXEMPT_FROM = 5

export function valleyPenalty(c: number, top: number, next: number, p: SearchParams): number {
  if (next >= VALLEY_EXEMPT_FROM) return 0
  const lo = Math.max(c, p.valleyFloor)
  const hi = Math.min(top, next)
  return hi > lo ? p.valley * (hi - lo) : 0
}

/** 辺（階級 next）へ進んだあとの「これまでの最高の階級」。有料・高速に乗ったら 0 に戻す */
export function nextTop(top: number, next: number): number {
  return next >= VALLEY_EXEMPT_FROM ? 0 : Math.max(top, next)
}

interface Prev { from: number; step: SearchStep; pen: number }
interface Goal { cost: number; from: number; step: SearchStep; pen: number }

export function search(
  g: SearchGraph,
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

  // 状態 = (向きつきの辺, これまでの最高の階級)。辺の番号 × 2 + 向き（0 = a → b、1 = b → a）
  const best = new Map<number, number>()
  const prev = new Map<number, Prev>()
  const closed = new Set<number>()
  const goals: Goal[] = []
  const heap = new MinHeap()
  const h = (n: number) => haversine(g.nodeLat[n], g.nodeLng[n], to.lat, to.lng) * minW
  /** 辺 e を dir の向きに通れるか（一方通行。上下線が別の線になっている道路） */
  const allowed = (e: number, dir: number) => {
    const ow = g.oneway ? g.oneway(e) : 0
    return ow === 0 || (ow > 0) === (dir === 0)
  }

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

  // 始点: 寄せた辺を、両方の向きへ（通れる向きだけ）
  const top0 = nextTop(0, c0)
  if (allowed(e0, 1)) relax((e0 * 2 + 1) * 7 + top0, g.edgeA[e0], from.t * L0 * W[c0], { from: -1, step: { edge: e0, from: from.t, to: 0 }, pen: 0 })
  if (allowed(e0, 0)) relax((e0 * 2) * 7 + top0, g.edgeB[e0], (1 - from.t) * L0 * W[c0], { from: -1, step: { edge: e0, from: from.t, to: 1 }, pen: 0 })
  // 始点と終点が同じ辺の上
  if (e0 === eG && (to.t === from.t || allowed(e0, to.t > from.t ? 0 : 1))) {
    pushGoal({ cost: Math.abs(to.t - from.t) * L0 * W[c0], from: -1, step: { edge: e0, from: from.t, to: to.t }, pen: 0 })
  }

  let expanded = 0
  let found: Goal | null = null
  while (heap.size > 0) {
    const v = heap.pop()
    if (v < 0) { found = goals[-v - 1]; break }
    if (closed.has(v)) continue
    closed.add(v)
    const gCost = best.get(v)!
    const de = Math.floor(v / 7), top = v % 7
    const e1 = de >> 1, dir1 = de & 1
    const c = g.edgeCls[e1]
    const node = dir1 === 0 ? g.edgeB[e1] : g.edgeA[e1]
    if (++expanded > p.maxExpand) return null
    if (expanded % 500 === 0 && shouldStop?.()) return null

    for (const e of g.adj[node]) {
      const ce = g.edgeCls[e]
      if (ce > p.maxClass) continue
      // 両端が同じノードの辺（輪）は、a → b の向きだけで扱う
      const dirs = g.edgeA[e] === g.edgeB[e] ? [0] : [g.edgeA[e] === node ? 0 : 1]
      for (const dir of dirs) {
        if (!allowed(e, dir)) continue
        // いま通った辺をそのまま引き返さない（行き止まりを除く）。罰則を避けるための「次の交差点まで行って戻る」を防ぐ
        if (e === e1 && g.adj[node].length > 1) continue
        const turn = g.turnCost ? g.turnCost(e1, dir1, e, dir) : 0
        if (turn === Infinity) continue
        const next = dir === 0 ? g.edgeB[e] : g.edgeA[e]
        const pen = valleyPenalty(c, top, ce, p)
        const ntop = nextTop(top, ce)
        // 終点の辺へ入る
        if (e === eG) {
          const part = dir === 0 ? to.t : 1 - to.t
          pushGoal({ cost: gCost + part * LG * W[cG] + pen + turn, from: v, step: { edge: eG, from: dir === 0 ? 0 : 1, to: to.t }, pen })
        }
        relax((e * 2 + dir) * 7 + ntop, next, gCost + g.edgeLen[e] * W[ce] + pen + turn, {
          from: v, step: { edge: e, from: dir === 0 ? 0 : 1, to: dir === 0 ? 1 : 0 }, pen,
        })
      }
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
