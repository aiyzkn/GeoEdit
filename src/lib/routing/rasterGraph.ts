// 地図画像（標準地図）の色の付いた道を、経路探索のグラフに足す（経路の元の選択設計書 §3.1〜§3.3）。
//   - RasterRoadSource: 区間のまわりの z16 の画像を取り、道の種類に分けて覚え、骨格の線（世界座標）にする
//   - addRasterRoads: 骨格の線を RoadGraph に足す。hybrid では、ベクトルに同じ道がある所を除き、端をベクトルの道へつなぐ
// 単体テストから直接 import できるよう、'@/' エイリアスを使わない。

import { latLngToWorld, metersPerUnit } from './geo.ts'
import { RoadGraph } from './graph.ts'
import type { RasterSource } from './lane.ts'
import { classifyRoadImage, extractRoadSkeleton, markOutlineRoads, RK_GENERAL, RK_MOTORWAY, RK_NATIONAL, type RoadKind } from './rasterRoads.ts'
import type { LatLng, RoadTile } from './types.ts'

/** 道をたどる画像のズーム（設計書 §4.3。z17 は重すぎる） */
export const RASTER_ROAD_ZOOM = 16
/** 地図画像のみ（raster）で、白い一般道を輪郭から取り出す画像のズーム（利用者が主に見る z17） */
export const RASTER_OUTLINE_ZOOM = 17
/** 画素 1 つ = 世界座標（z14 × 4096）の何単位か（z16 で 4、z17 で 2） */
const unitsPerPx = (z: number) => 2 ** (14 + 12 - 8 - z)
/** z16 の画素 1 つ = 世界座標の 4 単位 */
const UNITS_PER_PX = unitsPerPx(RASTER_ROAD_ZOOM)

export const RASTER_ROADS = {
  /** 始点–終点の線分から両側に取る幅（m。§3.3） */
  corridorM: 1200,
  /** 1 区間で取る画像の枚数の上限（§3.3） */
  maxTiles: 300,
  /** 並べた画像の大きさの上限（画素。斜めの長い区間で外接矩形が大きくなりすぎないため） */
  maxPixels: 32_000_000,
  /** 分類した画像を覚えておく枚数 */
  cacheTiles: 400,
  /** 同じ種類の骨格へ架ける橋（m）・別の種類への橋（m）（§2.3 の試しの値） */
  bridgeM: 80,
  crossBridgeM: 25,
  /** ベクトルに同じ道がある、とみなす距離（m。高速は帯が太く、上下線が別の線のことがあるので広め） */
  coveredMotorwayM: 25,
  coveredRoadM: 15,
  /** ベクトルに無い区間として残す長さの下限（m。ベクトルの線から少し離れただけの所を足さない） */
  minRunM: 40,
  /** 残した区間の端を、ベクトルの道へつなぐ距離（m。§3.2 の 4） */
  connectM: 30,
  /** 骨格の線を間引く許容（画素） */
  simplifyPx: 1.5,
} as const

/** 地図画像のみ（raster）で、輪郭から一般道を取り出すときの値（z17） */
export const RASTER_OUTLINE = {
  /** 回廊の幅（両側。m）: 区間の長さ × ratio を、min〜max に収める */
  corridorRatio: 0.3,
  corridorMinM: 300,
  corridorMaxM: 1200,
  /** 1 区間で取る画像の枚数・並べた画像の大きさの上限。超えたら、色の付いた道だけ（z16）に戻す */
  maxTiles: 600,
  maxPixels: 40_000_000,
  /** 一般道どうしの橋（m）。行き止まりの道へ架けすぎないよう短く */
  generalBridgeM: 12,
} as const

/** 骨格の線（世界座標）。kind は道の種類（rasterRoads.ts の RK_*） */
export interface RasterRoadLine {
  kind: RoadKind
  /** [x0, y0, x1, y1, …] 世界座標 */
  coords: number[]
}

export type RasterLinesResult =
  | { ok: true; lines: RasterRoadLine[]; tiles: number }
  | { ok: false; reason: 'too-large' | 'tile-error' | 'aborted' }

/** 道の種類 → グラフの階級（設計書 §3.2 の 3） */
export function classOfKind(kind: RoadKind): number {
  return kind === RK_MOTORWAY ? 6 : kind === RK_NATIONAL ? 4 : kind === RK_GENERAL ? 2 : 3
}

/** 区間のまわりの画像の道の骨格を作る。画像のタイルは分類した形で覚える */
export class RasterRoadSource {
  private readonly cache = new Map<string, Uint8Array | null>()

  private readonly source: RasterSource
  private readonly opts: { cacheTiles?: number; outline?: boolean }
  /** 画像のズーム（色の付いた道だけなら z16、輪郭から一般道も取るなら z17） */
  readonly zoom: number

  /** outline = true なら、z17 の画像から白い一般道も輪郭で取り出す（地図画像のみ。設計書 §9） */
  constructor(source: RasterSource, opts: { cacheTiles?: number; outline?: boolean } = {}) {
    this.source = source
    this.opts = opts
    this.zoom = opts.outline ? RASTER_OUTLINE_ZOOM : RASTER_ROAD_ZOOM
  }

  /** 始点–終点の線分のまわり（両側 corridorM）の、zoom のタイルの番号 */
  static corridorTiles(from: LatLng, to: LatLng, corridorM: number = RASTER_ROADS.corridorM, zoom: number = RASTER_ROAD_ZOOM): { x: number; y: number }[] {
    const upp = unitsPerPx(zoom)
    const [ax, ay] = latLngToWorld(from.lat, from.lng).map((v) => v / upp)
    const [bx, by] = latLngToWorld(to.lat, to.lng).map((v) => v / upp)
    const mpp = metersPerUnit((from.lat + to.lat) / 2) * upp
    const pad = corridorM / mpp
    const reach = pad + 256 * Math.SQRT1_2 // タイルの中心から角まで
    const out: { x: number; y: number }[] = []
    const tx0 = Math.floor((Math.min(ax, bx) - pad) / 256), tx1 = Math.floor((Math.max(ax, bx) + pad) / 256)
    const ty0 = Math.floor((Math.min(ay, by) - pad) / 256), ty1 = Math.floor((Math.max(ay, by) + pad) / 256)
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const cx = tx * 256 + 128, cy = ty * 256 + 128
        let f = L2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / L2 : 0
        f = Math.max(0, Math.min(1, f))
        if (Math.hypot(cx - ax - f * dx, cy - ay - f * dy) <= reach) out.push({ x: tx, y: ty })
      }
    }
    return out
  }

  async lines(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<RasterLinesResult> {
    const outline = this.opts.outline === true
    const upp = unitsPerPx(this.zoom)
    const corridorM = outline
      ? Math.min(RASTER_OUTLINE.corridorMaxM, Math.max(RASTER_OUTLINE.corridorMinM, RASTER_OUTLINE.corridorRatio * distanceM(from, to)))
      : RASTER_ROADS.corridorM
    const keys = RasterRoadSource.corridorTiles(from, to, corridorM, this.zoom)
    if (keys.length > (outline ? RASTER_OUTLINE.maxTiles : RASTER_ROADS.maxTiles)) return { ok: false, reason: 'too-large' }
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity
    for (const k of keys) { tx0 = Math.min(tx0, k.x); ty0 = Math.min(ty0, k.y); tx1 = Math.max(tx1, k.x); ty1 = Math.max(ty1, k.y) }
    const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256
    if (W * H > (outline ? RASTER_OUTLINE.maxPixels : RASTER_ROADS.maxPixels)) return { ok: false, reason: 'too-large' }

    let kinds: (Uint8Array | null)[]
    try {
      kinds = await Promise.all(keys.map((k) => this.tile(k.x, k.y, signal)))
    } catch {
      return { ok: false, reason: signal?.aborted ? 'aborted' : 'tile-error' }
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' }
    const kind = new Uint8Array(W * H)
    keys.forEach((k, i) => {
      const t = kinds[i]
      if (!t) return
      const ox = (k.x - tx0) * 256, oy = (k.y - ty0) * 256
      for (let j = 0; j < 256; j++) kind.set(t.subarray(j * 256, j * 256 + 256), (oy + j) * W + ox)
    })
    const mpp = metersPerUnit((from.lat + to.lat) / 2) * upp
    const sk = extractRoadSkeleton({ width: W, height: H, kind }, {
      bridgePx: Math.round(RASTER_ROADS.bridgeM / mpp),
      crossBridgePx: Math.round(RASTER_ROADS.crossBridgeM / mpp),
      generalBridgePx: Math.round(RASTER_OUTLINE.generalBridgeM / mpp),
    })
    const gx0 = tx0 * 256, gy0 = ty0 * 256
    const half = upp / 2
    const lines: RasterRoadLine[] = []
    for (const e of sk.edges) {
      const pts = simplify(e.points, RASTER_ROADS.simplifyPx)
      const coords: number[] = []
      for (let i = 0; i < pts.length; i += 2) coords.push((pts[i] + gx0) * upp + half, (pts[i + 1] + gy0) * upp + half)
      if (coords.length >= 4) lines.push({ kind: e.kind, coords })
    }
    return { ok: true, lines, tiles: keys.length }
  }

  private async tile(x: number, y: number, signal?: AbortSignal): Promise<Uint8Array | null> {
    const key = `${x}/${y}`
    if (this.cache.has(key)) {
      const hit = this.cache.get(key)!
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const t = await this.source(this.zoom, x, y, signal)
    const kind = t && t.width === 256 && t.height === 256 ? classifyRoadImage(t.data, 256, 256).kind : null
    if (kind && t && this.opts.outline) markOutlineRoads(t.data, kind, 256, 256)
    this.cache.set(key, kind)
    const max = this.opts.cacheTiles ?? RASTER_ROADS.cacheTiles
    while (this.cache.size > max) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return kind
  }
}

function distanceM(a: LatLng, b: LatLng): number {
  const [ax, ay] = latLngToWorld(a.lat, a.lng)
  const [bx, by] = latLngToWorld(b.lat, b.lng)
  return Math.hypot(bx - ax, by - ay) * metersPerUnit((a.lat + b.lat) / 2)
}

/** Douglas–Peucker（[x0, y0, …]。両端は残す） */
export function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2
  if (n <= 2) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1]
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy)
    let best = -1, bd = tol
    for (let k = i + 1; k < j; k++) {
      const px = pts[2 * k] - ax, py = pts[2 * k + 1] - ay
      const d = L > 0 ? Math.abs(px * dy - py * dx) / L : Math.hypot(px, py)
      if (d > bd) { bd = d; best = k }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]) }
  }
  const out: number[] = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[2 * k], pts[2 * k + 1])
  return out
}

/** 点 (px, py) から最も近い、使える辺の上の位置（世界座標で reach 以内）。classes を渡せば、その階級の辺だけ */
function nearestOnGraph(g: RoadGraph, px: number, py: number, reach: number, classes?: (c: number) => boolean):
  { e: number; k: number; f: number; d: number; x: number; y: number } | null {
  const near = g.segmentsNear(px - reach, py - reach, px + reach, py + reach)
  let best: { e: number; k: number; f: number; d: number; x: number; y: number } | null = null
  for (let i = 0; i < near.length; i += 2) {
    const e = near[i], k = near[i + 1]
    if (g.edgeSrc[e] > 0) continue
    const c = g.edgeCls[e]
    if (c > 6 || (classes && !classes(c))) continue
    const [ax, ay] = g.shapePoint(e, k - 1)
    const [bx, by] = g.shapePoint(e, k)
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy
    let f = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
    f = Math.max(0, Math.min(1, f))
    const x = ax + f * dx, y = ay + f * dy
    const d = Math.hypot(px - x, py - y)
    if (d > reach) continue
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && e < best.e)) best = { e, k, f, d, x, y }
  }
  return best
}

const isMotorwayClass = (c: number) => c >= 5
const isRoadClass = (c: number) => c >= 2 && c <= 5

export interface AddRasterResult {
  /** 足した線の数 */
  lines: number
  /** ベクトルの道へつないだ端の数 */
  connections: number
}

/**
 * 画像の骨格の線を、グラフ g に足す（g は呼ぶ側が作った、この区間だけのグラフ。辺を分けるので書き換わる）。
 * hybrid = true なら、ベクトルに同じ道がある所を除き（§3.2 の 3）、残した区間の端をベクトルの道へつなぐ（§3.2 の 4）。
 * false（raster）なら、骨格の線をそのまま足す
 */
export function addRasterRoads(g: RoadGraph, lines: RasterRoadLine[], hybrid: boolean, lat: number): AddRasterResult {
  const mpu = metersPerUnit(lat)
  const out: { cls: number; src: number; med: number; struct: number; lv: number; coords: number[] }[] = []
  let connections = 0
  if (!hybrid) {
    for (const l of lines) out.push({ cls: classOfKind(l.kind), src: 1, med: 0, struct: 0, lv: 0, coords: l.coords })
  } else {
    // 1. ベクトルに無い区間だけを残す
    type Run = { kind: RoadKind; coords: number[] }
    const runs: Run[] = []
    for (const l of lines) {
      const mw = l.kind === RK_MOTORWAY
      const reach = (mw ? RASTER_ROADS.coveredMotorwayM : RASTER_ROADS.coveredRoadM) / mpu
      const dense = densify(l.coords, 10 / mpu)
      let cur: number[] = []
      const flush = () => {
        if (cur.length >= 4 && polyLen(cur) * mpu >= RASTER_ROADS.minRunM) runs.push({ kind: l.kind, coords: simplify(cur, RASTER_ROADS.simplifyPx * UNITS_PER_PX) })
        cur = []
      }
      for (let i = 0; i < dense.length; i += 2) {
        const covered = nearestOnGraph(g, dense[i], dense[i + 1], reach, mw ? isMotorwayClass : isRoadClass) !== null
        if (covered) flush()
        else cur.push(dense[i], dense[i + 1])
      }
      flush()
    }
    // 2. 残した区間の端を、近くのベクトルの道へ（高速は、まず高速・有料へ）
    const splits = new Map<number, { k: number; f: number; x: number; y: number }[]>()
    const connReach = RASTER_ROADS.connectM / mpu
    for (const r of runs) {
      const c = r.coords
      for (const end of [0, 1]) {
        const i = end === 0 ? 0 : c.length - 2
        const px = c[i], py = c[i + 1]
        const hit = (r.kind === RK_MOTORWAY ? nearestOnGraph(g, px, py, connReach, isMotorwayClass) : null)
          ?? nearestOnGraph(g, px, py, connReach)
        if (!hit) continue
        const x = Math.round(hit.x), y = Math.round(hit.y)
        let arr = splits.get(hit.e)
        if (!arr) { arr = []; splits.set(hit.e, arr) }
        const same = arr.find((s) => s.x === x && s.y === y)
        if (!same) arr.push({ k: hit.k, f: hit.f, x, y })
        // つなぐ線（端 → 道の上の点）
        out.push({ cls: classOfKind(r.kind), src: 2, med: 0, struct: 0, lv: 0, coords: [x, y, px, py] })
        connections++
      }
      out.push({ cls: classOfKind(r.kind), src: 1, med: 0, struct: 0, lv: 0, coords: c })
    }
    // 3. つないだ辺を、つないだ点で分ける（元の辺は使わなくし、分けた辺を足す）
    for (const [e, pts] of splits) {
      pts.sort((p, q) => p.k - q.k || p.f - q.f)
      const n = g.shapeLength(e)
      const pieces: number[][] = []
      let cur: number[] = [g.nodeX[g.edgeA[e]], g.nodeY[g.edgeA[e]]]
      let si = 0
      for (let k = 1; k < n; k++) {
        while (si < pts.length && pts[si].k === k) {
          const s = pts[si++]
          const lx = cur[cur.length - 2], ly = cur[cur.length - 1]
          if (lx !== s.x || ly !== s.y) cur.push(s.x, s.y)
          if (cur.length >= 4) { pieces.push(cur); cur = [s.x, s.y] }
        }
        const [x, y] = k === n - 1 ? [g.nodeX[g.edgeB[e]], g.nodeY[g.edgeB[e]]] : g.shapePoint(e, k)
        if (cur[cur.length - 2] !== x || cur[cur.length - 1] !== y) cur.push(x, y)
      }
      if (cur.length >= 4) pieces.push(cur)
      const attrs = { cls: g.edgeCls[e], src: 0, med: g.edgeMed[e], struct: g.edgeStruct[e], lv: g.edgeLv[e] }
      g.disableEdge(e)
      for (const p of pieces) out.push({ ...attrs, coords: p })
    }
  }
  if (out.length > 0) g.addTile(toTile(out))
  return { lines: out.length, connections }
}

/** グラフに 1 枚として足す、作った線の入れ物（タイルの番号は負の数。ベクトルタイルと重ならない） */
let synthetic = 0
function toTile(lines: { cls: number; src: number; med: number; struct: number; lv: number; coords: number[] }[]): RoadTile {
  const count = lines.length
  const start = new Uint32Array(count + 1)
  let n = 0
  lines.forEach((l, i) => { start[i] = n; n += l.coords.length / 2 })
  start[count] = n
  const coords = new Int32Array(n * 2)
  lines.forEach((l, i) => { for (let j = 0; j < l.coords.length; j++) coords[start[i] * 2 + j] = Math.round(l.coords[j]) })
  synthetic++
  return {
    x: -synthetic, y: -synthetic, count,
    cls: Uint8Array.from(lines, (l) => l.cls),
    lv: Uint8Array.from(lines, (l) => l.lv),
    struct: Uint8Array.from(lines, (l) => l.struct),
    med: Uint8Array.from(lines, (l) => l.med),
    src: Uint8Array.from(lines, (l) => l.src),
    start, coords,
  }
}

/** 点の間隔が step 以下になるよう点を足す */
function densify(c: number[], step: number): number[] {
  const out = [c[0], c[1]]
  for (let i = 2; i < c.length; i += 2) {
    const ax = c[i - 2], ay = c[i - 1], bx = c[i], by = c[i + 1]
    const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let j = 1; j <= m; j++) out.push(ax + ((bx - ax) * j) / m, ay + ((by - ay) * j) / m)
  }
  return out
}

function polyLen(c: number[]): number {
  let len = 0
  for (let i = 2; i < c.length; i += 2) len += Math.hypot(c[i] - c[i - 2], c[i + 1] - c[i - 1])
  return len
}

/**
 * 2 本の線（緯度経度）が似ているか（設計書 §3.1）: 互いの最も離れた所（20 m おきの点で見る）が maxGapM 以下で、
 * 道のりの差が maxLenRatio 以下
 */
export function similarPaths(p: LatLng[], q: LatLng[], maxGapM = 50, maxLenRatio = 0.05): boolean {
  if (p.length < 2 || q.length < 2) return false
  const lat = p[0].lat
  const mpu = metersPerUnit(lat)
  const w = (pts: LatLng[]) => { const out: number[] = []; for (const x of pts) { const [a, b] = latLngToWorld(x.lat, x.lng); out.push(a, b) } return out }
  const P = w(p), Q = w(q)
  const lp = polyLen(P) * mpu, lq = polyLen(Q) * mpu
  if (Math.abs(lp - lq) > maxLenRatio * Math.max(lp, lq)) return false
  const gap = maxGapM / mpu
  const within = (A: number[], B: number[]) => {
    const s = densify(A, 20 / mpu)
    for (let i = 0; i < s.length; i += 2) if (distToPoly(s[i], s[i + 1], B) > gap) return false
    return true
  }
  return within(P, Q) && within(Q, P)
}

function distToPoly(px: number, py: number, c: number[]): number {
  let best = Infinity
  for (let i = 2; i < c.length; i += 2) {
    const ax = c[i - 2], ay = c[i - 1], dx = c[i] - ax, dy = c[i + 1] - ay, L2 = dx * dx + dy * dy
    let f = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
    f = Math.max(0, Math.min(1, f))
    best = Math.min(best, Math.hypot(px - ax - f * dx, py - ay - f * dy))
  }
  return best
}
