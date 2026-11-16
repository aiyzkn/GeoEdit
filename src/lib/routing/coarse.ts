// 長い区間の 2 段階の探索の、1 段目（詳細設計書 §6.2）。
// z12 のタイル（国道・県道・高速だけ。1 枚が約 10 km 四方で軽い）で粗いグラフを作り、経路の見当をつける。
// z12 の線は交差点で切れていない・端点がずれている所が多く、そのままではつながらないので補う。
// ここで作る線は、z14 のタイルを取る範囲（回廊）を決めるためだけに使う（最終の線は z14 から作る）。

import { haversine, latLngToWorld, metersPerUnit, worldToLatLng } from './geo.ts'
import { search, type SearchGraph } from './search.ts'
import type { LatLng, RoadClass, RoadTile, SearchParams } from './types.ts'

export const COARSE_ZOOM = 12
/** z12 の世界座標 → z14 の世界座標 */
const SCALE = 4

export const COARSE = {
  /** 近いノードどうしを長さ 0 の辺で結ぶ距離（z12 の格子。約 6 m） */
  mergeTol: 3,
  /** 行き止まりから「仮の市区町村道」を張る距離 */
  gapM: 800,
  gapFactor: 1.3,
  gapLinks: 2,
  /** 始点・終点を粗いグラフへつなぐ */
  attachLinks: 6,
  attachRadiusStartM: 1500,
  attachRadiusMaxM: 12000,
  attachMinFound: 3,
} as const

const VIRTUAL_CLASS: RoadClass = 2
const CELL = 2048 // ノードの索引のマス（z14 の格子。約 1 km）
const SEG_CELL = 1024 // 線分の索引のマス

export interface CoarseGraph extends SearchGraph {
  nodeX: number[]
  nodeY: number[]
  /** 辺の形（z14 の世界座標の x, y の並び） */
  edgePts: number[][]
}

function key(x: number, y: number): number {
  return x * 2 ** 27 + y
}

class Builder implements CoarseGraph {
  nodeX: number[] = []
  nodeY: number[] = []
  nodeLat: number[] = []
  nodeLng: number[] = []
  adj: number[][] = []
  edgeA: number[] = []
  edgeB: number[] = []
  edgeLen: number[] = []
  edgeCls: number[] = []
  edgePts: number[][] = []
  private index = new Map<number, number>()
  private cells = new Map<number, number[]>()
  private sig = new Set<string>()

  node(x: number, y: number): number {
    const k = key(x, y)
    const hit = this.index.get(k)
    if (hit !== undefined) return hit
    return this.addNode(x, y, k)
  }

  addNode(x: number, y: number, k?: number): number {
    const n = this.nodeX.length
    this.nodeX.push(x)
    this.nodeY.push(y)
    const ll = worldToLatLng(x, y)
    this.nodeLat.push(ll.lat)
    this.nodeLng.push(ll.lng)
    this.adj.push([])
    if (k !== undefined) {
      this.index.set(k, n)
      const ck = Math.floor(x / CELL) * 2 ** 20 + Math.floor(y / CELL)
      let arr = this.cells.get(ck)
      if (!arr) { arr = []; this.cells.set(ck, arr) }
      arr.push(n)
    }
    return n
  }

  /** dedupe = false は、あとで外す仮の辺（重複の記録を残さない） */
  edge(a: number, b: number, len: number, cls: number, pts: number[], dedupe = true) {
    if (a === b) return
    if (dedupe) {
      const s = `${Math.min(a, b)}_${Math.max(a, b)}_${pts.length}_${Math.round(len)}`
      if (this.sig.has(s)) return
      this.sig.add(s)
    }
    const e = this.edgeA.length
    this.edgeA.push(a)
    this.edgeB.push(b)
    this.edgeLen.push(len)
    this.edgeCls.push(cls)
    this.edgePts.push(pts)
    this.adj[a].push(e)
    this.adj[b].push(e)
  }

  /** (x, y) から r（z14 の格子）以内の、索引に入っているノード */
  nodesNear(x: number, y: number, r: number): number[] {
    const out: number[] = []
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
        const arr = this.cells.get(cx * 2 ** 20 + cy)
        if (!arr) continue
        for (const n of arr) if (Math.hypot(this.nodeX[n] - x, this.nodeY[n] - y) <= r) out.push(n)
      }
    }
    return out
  }
}

function lenOf(pts: number[]): number {
  let d = 0
  let prev = worldToLatLng(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) {
    const ll = worldToLatLng(pts[i], pts[i + 1])
    d += haversine(prev.lat, prev.lng, ll.lat, ll.lng)
    prev = ll
  }
  return d
}

function distLL(g: CoarseGraph, a: number, b: number): number {
  return haversine(g.nodeLat[a], g.nodeLng[a], g.nodeLat[b], g.nodeLng[b])
}

/** z12 のタイル（decodeRoadTile で z12 の番号を渡してデコードしたもの）から、粗いグラフを作る（§6.2 の a〜d） */
export function buildCoarseGraph(tiles: RoadTile[]): CoarseGraph {
  const g = new Builder()

  // a. 線を z14 の世界座標にして、端点をノードにする。途中の点が端点と同じなら、そこで分ける
  const lines: { cls: number; pts: number[] }[] = []
  for (const t of tiles) {
    for (let i = 0; i < t.count; i++) {
      const pts: number[] = []
      for (let p = t.start[i]; p < t.start[i + 1]; p++) pts.push(t.coords[2 * p] * SCALE, t.coords[2 * p + 1] * SCALE)
      lines.push({ cls: t.cls[i], pts })
    }
  }
  const ends = new Set<number>()
  for (const l of lines) {
    ends.add(key(l.pts[0], l.pts[1]))
    ends.add(key(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]))
  }
  for (const l of lines) {
    let from = 0
    const n = l.pts.length / 2
    const push = (i0: number, i1: number) => {
      const pts = l.pts.slice(2 * i0, 2 * i1 + 2)
      g.edge(g.node(pts[0], pts[1]), g.node(pts[pts.length - 2], pts[pts.length - 1]), lenOf(pts), l.cls, pts)
    }
    for (let i = 1; i < n - 1; i++) {
      if (ends.has(key(l.pts[2 * i], l.pts[2 * i + 1]))) { push(from, i); from = i }
    }
    push(from, n - 1)
  }
  const baseNodes = g.nodeX.length
  const baseEdges = g.edgeA.length
  const isMw = (n: number) => g.adj[n].length > 0 && g.adj[n].every((e) => g.edgeCls[e] === 6)
  const maxCls = (n: number) => Math.max(...g.adj[n].map((e) => g.edgeCls[e]))
  const mw: boolean[] = []
  for (let n = 0; n < baseNodes; n++) mw.push(isMw(n))
  const tolZ14 = COARSE.mergeTol * SCALE

  // b. 近いノードどうしを長さ 0 の辺で結ぶ（高速とそれ以外はつながない）
  for (let n = 0; n < baseNodes; n++) {
    for (const m of g.nodesNear(g.nodeX[n], g.nodeY[n], tolZ14)) {
      if (m <= n || m >= baseNodes || mw[m] !== mw[n]) continue
      g.edge(n, m, 0, Math.max(maxCls(n), maxCls(m)), [g.nodeX[n], g.nodeY[n], g.nodeX[m], g.nodeY[m]])
    }
  }

  // c. 行き止まりの近くにほかの辺の線分があれば、その辺の両端へ結ぶ（高速とそれ以外はつながない）
  //    z12 の線は交差点で切れていないことが多く、辺が長いので、線分の索引で探す
  const segCells = new Map<number, number[]>()
  for (let e = 0; e < baseEdges; e++) {
    const pts = g.edgePts[e]
    for (let i = 2; i < pts.length; i += 2) {
      const x0 = Math.floor(Math.min(pts[i - 2], pts[i]) / SEG_CELL), x1 = Math.floor(Math.max(pts[i - 2], pts[i]) / SEG_CELL)
      const y0 = Math.floor(Math.min(pts[i - 1], pts[i + 1]) / SEG_CELL), y1 = Math.floor(Math.max(pts[i - 1], pts[i + 1]) / SEG_CELL)
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const ck = cx * 2 ** 20 + cy
        let arr = segCells.get(ck)
        if (!arr) { arr = []; segCells.set(ck, arr) }
        arr.push(e, i)
      }
    }
  }
  const deadEnds: number[] = []
  for (let n = 0; n < baseNodes; n++) if (g.adj[n].length === 1) deadEnds.push(n)
  for (const n of deadEnds) {
    const px = g.nodeX[n], py = g.nodeY[n]
    let best = tolZ14 + 1e-6, hit = -1
    for (let cx = Math.floor((px - tolZ14) / SEG_CELL); cx <= Math.floor((px + tolZ14) / SEG_CELL); cx++) {
      for (let cy = Math.floor((py - tolZ14) / SEG_CELL); cy <= Math.floor((py + tolZ14) / SEG_CELL); cy++) {
        const arr = segCells.get(cx * 2 ** 20 + cy)
        if (!arr) continue
        for (let k = 0; k < arr.length; k += 2) {
          const e = arr[k], i = arr[k + 1]
          if (g.edgeA[e] === n || g.edgeB[e] === n) continue
          if ((g.edgeCls[e] === 6) !== mw[n]) continue
          const pts = g.edgePts[e]
          const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1]
        const dx = bx - ax, dy = by - ay
        const L2 = dx * dx + dy * dy
        let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
        t = Math.max(0, Math.min(1, t))
          const d = Math.hypot(px - ax - t * dx, py - ay - t * dy)
          if (d < best) { best = d; hit = e }
        }
      }
    }
    if (hit < 0) continue
    for (const m of [g.edgeA[hit], g.edgeB[hit]]) {
      g.edge(n, m, distLL(g, n, m), g.edgeCls[hit], [px, py, g.nodeX[m], g.nodeY[m]])
    }
  }

  // d. それでも行き止まりのノードから、近いノード 2 つまでへ「仮の市区町村道」を張る（z12 に無い市区町村道の代わり）。
  //    高速どうしはつながない（高速の行き止まり = ランプの終わりを、近くの一般道へつなぐ）
  for (const n of deadEnds) {
    if (g.adj[n].length !== 1) continue
    const own = g.adj[n][0]
    const r = COARSE.gapM / metersPerUnit(g.nodeLat[n])
    const cands = g.nodesNear(g.nodeX[n], g.nodeY[n], r)
      .filter((m) => m !== n && m < baseNodes && m !== g.edgeA[own] && m !== g.edgeB[own] && !(mw[n] && mw[m]))
      .map((m) => [distLL(g, n, m), m] as const)
      .sort((x, y) => x[0] - y[0])
      .slice(0, COARSE.gapLinks)
    for (const [d, m] of cands) g.edge(n, m, d * COARSE.gapFactor, VIRTUAL_CLASS, [g.nodeX[n], g.nodeY[n], g.nodeX[m], g.nodeY[m]])
  }
  return g
}

/**
 * 粗いグラフで、from から to への経路の線（z14 の世界座標の x, y の並び）を探す。見つからなければ null。
 * 始点・終点は、近い粗いノードへ「仮の市区町村道」でつなぐ。グラフは書き換えない（仮の部分は終わったら外す）
 */
export function coarsePath(g: CoarseGraph, from: LatLng, to: LatLng, params: SearchParams, shouldStop?: () => boolean): number[] | null {
  const baseNodes = g.nodeX.length
  const baseEdges = g.edgeA.length
  const builder = g as Builder
  const attach = (p: LatLng): number | null => {
    const [x, y] = latLngToWorld(p.lat, p.lng)
    const n = builder.addNode(x, y)
    const mpu = metersPerUnit(p.lat)
    let found: (readonly [number, number])[] = []
    for (let rM = COARSE.attachRadiusStartM; rM <= COARSE.attachRadiusMaxM; rM *= 2) {
      found = builder.nodesNear(x, y, rM / mpu)
        .filter((m) => m < baseNodes && g.adj[m].some((e) => g.edgeCls[e] <= params.maxClass))
        .map((m) => [haversine(p.lat, p.lng, g.nodeLat[m], g.nodeLng[m]), m] as const)
      if (found.length >= COARSE.attachMinFound) break
    }
    found.sort((a, b) => a[0] - b[0])
    for (const [d, m] of found.slice(0, COARSE.attachLinks)) {
      builder.edge(n, m, d * COARSE.gapFactor, VIRTUAL_CLASS, [x, y, g.nodeX[m], g.nodeY[m]], false)
    }
    return g.adj[n].length > 0 ? n : null
  }
  try {
    const a = attach(from)
    const b = attach(to)
    if (a === null || b === null) return null
    const r = search(g, { edge: g.adj[a][0], t: 0, ...from }, { edge: g.adj[b][0], t: 0, ...to }, params, shouldStop)
    if (!r) return null
    const out: number[] = []
    for (const s of r.steps) {
      if (s.from === s.to) continue
      const pts = g.edgePts[s.edge]
      const fwd = s.to > s.from
      for (let i = 0; i < pts.length; i += 2) {
        const j = fwd ? i : pts.length - 2 - i
        out.push(pts[j], pts[j + 1])
      }
    }
    return out.length >= 4 ? out : null
  } finally {
    // 仮のノード・辺を外す
    for (let e = g.edgeA.length - 1; e >= baseEdges; e--) {
      const ea = g.edgeA[e], eb = g.edgeB[e]
      g.adj[ea] = g.adj[ea].filter((x) => x !== e)
      g.adj[eb] = g.adj[eb].filter((x) => x !== e)
    }
    for (const arr of [g.edgeA, g.edgeB, g.edgeLen, g.edgeCls, g.edgePts]) arr.length = baseEdges
    for (const arr of [g.nodeX, g.nodeY, g.nodeLat, g.nodeLng, g.adj]) arr.length = baseNodes
  }
}
