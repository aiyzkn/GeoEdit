// 国土地理院の標高タイル（PNG）から標高を読む（designs/機能追加・UI改善設計書.md B6）。
// 1 枚（256 × 256）で、その範囲の点をすべてまかなえる。1 点ごとに API を呼ぶ方式より、点が多いときに速い。
// 単体テストから直接 import できるよう、'@/' エイリアスを使わない。

export interface LatLng {
  lat: number
  lng: number
}

/** RGBA の画像。取れない・無いときは null */
export interface DemImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}
export type DemTileSource = (layer: DemLayer, z: number, x: number, y: number, signal?: AbortSignal) => Promise<DemImage | null>

export interface DemLayer {
  id: string
  zoom: number
}

/** 先に 5 m メッシュ（z15）、無効なら 10 m メッシュ（z14） */
export const DEM_LAYERS: DemLayer[] = [
  { id: 'dem5a_png', zoom: 15 },
  { id: 'dem_png', zoom: 14 },
]

export const DEM_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/{id}/{z}/{x}/{y}.png'

const INVALID = 2 ** 23
const CACHE_MAX = 64
const CONCURRENCY = 6

/** 画素 → 標高（m）。無効な画素は null。0.1 m に丸める */
export function decodeDemPixel(r: number, g: number, b: number, a = 255): number | null {
  if (a === 0) return null // 透明（タイルの外・読み込みの失敗）
  const x = r * 65536 + g * 256 + b
  if (x === INVALID) return null
  const m = x < INVALID ? x * 0.01 : (x - 2 ** 24) * 0.01
  return Math.round(m * 10) / 10
}

/** 緯度経度 → タイル番号と、その中の画素 */
export function pixelOf(lat: number, lng: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z
  const fx = ((lng + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  const x = Math.floor(fx), y = Math.floor(fy)
  return { x, y, px: Math.min(255, Math.floor((fx - x) * 256)), py: Math.min(255, Math.floor((fy - y) * 256)) }
}

/** ブラウザ（と Worker）で画像を取って画素を読む。使えない環境では null を返すだけの source になる */
export const browserDemSource: DemTileSource = async (layer, z, x, y, signal) => {
  if (typeof createImageBitmap === 'undefined') return null
  const url = DEM_TILE_URL.replace('{id}', layer.id).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  const res = await fetch(url, { signal, mode: 'cors' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`標高タイルの取得に失敗しました: HTTP ${res.status}`)
  // 色が変わらないように、色空間の変換と、アルファの乗算をしない
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  try {
    let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      ctx = c.getContext('2d', { willReadFrequently: true })
    }
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0)
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height)
    return { width: img.width, height: img.height, data: img.data }
  } finally {
    bmp.close()
  }
}

/** デコードした標高（NaN = 無効）を、タイルごとに覚える */
export class DemTileReader {
  private readonly source: DemTileSource
  private readonly cache = new Map<string, Float32Array | null>()

  constructor(source: DemTileSource = browserDemSource) {
    this.source = source
  }

  private async load(layer: DemLayer, x: number, y: number, signal?: AbortSignal): Promise<Float32Array | null> {
    const key = `${layer.id}/${x}/${y}`
    if (this.cache.has(key)) {
      const v = this.cache.get(key)!
      this.cache.delete(key)
      this.cache.set(key, v)
      return v
    }
    let out: Float32Array | null = null
    try {
      const img = await this.source(layer, layer.zoom, x, y, signal)
      if (img && img.width === 256 && img.height === 256) {
        out = new Float32Array(256 * 256)
        const d = img.data
        for (let i = 0; i < out.length; i++) {
          const v = decodeDemPixel(d[4 * i], d[4 * i + 1], d[4 * i + 2], d[4 * i + 3])
          out[i] = v === null ? NaN : v
        }
      }
      this.cache.set(key, out) // 404・大きさ違いは「無い」と覚える
    } catch {
      return null // 通信などの失敗は覚えない
    }
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return out
  }

  /** 点ごとの標高。タイルが無い・無効な点は null */
  async elevations(points: LatLng[], signal?: AbortSignal): Promise<(number | null)[]> {
    const result: (number | null)[] = points.map(() => null)
    let remaining = points.map((_, i) => i)
    for (const layer of DEM_LAYERS) {
      if (remaining.length === 0) break
      // タイルごとに点をまとめる
      const groups = new Map<string, { x: number; y: number; items: { i: number; px: number; py: number }[] }>()
      for (const i of remaining) {
        const p = pixelOf(points[i].lat, points[i].lng, layer.zoom)
        const k = `${p.x}/${p.y}`
        let gr = groups.get(k)
        if (!gr) { gr = { x: p.x, y: p.y, items: [] }; groups.set(k, gr) }
        gr.items.push({ i, px: p.px, py: p.py })
      }
      const list = [...groups.values()]
      let next = 0
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
        while (next < list.length) {
          const gr = list[next++]
          if (signal?.aborted) return
          const tile = await this.load(layer, gr.x, gr.y, signal)
          if (!tile) continue
          for (const it of gr.items) {
            const v = tile[it.py * 256 + it.px]
            if (!Number.isNaN(v)) result[it.i] = Math.round(v * 10) / 10 // Float32 の誤差を落とす
          }
        }
      }))
      remaining = remaining.filter((i) => result[i] === null)
    }
    return result
  }
}
