// 経路探索の公開 API（詳細設計書 §7.1）。DOM・Leaflet に依存しない。

import { directRadius, planLeg, tilesAroundSegment, tilesAroundWorldSegment, CORRIDOR } from './corridor.ts'
import { buildCoarseGraph, coarsePath, COARSE_ZOOM, type CoarseGraph } from './coarse.ts'
import { distanceLL, latLngToWorld, metersPerUnit, pathDistance, round7 } from './geo.ts'
import { RoadGraph } from './graph.ts'
import { fetchCoarseRoadTileBytes, fetchRoadTileBytes, isAbortError, RoadTileCache } from './roadTiles.ts'
import { LaneMatcher, type RasterSource } from './lane.ts'
import { browserStdRaster } from './raster.ts'
import { search } from './search.ts'
import { snapToGraph } from './snap.ts'
import { DEFAULT_MATCH_PARAMS, matchTrack as matchTrackOnGraph, type MatchParams } from './match.ts'
import type { FallbackReason, GraphPos, LatLng, RouteResult, RoutingOptions, SearchStep, TileBytesLoader } from './types.ts'

export type { FallbackReason, LatLng, RoadClass, RouteResult, RoutingOptions } from './types.ts'
export { DEFAULT_MATCH_PARAMS, type MatchParams } from './match.ts'

/** トラックのマップマッチングの結果の区間。input は入力の点の番号の範囲（両端を含む） */
export type TrackMatchSection =
  | { kind: 'matched'; input: [number, number]; points: LatLng[]; anchors: { input: number; at: LatLng }[] }
  | { kind: 'kept'; input: [number, number]; points: LatLng[] }

export interface TrackMatchResult {
  sections: TrackMatchSection[]
  /** 区間をつないだ点の列（つなぎ目の重なりを除く） */
  points: LatLng[]
  /** 観測に使った点の数と、そのうち道に合わせられた数 */
  observed: number
  matched: number
}

/** これを超えたら、グラフを捨てて、いま要るタイルだけで作り直す（§3.3） */
const MAX_GRAPH_EDGES = 1_500_000
/** 置いた位置から道が遠いとき（snap.radius 以内に道が無いとき）に、直線で結んでよい距離（§5） */
const CONNECT_RADIUS_M = 300
/** 粗いグラフ（z12）を取る範囲: 始点–終点の線分から max(10 km, 0.25 × 直線距離) */
const COARSE_MARGIN_MIN_M = 10_000
const COARSE_MARGIN_RATIO = 0.25
/** 粗いグラフを覚えておく数（ドラッグ中に作り直さないため） */
const COARSE_GRAPH_CACHE = 4

type TileKey = { x: number; y: number }
/** 本線に挟まれた「分離帯なしの高速」を本線とみなす長さの上限（m）と、まっすぐとみなす角度（cos 15°） */
const MAINLINE_GAP_M = 800
const MAINLINE_STRAIGHT_COS = 0.966
/** 分離帯のある辺に挟まれた、分離帯の無い辺をまとめて車線合わせの区間に入れる長さの上限（m） */
const LANE_BRIDGE_EDGE_M = 50
/** マップマッチングで、軌跡のまわりに取るタイルの余白（候補の半径に足す。m） */
const MATCH_TILE_MARGIN_M = 200
/** マップマッチングで取るタイルの上限（z14。約 2.4 km 四方。これを超える長い軌跡は分けて頼む） */
const MATCH_MAX_TILES = 600

type Progress = (done: number, total: number) => void

function fallback(from: LatLng, to: LatLng, reason: FallbackReason): RouteResult {
  const points = [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }]
  return { status: 'fallback', points, distance: distanceLL(from, to), reason }
}

function same(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9
}

export class Router {
  private readonly cache: RoadTileCache
  private readonly coarseCache: RoadTileCache
  private readonly coarseGraphs = new Map<string, CoarseGraph>()
  private graph = new RoadGraph()
  private readonly lane: LaneMatcher | null

  constructor(
    loader: TileBytesLoader = fetchRoadTileBytes,
    opts: { cacheTiles?: number; concurrency?: number; coarseLoader?: TileBytesLoader; raster?: RasterSource | null } = {},
  ) {
    // 画像の車線に合わせる処理（§13）。raster を省略したら、ブラウザなら標準地図を取る。Node では使わない
    const raster = opts.raster === undefined ? browserStdRaster() : opts.raster
    this.lane = raster ? new LaneMatcher(raster) : null
    this.cache = new RoadTileCache(loader, { max: opts.cacheTiles, concurrency: opts.concurrency })
    this.coarseCache = new RoadTileCache(opts.coarseLoader ?? fetchCoarseRoadTileBytes, { max: 400, concurrency: opts.concurrency })
  }

  /** 置いた位置を、近くの道へ寄せる。道が無ければ null（例外は投げない） */
  async snap(at: LatLng, options: RoutingOptions, signal?: AbortSignal): Promise<LatLng | null> {
    try {
      await this.ensureTiles(tilesAroundSegment(at, at, options.snap.radius + options.snap.bias), signal)
    } catch {
      return null
    }
    const pos = snapToGraph(this.graph, at.lat, at.lng, options.snap)
    return pos ? { lat: round7(pos.lat), lng: round7(pos.lng) } : null
  }

  /** 2 点の間を探索する。失敗しても throw せず、直線の fallback を返す */
  async routeLeg(from: LatLng, to: LatLng, options: RoutingOptions, signal?: AbortSignal, onProgress?: Progress): Promise<RouteResult> {
    const d = distanceLL(from, to)
    const plan = planLeg(d)
    if (plan.kind === 'too-long') return fallback(from, to, 'too-long')
    try {
      let tiles: TileKey[] | null
      if (plan.kind === 'direct') {
        tiles = tilesAroundSegment(from, to, plan.radiusM)
      } else {
        // 2 段階（§6.2）: 粗い経路のまわりの回廊。見つからなければ、短い区間は 1 段階でやり直す
        tiles = await this.corridorTiles(from, to, d, options, signal)
        if (!tiles) {
          if (d > CORRIDOR.retryDirectMaxKm * 1000) return fallback(from, to, signal?.aborted ? 'aborted' : 'no-route')
          tiles = tilesAroundSegment(from, to, directRadius(d))
        }
      }
      // 点のまわりも（道まで遠いときの接続のため）
      for (const p of [from, to]) for (const t of tilesAroundSegment(p, p, CORRIDOR.pointRadiusM)) tiles.push(t)
      await this.ensureTiles(dedupeTiles(tiles), signal, onProgress)
    } catch (e) {
      return fallback(from, to, isAbortError(e) || signal?.aborted ? 'aborted' : 'tile-error')
    }
    if (signal?.aborted) return fallback(from, to, 'aborted')

    const g = this.graph
    const a = this.snapForRoute(from, options)
    const b = this.snapForRoute(to, options)
    if (!a || !b) return fallback(from, to, 'no-road')

    const res = search(g, a, b, options.params, () => signal?.aborted === true)
    if (signal?.aborted) return fallback(from, to, 'aborted')
    if (!res) return fallback(from, to, 'no-route')

    const pts: LatLng[] = [{ lat: from.lat, lng: from.lng }]
    const push = (p: LatLng) => {
      const q = { lat: round7(p.lat), lng: round7(p.lng) }
      if (!same(pts[pts.length - 1], q)) pts.push(q)
    }
    push(a)
    for (const p of await this.stepsToPoints(a, res.steps, options, signal)) push(p)
    if (signal?.aborted) return fallback(from, to, 'aborted')
    push(b)
    const last = { lat: to.lat, lng: to.lng }
    if (!same(pts[pts.length - 1], last)) pts.push(last)
    else pts[pts.length - 1] = last
    if (pts.length === 1) pts.push(last)
    return { status: 'ok', points: pts, distance: pathDistance(pts) }
  }

  /**
   * 既存の軌跡を道に合わせる（トラックのマップマッチング設計書）。軌跡のまわりのタイルを取り、matchTrack() で道を選び、
   * 道の区間を routeLeg() と同じ方法（車線合わせを含む）で線にする。道が見つからない区間は、元の点を残す。
   * 失敗しても throw しない（null = タイルを取れない・中止）
   */
  async matchTrack(points: LatLng[], options: RoutingOptions, match: MatchParams = DEFAULT_MATCH_PARAMS, signal?: AbortSignal, onProgress?: Progress): Promise<TrackMatchResult | null> {
    if (points.length < 2) return null
    try {
      const tiles: TileKey[] = []
      for (let i = 1; i < points.length; i++) for (const t of tilesAroundSegment(points[i - 1], points[i], match.radiusM + MATCH_TILE_MARGIN_M)) tiles.push(t)
      const keys = dedupeTiles(tiles)
      if (keys.length > MATCH_MAX_TILES) return null
      await this.ensureTiles(keys, signal, onProgress)
    } catch {
      return null
    }
    if (signal?.aborted) return null
    const m = matchTrackOnGraph(this.graph, points, { ...match, maxClass: Math.min(match.maxClass, options.params.maxClass) }, () => signal?.aborted === true)
    if (!m || signal?.aborted) return null
    const sections: TrackMatchSection[] = []
    for (const s of m.sections) {
      if (s.kind === 'kept') {
        sections.push({ kind: 'kept', input: s.input, points: points.slice(s.input[0], s.input[1] + 1).map((p) => ({ lat: p.lat, lng: p.lng })) })
        continue
      }
      const pts: LatLng[] = [{ lat: round7(s.start.lat), lng: round7(s.start.lng) }]
      for (const p of await this.stepsToPoints(s.start, s.steps, options, signal)) {
        const q = { lat: round7(p.lat), lng: round7(p.lng) }
        if (!same(pts[pts.length - 1], q)) pts.push(q)
      }
      if (signal?.aborted) return null
      if (pts.length === 1) pts.push({ lat: round7(s.end.lat), lng: round7(s.end.lng) })
      sections.push({ kind: 'matched', input: s.input, points: pts, anchors: s.anchors })
    }
    const all: LatLng[] = []
    for (const s of sections) for (const p of s.points) if (all.length === 0 || !same(all[all.length - 1], p)) all.push(p)
    return { sections, points: all, observed: m.observed, matched: m.matched }
  }

  /**
   * 探索・マップマッチングの結果の辺の並びを、点の列にする（start から始まる。start と同じ点が先頭に入る。重なりは呼び出し側で除く）。
   * 分離帯のある一般道・高速の本線は、地図画像の車線に合わせる（§13・§14.5）
   */
  private async stepsToPoints(start: LatLng, allSteps: SearchStep[], options: RoutingOptions, signal?: AbortSignal): Promise<LatLng[]> {
    const g = this.graph
    // 辺ごとの点列を、種類ごとの区間にまとめる。
    //   div = 分離帯のある一般道（1 本の線）: 地図画像の車線に合わせる（§13）
    //   mw = 高速道路の本線（上下線を兼ねる 1 本の線）: 進む向きの左側の車道の中心へ（§14.5）
    //   ramp = 高速道路のランプ、plain = そのほか: そのまま
    // 上下線が別々の線になっている道路（一方通行と推定できた辺）は、線がすでに車道ごとにあるので合わせない
    type Kind = 'div' | 'mw' | 'ramp' | 'plain'
    const steps = allSteps.filter((st) => st.from !== st.to)
    const lenOf = (st: (typeof steps)[number]) => Math.abs(st.to - st.from) * g.edgeLen[st.edge]
    const useLane = options.lane === true && this.lane !== null
    const kinds: Kind[] = steps.map((st) => {
      const e = st.edge
      const single = g.edgeMed[e] === 1 && g.oneway(e) === 0
      if (g.edgeCls[e] === 6) return g.edgeMed[e] !== 1 ? 'ramp' : single && useLane ? 'mw' : 'plain'
      return single && useLane ? 'div' : 'plain'
    })
    // 分離帯のある辺に挟まれた短い辺（交差点の中など。属性が分離帯なしになっている）も、同じ区間に入れる
    for (let i = 0; i < steps.length; i++) {
      if (kinds[i] !== 'plain') continue
      let j = i, len = 0
      while (j < steps.length && kinds[j] === 'plain') { len += lenOf(steps[j]); j++ }
      if (i > 0 && j < steps.length && kinds[i - 1] === 'div' && kinds[j] === 'div' && len <= LANE_BRIDGE_EDGE_M) for (let k = i; k < j; k++) kinds[k] = 'div'
      i = j - 1
    }
    // 本線に挟まれた「分離帯なしの高速」で、まっすぐ続いているものは、本線のデータの抜けとして本線に入れる
    // （関越道の池田の橋の付近 245 m が、属性では分離帯なしになっている）
    if (useLane) {
      for (let i = 0; i < steps.length; i++) {
        if (kinds[i] !== 'ramp') continue
        let j = i, len = 0
        while (j < steps.length && kinds[j] === 'ramp') { len += lenOf(steps[j]); j++ }
        if (i > 0 && j < steps.length && kinds[i - 1] === 'mw' && kinds[j] === 'mw' && len <= MAINLINE_GAP_M) {
          let straight = true
          for (let k = i; k <= j && straight; k++) {
            const p = steps[k - 1], q = steps[k]
            if (g.turnDot(p.edge, p.to > p.from ? 0 : 1, q.edge, q.to > q.from ? 0 : 1) < MAINLINE_STRAIGHT_COS) straight = false
          }
          if (straight) for (let k = i; k < j; k++) kinds[k] = 'mw'
        }
        i = j - 1
      }
    }
    const segs: { kind: Kind; pts: LatLng[] }[] = []
    let cursor: LatLng = { lat: round7(start.lat), lng: round7(start.lng) }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const shape = g.subShape(s.edge, s.from, s.to)
      let seg = segs[segs.length - 1]
      if (!seg || seg.kind !== kinds[i]) { seg = { kind: kinds[i], pts: [cursor] }; segs.push(seg) }
      for (const p of shape) if (!same(seg.pts[seg.pts.length - 1], p)) seg.pts.push(p)
      cursor = seg.pts[seg.pts.length - 1]
    }
    for (let i = 0; i < segs.length && this.lane; i++) {
      const seg = segs[i]
      if (signal?.aborted) break
      if (seg.pts.length < 2) continue
      if (seg.kind === 'div') {
        seg.pts = await this.lane.correct(seg.pts, signal)
      } else if (seg.kind === 'mw') {
        // 左へ分かれる・左から合流するランプとの間は、車線に寄せたままつなぐ（中央へ戻さない）
        const prev = segs[i - 1], next = segs[i + 1]
        const n = seg.pts.length
        const node0 = seg.pts[0], node1 = seg.pts[n - 1], dir0 = seg.pts[1], dir1 = seg.pts[n - 2]
        const joinStart = prev?.kind === 'ramp' && rampSide(node0, dir0, prev.pts, true) > 0
        const joinEnd = next?.kind === 'ramp' && rampSide(node1, dir1, next.pts, false) > 0
        const fixed = await this.lane.correct(seg.pts, signal, { motorway: true, taperStart: !joinStart, taperEnd: !joinEnd })
        if (fixed === seg.pts) continue // 合わせられなかった
        if (joinStart) prev.pts = trimRamp(prev.pts, node0, dir0, fixed[0], true)
        if (joinEnd) next.pts = trimRamp(next.pts, node1, dir1, fixed[fixed.length - 1], false)
        seg.pts = fixed
      }
    }
    const out: LatLng[] = []
    for (const seg of segs) for (const p of seg.pts) out.push(p)
    return out
  }

  /**
   * 2 段階の 1 段目: z12 の粗いグラフで経路の見当をつけ、そのまわりの z14 のタイルを返す（§6.2）。
   * 高速を使える設定のときは「高速なし」でも探索し、両方の経路を回廊に入れる。経路が無ければ null
   */
  private async corridorTiles(from: LatLng, to: LatLng, d: number, options: RoutingOptions, signal?: AbortSignal): Promise<TileKey[] | null> {
    const margin = Math.max(COARSE_MARGIN_MIN_M, COARSE_MARGIN_RATIO * d)
    const keys = dedupeTiles(tilesAroundSegment(from, to, margin, COARSE_ZOOM))
    const g = await this.coarseGraph(keys, signal)
    const variants = [options.params]
    if (options.params.maxClass > 4) variants.push({ ...options.params, maxClass: 4 })
    const paths: number[][] = []
    for (const params of variants) {
      const p = coarsePath(g, from, to, params, () => signal?.aborted === true)
      if (p) paths.push(p)
    }
    if (paths.length === 0) return null
    const r = CORRIDOR.bufferM / metersPerUnit((from.lat + to.lat) / 2)
    const out: TileKey[] = []
    for (const pts of paths) {
      for (let i = 2; i < pts.length; i += 2) {
        for (const t of tilesAroundWorldSegment(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], r)) out.push(t)
      }
    }
    for (const p of [from, to]) for (const t of tilesAroundSegment(p, p, CORRIDOR.endRadiusM)) out.push(t)
    return out
  }

  private async coarseGraph(keys: TileKey[], signal?: AbortSignal): Promise<CoarseGraph> {
    const id = keys.map((k) => `${k.x}/${k.y}`).sort().join(',')
    const hit = this.coarseGraphs.get(id)
    if (hit) {
      this.coarseGraphs.delete(id)
      this.coarseGraphs.set(id, hit)
      return hit
    }
    const tiles = await this.coarseCache.getMany(keys, signal)
    const g = buildCoarseGraph(tiles)
    this.coarseGraphs.set(id, g)
    while (this.coarseGraphs.size > COARSE_GRAPH_CACHE) {
      const oldest = this.coarseGraphs.keys().next().value
      if (oldest === undefined) break
      this.coarseGraphs.delete(oldest)
    }
    return g
  }

  /** snap.radius 以内の道へ。無ければ 300 m 以内の道へ（その間は直線で結ぶ）。それも無ければ null */
  private snapForRoute(p: LatLng, options: RoutingOptions): GraphPos | null {
    return snapToGraph(this.graph, p.lat, p.lng, options.snap)
      ?? snapToGraph(this.graph, p.lat, p.lng, { ...options.snap, radius: Math.max(CONNECT_RADIUS_M, options.snap.radius) })
  }

  private async ensureTiles(keys: { x: number; y: number }[], signal?: AbortSignal, onProgress?: Progress) {
    const missing = keys.filter((k) => !this.graph.hasTile(k.x, k.y))
    if (missing.length === 0) return
    const tiles = await this.cache.getMany(missing, signal, onProgress)
    if (this.graph.edgeCount > MAX_GRAPH_EDGES) {
      // 作り直す。タイルの中身はキャッシュにあるので、通信は起きない
      const g = new RoadGraph()
      for (const k of keys) {
        const t = this.cache.peek(k.x, k.y)
        if (t) g.addTile(t)
      }
      this.graph = g
      return
    }
    for (const t of tiles) this.graph.addTile(t)
  }
}

/** 本線の端 node（そこから本線の中へ向かう点 inner）から見て、ランプが本線の進む向きの左にあれば正、右なら負 */
function rampSide(node: LatLng, inner: LatLng, ramp: LatLng[], rampIsBefore: boolean): number {
  const [nx, ny] = latLngToWorld(node.lat, node.lng)
  const [ix, iy] = latLngToWorld(inner.lat, inner.lng)
  // 本線の進む向き: ランプが手前（合流）なら node → inner、先（分岐）なら inner → node
  let tx = rampIsBefore ? ix - nx : nx - ix, ty = rampIsBefore ? iy - ny : ny - iy
  const L = Math.hypot(tx, ty) || 1
  tx /= L; ty /= L
  // ランプの、ノードから約 60 m（120 格子）離れた点
  const order = rampIsBefore ? [...ramp].reverse() : ramp
  let far = order[order.length - 1]
  for (const p of order) {
    const [px, py] = latLngToWorld(p.lat, p.lng)
    if (Math.hypot(px - nx, py - ny) >= 120) { far = p; break }
  }
  const [fx, fy] = latLngToWorld(far.lat, far.lng)
  return (fx - nx) * ty - (fy - ny) * tx // 画面の座標（y が下向き）で、正 = 左
}

/**
 * 車線に寄せた本線の端 shifted と、ランプをなめらかにつなぐ: ランプの線のうち、本線の中央（node）から
 * 寄せた車線の位置までを横切る部分（ノードに近い側）を落とす
 */
function trimRamp(ramp: LatLng[], node: LatLng, inner: LatLng, shifted: LatLng, rampIsBefore: boolean): LatLng[] {
  const [nx, ny] = latLngToWorld(node.lat, node.lng)
  const [ix, iy] = latLngToWorld(inner.lat, inner.lng)
  const [sx, sy] = latLngToWorld(shifted.lat, shifted.lng)
  let tx = rampIsBefore ? ix - nx : nx - ix, ty = rampIsBefore ? iy - ny : ny - iy
  const L = Math.hypot(tx, ty) || 1
  tx /= L; ty /= L
  const d = (sx - nx) * ty - (sy - ny) * tx // 寄せた量（左が正）
  if (!(d > 0)) return ramp
  const lateral = (p: LatLng) => { const [px, py] = latLngToWorld(p.lat, p.lng); return (px - nx) * ty - (py - ny) * tx }
  const dist = (p: LatLng) => { const [px, py] = latLngToWorld(p.lat, p.lng); return Math.hypot(px - nx, py - ny) }
  const order = rampIsBefore ? [...ramp].reverse() : [...ramp]
  // ノードに近い側から、まだ車線の位置より内側（中央寄り）にある点を落とす。300 m（600 格子）までで、最後の 1 点は残す
  let k = 0
  while (k < order.length - 1 && dist(order[k]) < 600 && lateral(order[k]) < d + 2) k++
  const kept = order.slice(k)
  return rampIsBefore ? kept.reverse() : kept
}

function dedupeTiles(keys: TileKey[]): TileKey[] {
  const seen = new Set<string>()
  const out: { x: number; y: number }[] = []
  for (const k of keys) {
    const s = `${k.x}/${k.y}`
    if (seen.has(s)) continue
    seen.add(s)
    out.push(k)
  }
  return out
}
