// タイル → 道路グラフ（詳細設計書 §3.3・§3.4）。足していくだけのグラフ。

import { EXTENT, haversine, metersPerUnit, worldToLatLng } from './geo.ts'
import type { LatLng, RoadTile } from './types.ts'

const KEY_MUL = 2 ** 26
const CELL = 256 // 空間索引のマス（格子。z14 で約 120 m）
const CELL_MUL = 2 ** 20

/** 一方通行の推定と、高速道路での曲がり方の値（§14） */
export const ONEWAY = {
  /** 相手の線を探す距離（高速 / 分離帯のある一般道） */
  reachMotorwayM: 45,
  reachDividedM: 30,
  /** ランプの対（並んで走る出口と入口）を探す距離 */
  reachRampM: 30,
  /** 弱い一方通行（ランプの対）を逆向きに通るときの罰則（m 相当。辺ごと） */
  softWrongWayM: 3000,
  /** これより近い線は、相手とみなさない（同じ線の重なりなど） */
  minGapM: 3,
  /** 平行とみなす角度（cos 25°） */
  parallelCos: 0.906,
  /** 高速道路どうしで進める角度の上限（cos 100°。これより鋭い折り返しは禁止） */
  maxTurnCos: -0.17,
  /** 本線とランプの間で、左への分岐・合流とみなす: 右へこれ以下のずれ（sin 3°）は直進として許す。角度は 75° まで */
  straightSin: 0.05,
  rampMinCos: 0.26,
  /** 右側のランプ（反対向きの車線のランプと見られる）を使うときの罰則（m 相当） */
  wrongSideRampM: 5000,
} as const

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
  /** 辺 → [一方通行の向き, 求めたときのタイルの枚数]。タイルが増えたら求め直す（隣のタイルに相手の線があることがある） */
  private readonly onewayCache = new Map<number, [number, number]>()
  readonly softWrongWayCost = ONEWAY.softWrongWayM

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

  /** 辺 e の、a からの道のりの割合 t の点と、その点での進む向き（a → b。単位ベクトル。世界座標） */
  private pointAndTangent(e: number, t: number): [number, number, number, number] {
    const cum = this.cumulative(e)
    const n = cum.length
    const target = Math.max(0, Math.min(1, t)) * cum[n - 1]
    let k = 1
    while (k < n - 1 && cum[k] < target) k++
    const [ax, ay] = this.shapePoint(e, k - 1)
    const [bx, by] = this.shapePoint(e, k)
    const seg = cum[k] - cum[k - 1]
    const f = seg > 0 ? (target - cum[k - 1]) / seg : 0
    const L = Math.hypot(bx - ax, by - ay) || 1
    return [ax + (bx - ax) * f, ay + (by - ay) * f, (bx - ax) / L, (by - ay) / L]
  }

  /**
   * 一方通行の向きを推定する（§14）: 1 = a → b だけ、-1 = b → a だけ、0 = 両方向（分からない）。
   * ±2 は弱い一方通行（高速のランプの対。逆向きは罰則つきで通れる）。
   * タイルに一方通行の属性は無いが、高速道路と分離帯のある道路は、上下線が別々の線になっていることがある。
   * 近くに平行な相手の線があれば、日本は左側通行なので「相手の線が右側に来る向き」だけを通れるとする。
   * 両側に平行な線がある（ランプ・側道が並ぶ）所は決めない
   */
  oneway(e: number): number {
    const hit = this.onewayCache.get(e)
    if (hit && hit[1] === this.tiles.length) return hit[0]
    const v = this.computeOneway(e)
    this.onewayCache.set(e, [v, this.tiles.length])
    return v
  }

  private computeOneway(e: number): number {
    const cls = this.edgeCls[e]
    const isMw = cls === 6
    // 対象: 分離帯のある線（上下線が別々の線になっている本線・一般道）と、高速のランプ（分離帯なし。2 本並ぶ出入口の対）。
    // ランプの対は、同じ向きの 2 本が並ぶ所もありうるので「弱い一方通行」（±2。逆向きは罰則つきで通れる）にする
    const isRamp = isMw && !this.edgeMed[e]
    if (!this.edgeMed[e] && !isRamp) return 0
    if (this.edgeLen[e] < 5) return 0
    const mpu = metersPerUnit(this.nodeLat[this.edgeA[e]])
    const reach = (isRamp ? ONEWAY.reachRampM : isMw ? ONEWAY.reachMotorwayM : ONEWAY.reachDividedM) / mpu
    const minGap = ONEWAY.minGapM / mpu
    let votes = 0, samples = 0
    for (const t of [0.25, 0.5, 0.75]) {
      const [px, py, tx, ty] = this.pointAndTangent(e, t)
      const near = this.segmentsNear(px - reach, py - reach, px + reach, py + reach)
      let left = false, right = false
      for (let i = 0; i < near.length; i += 2) {
        const o = near[i], k = near[i + 1]
        if (o === e) continue
        // 相手は、同じ階級で、同じ種類の線（本線どうし = 分離帯あり、ランプどうし = 分離帯なし）。
        // 本線の横を並んで走るランプを「反対向きの車線」と取り違えないため
        if (this.edgeCls[o] !== cls || this.edgeMed[o] !== this.edgeMed[e]) continue
        // つながっている線（分岐・合流の直後で並んでいるだけ）は相手にしない
        if (this.sharesNode(e, o)) continue
        const [ax, ay] = this.shapePoint(o, k - 1)
        const [bx, by] = this.shapePoint(o, k)
        const dx = bx - ax, dy = by - ay
        const L = Math.hypot(dx, dy)
        if (L === 0) continue
        if (Math.abs((dx * tx + dy * ty) / L) < ONEWAY.parallelCos) continue // 平行でない
        // p から進む向きに直交する線を引いて、相手の線分と交わる所
        const f = ((px - ax) * dx + (py - ay) * dy) / (L * L)
        if (f < 0 || f > 1) continue
        const qx = ax + dx * f - px, qy = ay + dy * f - py
        const along = qx * tx + qy * ty
        const side = qx * ty - qy * tx // 画面の座標（y が下向き）で、正 = 進む向きの左
        const dist = Math.abs(side)
        if (dist < minGap || dist > reach || Math.abs(along) > dist) continue
        if (side > 0) left = true
        else right = true
      }
      if (left === right) continue // どちらにも無い・両側にある
      samples++
      votes += right ? 1 : -1
    }
    if (samples === 0 || Math.abs(votes) !== samples) return 0 // 点によって結果が割れた
    return (votes > 0 ? 1 : -1) * (isRamp ? 2 : 1)
  }

  /** 2 つの辺が、同じノードでじかにつながっているか（分岐・合流の直後で並んでいるだけの線） */
  private sharesNode(e: number, o: number): boolean {
    return this.adj[this.edgeA[e]].includes(o) || this.adj[this.edgeB[e]].includes(o)
  }

  /** 辺 e を dir（0 = a → b、1 = b → a）の向きに通るときの、端（'in' = 入る側、'out' = 出る側）での進む向き */
  private heading(e: number, dir: number, end: 'in' | 'out', minDist = 8): [number, number] {
    const n = this.shapeLength(e)
    // 端から 8 格子（約 4 m）以上離れた最初の点までの向き（端の短い線分の向きの乱れを避ける）
    const fromStart = (dir === 0) === (end === 'in')
    const [x0, y0] = this.shapePoint(e, fromStart ? 0 : n - 1)
    let x1 = x0, y1 = y0
    for (let i = 1; i < n; i++) {
      ;[x1, y1] = this.shapePoint(e, fromStart ? i : n - 1 - i)
      if (Math.hypot(x1 - x0, y1 - y0) >= minDist) break
    }
    const L = Math.hypot(x1 - x0, y1 - y0) || 1
    const sx = (x1 - x0) / L, sy = (y1 - y0) / L
    // 'in' は端から中へ向かう向き = 進む向き。'out' は端へ向かう向き = 進む向きなので、逆にする
    return end === 'in' ? [sx, sy] : [-sx, -sy]
  }

  /** 辺 e1（向き dir1）から辺 e2（向き dir2）へ進むときの、進む向きの変化の cos（1 = まっすぐ） */
  turnDot(e1: number, dir1: number, e2: number, dir2: number): number {
    const [ax, ay] = this.heading(e1, dir1, 'out')
    const [bx, by] = this.heading(e2, dir2, 'in')
    return ax * bx + ay * by
  }

  /**
   * 辺 e1 のあとに辺 e2 へ進むときに足すコスト（§14）。高速道路どうしのつなぎ目だけを見る。
   * - 折り返し・鋭い角度（100° 超）は進めない（本線での U ターン、ランプの逆走を防ぐ）
   * - 本線（分離帯のある 1 本の線。上下線を兼ねる）とランプ（分離帯の無い線）の間は、
   *   日本は左側通行なので「浅い角度の左への分岐・左からの合流」だけが正しい。
   *   右への分岐・右からの合流は、反対向きの車線のランプなので、大きな罰則を足す
   *   （右側に出入口がある所もあるので、禁止にはしない）
   */
  turnCost(e1: number, dir1: number, e2: number, dir2: number): number {
    if (this.edgeCls[e1] === 6 && this.edgeCls[e2] === 6) {
      if (e1 === e2) return Infinity
      const [ax, ay] = this.heading(e1, dir1, 'out')
      const [bx, by] = this.heading(e2, dir2, 'in')
      const dot = ax * bx + ay * by
      const left = bx * ay - by * ax // 画面の座標（y が下向き）で、正 = 左へ曲がる
      if (dot < ONEWAY.maxTurnCos) return Infinity
      if (this.edgeMed[e1] === this.edgeMed[e2]) return 0 // 本線どうし・ランプどうし
      return left >= -ONEWAY.straightSin && dot >= ONEWAY.rampMinCos ? 0 : ONEWAY.wrongSideRampM
    }
    // ランプと一般道の間: 鋭い折り返し（100° 超）だけに罰則を足す（西行きへ合流するランプから東へ向かう、など）。
    // ランプは短い直角の線で一般道の中心線につながることがあるので、端から 40 m（80 格子）手前までの向きで見る。
    // 左右は見ない（信号のある交差点では右折もできる）
    const mw1 = this.edgeCls[e1] === 6, mw2 = this.edgeCls[e2] === 6
    if (mw1 === mw2) return 0
    const [ax, ay] = this.heading(e1, dir1, 'out', mw1 ? 80 : 8)
    const [bx, by] = this.heading(e2, dir2, 'in', mw2 ? 80 : 8)
    return ax * bx + ay * by < ONEWAY.maxTurnCos ? ONEWAY.wrongSideRampM : 0
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
