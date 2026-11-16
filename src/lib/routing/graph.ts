// タイル → 道路グラフ（詳細設計書 §3.3・§3.4）。足していくだけのグラフ。

import { EXTENT, haversine, worldToLatLng } from './geo.ts'
import type { LatLng, RoadTile } from './types.ts'

const KEY_MUL = 2 ** 26
const CELL = 256 // 空間索引のマス（格子。z14 で約 120 m）
const CELL_MUL = 2 ** 20

function nodeKey(x: number, y: number): number {
  return x * KEY_MUL + y
}

export class RoadGraph {
  nodeX: number[] = []
  nodeY: number[] = []
  nodeLat: number[] = []
  nodeLng: number[] = []
  nodeBoundary: boolean[] = []
  adj: number[][] = []

  edgeA: number[] = []
  edgeB: number[] = []
  edgeLen: number[] = []
  edgeCls: number[] = []
  edgeLv: number[] = []
  edgeStruct: number[] = []
  /** 1 = 分離帯あり */
  edgeMed: number[] = []
  edgeTile: number[] = []
  /** 形: tiles[edgeTile].coords の点の番号 edgeFrom 〜 edgeTo（両端を含む） */
  edgeFrom: number[] = []
  edgeTo: number[] = []

  tiles: RoadTile[] = []

  private readonly nodeIndex = new Map<number, number>()
  private readonly tileIndex = new Set<string>()
  private readonly edgeSig = new Set<string>()
  /** マス → [辺, 線分の番号（形の中の k。点 k-1 → k）] の並び */
  private readonly cells = new Map<number, number[]>()
  private readonly cumCache = new Map<number, Float64Array>()

  get edgeCount(): number {
    return this.edgeA.length
  }

  get nodeCount(): number {
    return this.nodeX.length
  }

  hasTile(x: number, y: number): boolean {
    return this.tileIndex.has(`${x}/${y}`)
  }

  addTile(tile: RoadTile): void {
    const tkey = `${tile.x}/${tile.y}`
    if (this.tileIndex.has(tkey)) return
    this.tileIndex.add(tkey)
    const ti = this.tiles.length
    this.tiles.push(tile)
    const c = tile.coords
    const x0 = tile.x * EXTENT, y0 = tile.y * EXTENT

    // 1. このタイルの線の端点
    const ends = new Set<number>()
    for (let i = 0; i < tile.count; i++) {
      const s = tile.start[i], e = tile.start[i + 1] - 1
      ends.add(nodeKey(c[2 * s], c[2 * s + 1]))
      ends.add(nodeKey(c[2 * e], c[2 * e + 1]))
    }

    const nodeAt = (p: number): number => {
      const wx = c[2 * p], wy = c[2 * p + 1]
      const lx = wx - x0, ly = wy - y0
      const onV = lx === 0 || lx === EXTENT
      const onH = ly === 0 || ly === EXTENT
      const k = nodeKey(wx, wy)
      const hit = this.nodeIndex.get(k)
      if (hit !== undefined) return hit
      if (onV || onH) {
        // 2. 境界の上の端点は、同じ境界線に沿って ±1 の「境界のノード」へ寄せる（§3.2）
        const cands: number[] = []
        if (onV) cands.push(nodeKey(wx, wy - 1), nodeKey(wx, wy + 1))
        if (onH) cands.push(nodeKey(wx - 1, wy), nodeKey(wx + 1, wy))
        for (const ck of cands) {
          const n = this.nodeIndex.get(ck)
          if (n !== undefined && this.nodeBoundary[n]) return n
        }
      }
      const n = this.nodeX.length
      this.nodeX.push(wx)
      this.nodeY.push(wy)
      const ll = worldToLatLng(wx, wy)
      this.nodeLat.push(ll.lat)
      this.nodeLng.push(ll.lng)
      this.nodeBoundary.push(onV || onH)
      this.adj.push([])
      this.nodeIndex.set(k, n)
      return n
    }

    for (let i = 0; i < tile.count; i++) {
      const s = tile.start[i], e = tile.start[i + 1] - 1
      // 3. 線の途中の点が端点と一致するところで分ける
      let from = s
      for (let p = s + 1; p < e; p++) {
        if (ends.has(nodeKey(c[2 * p], c[2 * p + 1]))) {
          this.pushEdge(ti, i, from, p, nodeAt)
          from = p
        }
      }
      this.pushEdge(ti, i, from, e, nodeAt)
    }
  }

  private pushEdge(ti: number, line: number, from: number, to: number, nodeAt: (p: number) => number) {
    const tile = this.tiles[ti]
    const c = tile.coords
    const a = nodeAt(from), b = nodeAt(to)
    if (a === b && to - from <= 1) return
    let len = 0
    let prev = worldToLatLng(c[2 * from], c[2 * from + 1])
    for (let p = from + 1; p <= to; p++) {
      const ll = worldToLatLng(c[2 * p], c[2 * p + 1])
      len += haversine(prev.lat, prev.lng, ll.lat, ll.lng)
      prev = ll
    }
    if (len === 0 && a === b) return
    const sig = `${Math.min(a, b)}_${Math.max(a, b)}_${to - from}_${Math.round(len * 10)}`
    if (this.edgeSig.has(sig)) return // 境界の上をちょうど通る線は、両方のタイルに入る
    this.edgeSig.add(sig)
    const ei = this.edgeA.length
    this.edgeA.push(a)
    this.edgeB.push(b)
    this.edgeLen.push(len)
    this.edgeCls.push(tile.cls[line])
    this.edgeLv.push(tile.lv[line])
    this.edgeStruct.push(tile.struct[line])
    this.edgeMed.push(tile.med[line])
    this.edgeTile.push(ti)
    this.edgeFrom.push(from)
    this.edgeTo.push(to)
    this.adj[a].push(ei)
    if (b !== a) this.adj[b].push(ei)
    for (let p = from + 1; p <= to; p++) {
      const ax = c[2 * p - 2], ay = c[2 * p - 1], bx = c[2 * p], by = c[2 * p + 1]
      const cx0 = Math.floor(Math.min(ax, bx) / CELL), cx1 = Math.floor(Math.max(ax, bx) / CELL)
      const cy0 = Math.floor(Math.min(ay, by) / CELL), cy1 = Math.floor(Math.max(ay, by) / CELL)
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const ck = cx * CELL_MUL + cy
          let arr = this.cells.get(ck)
          if (!arr) { arr = []; this.cells.set(ck, arr) }
          arr.push(ei, p - from)
        }
      }
    }
  }

  /** 辺の形（世界座標。a → b の向き）の点の数 */
  shapeLength(e: number): number {
    return this.edgeTo[e] - this.edgeFrom[e] + 1
  }

  /** 辺の形の k 番目の点（世界座標） */
  shapePoint(e: number, k: number): [number, number] {
    const c = this.tiles[this.edgeTile[e]].coords
    const p = this.edgeFrom[e] + k
    return [c[2 * p], c[2 * p + 1]]
  }

  /** 辺の形の、a 端からの累積の道のり（m）。最後の値は edgeLen と同じ */
  cumulative(e: number): Float64Array {
    let cum = this.cumCache.get(e)
    if (cum) return cum
    const n = this.shapeLength(e)
    cum = new Float64Array(n)
    let prev = worldToLatLng(...this.shapePoint(e, 0))
    for (let k = 1; k < n; k++) {
      const ll = worldToLatLng(...this.shapePoint(e, k))
      cum[k] = cum[k - 1] + haversine(prev.lat, prev.lng, ll.lat, ll.lng)
      prev = ll
    }
    if (this.cumCache.size > 5000) this.cumCache.clear()
    this.cumCache.set(e, cum)
    return cum
  }

  /** 辺の上の割合 t の位置 */
  pointAt(e: number, t: number): LatLng {
    const cum = this.cumulative(e)
    const n = cum.length
    const target = Math.max(0, Math.min(1, t)) * cum[n - 1]
    let k = 1
    while (k < n - 1 && cum[k] < target) k++
    const seg = cum[k] - cum[k - 1]
    const f = seg > 0 ? (target - cum[k - 1]) / seg : 0
    const [ax, ay] = this.shapePoint(e, k - 1)
    const [bx, by] = this.shapePoint(e, k)
    return worldToLatLng(ax + (bx - ax) * f, ay + (by - ay) * f)
  }

  /** 辺の上の t0 → t1 の部分の点列（両端を含む。t0 > t1 なら b → a の向き） */
  subShape(e: number, t0: number, t1: number): LatLng[] {
    const cum = this.cumulative(e)
    const n = cum.length
    const L = cum[n - 1]
    const lo = Math.min(t0, t1) * L, hi = Math.max(t0, t1) * L
    const pts: LatLng[] = [this.pointAt(e, Math.min(t0, t1))]
    for (let k = 1; k < n - 1; k++) {
      if (cum[k] > lo && cum[k] < hi) pts.push(worldToLatLng(...this.shapePoint(e, k)))
    }
    pts.push(this.pointAt(e, Math.max(t0, t1)))
    return t0 > t1 ? pts.reverse() : pts
  }

  /** 世界座標の矩形にかかる [辺, 線分の番号] の並び（重複あり） */
  segmentsNear(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const out: number[] = []
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        const arr = this.cells.get(cx * CELL_MUL + cy)
        if (arr) for (const v of arr) out.push(v)
      }
    }
    return out
  }
}
