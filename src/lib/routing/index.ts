// 経路探索の公開 API（詳細設計書 §7.1）。DOM・Leaflet に依存しない。

import { directRadius, planLeg, tilesAroundSegment, tilesAroundWorldSegment, CORRIDOR } from './corridor.ts'
import { buildCoarseGraph, coarsePath, COARSE_ZOOM, type CoarseGraph } from './coarse.ts'
import { distanceLL, metersPerUnit, pathDistance, round7 } from './geo.ts'
import { RoadGraph } from './graph.ts'
import { fetchCoarseRoadTileBytes, fetchRoadTileBytes, isAbortError, RoadTileCache } from './roadTiles.ts'
import { search, stepsToPoints } from './search.ts'
import { snapToGraph } from './snap.ts'
import type { FallbackReason, GraphPos, LatLng, RouteResult, RoutingOptions, TileBytesLoader } from './types.ts'

export type { FallbackReason, LatLng, RouteResult, RoutingOptions } from './types.ts'

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

  constructor(
    loader: TileBytesLoader = fetchRoadTileBytes,
    opts: { cacheTiles?: number; concurrency?: number; coarseLoader?: TileBytesLoader } = {},
  ) {
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
    for (const p of stepsToPoints(g, res.steps)) push(p)
    push(b)
    const last = { lat: to.lat, lng: to.lng }
    if (!same(pts[pts.length - 1], last)) pts.push(last)
    else pts[pts.length - 1] = last
    if (pts.length === 1) pts.push(last)
    return { status: 'ok', points: pts, distance: pathDistance(pts) }
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
