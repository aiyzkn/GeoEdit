// 地理院ベクトルタイル（experimental_bvmap）の road レイヤーの取得・デコード・キャッシュ（詳細設計書 §2・§3.1・§3.2）。

import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { EXTENT } from './geo.ts'
import { roadClassOf, roadLevelOf, roadStructOf } from './roadClass.ts'
import type { RoadTile, TileBytesLoader } from './types.ts'

export const ROAD_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf'

/** 折れ線（タイル内の座標）を、タイルの範囲 [0, E] × [0, E] で切る。切り口は四捨五入して整数にする */
export function clipLine(pts: number[], E = EXTENT): number[][] {
  const out: number[][] = []
  let cur: number[] | null = null
  const n = pts.length / 2
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3]
    const dx = bx - ax, dy = by - ay
    let t0 = 0, t1 = 1, ok = true
    const clipTerms: [number, number][] = [[-dx, ax], [dx, E - ax], [-dy, ay], [dy, E - ay]]
    for (const [p, q] of clipTerms) {
      if (p === 0) {
        if (q < 0) { ok = false; break }
      } else {
        const r = q / p
        if (p < 0) { if (r > t1) { ok = false; break } if (r > t0) t0 = r }
        else { if (r < t0) { ok = false; break } if (r < t1) t1 = r }
      }
    }
    if (!ok) { if (cur) { out.push(cur); cur = null } continue }
    const pax = t0 === 0 ? ax : Math.round(ax + dx * t0), pay = t0 === 0 ? ay : Math.round(ay + dy * t0)
    const pbx = t1 === 1 ? bx : Math.round(ax + dx * t1), pby = t1 === 1 ? by : Math.round(ay + dy * t1)
    if (!cur) cur = [pax, pay]
    else if (cur[cur.length - 2] !== pax || cur[cur.length - 1] !== pay) { out.push(cur); cur = [pax, pay] }
    if (pbx !== pax || pby !== pay) cur.push(pbx, pby)
    if (t1 < 1) { out.push(cur); cur = null }
  }
  if (cur) out.push(cur)
  return out.filter((l) => l.length >= 4)
}

interface RawLine { cls: number; lv: number; struct: number; local: number[] }

/** 線（タイル内の座標）の配列から RoadTile を作る。単体テストの補助にも使う */
export function buildRoadTile(x: number, y: number, lines: RawLine[]): RoadTile {
  const kept: RawLine[] = []
  for (const l of lines) for (const c of clipLine(l.local)) kept.push({ ...l, local: c })
  const count = kept.length
  let nPts = 0
  for (const l of kept) nPts += l.local.length / 2
  const tile: RoadTile = {
    x, y, count,
    cls: new Uint8Array(count), lv: new Uint8Array(count), struct: new Uint8Array(count),
    start: new Uint32Array(count + 1), coords: new Int32Array(nPts * 2),
  }
  let p = 0
  kept.forEach((l, i) => {
    tile.cls[i] = l.cls
    tile.lv[i] = l.lv
    tile.struct[i] = l.struct
    tile.start[i] = p
    for (let k = 0; k < l.local.length; k += 2) {
      tile.coords[2 * p] = x * EXTENT + l.local[k]
      tile.coords[2 * p + 1] = y * EXTENT + l.local[k + 1]
      p++
    }
  })
  tile.start[count] = p
  return tile
}

export function emptyRoadTile(x: number, y: number): RoadTile {
  return buildRoadTile(x, y, [])
}

/** pbf をデコードし、road の道路中心線だけを残す（純粋関数） */
export function decodeRoadTile(x: number, y: number, bytes: ArrayBuffer | Uint8Array): RoadTile {
  const vt = new VectorTile(new Pbf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))
  const layer = vt.layers.road
  if (!layer) return emptyRoadTile(x, y)
  const k = EXTENT / layer.extent
  const lines: RawLine[] = []
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    if (f.type !== 2) continue
    const cls = roadClassOf(f.properties)
    if (cls === 0) continue
    const lv = roadLevelOf(f.properties)
    const struct = roadStructOf(f.properties)
    for (const ring of f.loadGeometry()) {
      const local: number[] = []
      for (const q of ring) local.push(Math.round(q.x * k), Math.round(q.y * k))
      lines.push({ cls, lv, struct, local })
    }
  }
  return buildRoadTile(x, y, lines)
}

/** 地理院のサーバーから、ズーム zoom のタイルを取る loader。404 は null。ほかの失敗は例外 */
export function makeRoadTileLoader(zoom: number): TileBytesLoader {
  return async (x, y, signal) => {
    const url = ROAD_TILE_URL.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y))
    const res = await fetch(url, { signal })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`道路タイルの取得に失敗しました: HTTP ${res.status} ${url}`)
    return res.arrayBuffer()
  }
}

/** z14（経路の線を作るズーム） */
export const fetchRoadTileBytes: TileBytesLoader = makeRoadTileLoader(14)
/** z12（長い区間の粗い探索。§6.2） */
export const fetchCoarseRoadTileBytes: TileBytesLoader = makeRoadTileLoader(12)

function abortError(): Error {
  const e = new Error('aborted')
  e.name = 'AbortError'
  return e
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/** LRU のタイルキャッシュ。同時取得の数を抑え、同じタイルの要求はまとめる */
export class RoadTileCache {
  private readonly loader: TileBytesLoader
  private readonly max: number
  private readonly concurrency: number
  private readonly tiles = new Map<string, RoadTile>()
  private readonly inflight = new Map<string, Promise<RoadTile>>()
  private active = 0
  private readonly waiters: (() => void)[] = []

  constructor(loader: TileBytesLoader, opts: { max?: number; concurrency?: number } = {}) {
    this.loader = loader
    this.max = opts.max ?? 400
    this.concurrency = opts.concurrency ?? 6
  }

  has(x: number, y: number): boolean {
    return this.tiles.has(`${x}/${y}`)
  }

  /** 取得済みならそれを返す（LRU の順を更新する） */
  peek(x: number, y: number): RoadTile | undefined {
    const key = `${x}/${y}`
    const t = this.tiles.get(key)
    if (t) { this.tiles.delete(key); this.tiles.set(key, t) }
    return t
  }

  async get(x: number, y: number, signal?: AbortSignal): Promise<RoadTile> {
    const hit = this.peek(x, y)
    if (hit) return hit
    const key = `${x}/${y}`
    let p = this.inflight.get(key)
    if (!p) {
      // 取得そのものは、最初に頼んだ要求の signal に縛らない（あとから同じタイルを頼んだ要求のため）
      p = this.load(x, y).finally(() => this.inflight.delete(key))
      this.inflight.set(key, p)
    }
    if (!signal) return p
    if (signal.aborted) throw abortError()
    return new Promise<RoadTile>((resolve, reject) => {
      const onAbort = () => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      p!.then(
        (t) => { signal.removeEventListener('abort', onAbort); resolve(t) },
        (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
      )
    })
  }

  async getMany(
    keys: { x: number; y: number }[],
    signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<RoadTile[]> {
    let done = 0
    const total = keys.length
    onProgress?.(0, total)
    return Promise.all(keys.map(async ({ x, y }) => {
      const t = await this.get(x, y, signal)
      done++
      onProgress?.(done, total)
      return t
    }))
  }

  private async load(x: number, y: number): Promise<RoadTile> {
    await this.acquire()
    try {
      let bytes: ArrayBuffer | null
      try {
        bytes = await this.loader(x, y)
      } catch {
        bytes = await this.loader(x, y) // 1 回だけやり直す
      }
      const tile = bytes ? decodeRoadTile(x, y, bytes) : emptyRoadTile(x, y)
      this.put(`${x}/${y}`, tile)
      return tile
    } finally {
      this.release()
    }
  }

  private put(key: string, tile: RoadTile) {
    this.tiles.set(key, tile)
    while (this.tiles.size > this.max) {
      const oldest = this.tiles.keys().next().value
      if (oldest === undefined) break
      this.tiles.delete(oldest)
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) { this.active++; return Promise.resolve() }
    return new Promise((resolve) => this.waiters.push(() => { this.active++; resolve() }))
  }

  private release() {
    this.active--
    const next = this.waiters.shift()
    if (next) next()
  }
}
