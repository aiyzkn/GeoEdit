/**
 * タイル画像の取得・キャッシュとクリック周辺パッチの切り出し（設計書 §6.1）。
 * 表示中タイルと同一URLを fetch するためブラウザHTTPキャッシュに命中する想定。
 * 取得画素は常に元配色（ダークモードの CSS invert は表示のみの加工で影響しない）。
 */

const TILE_SIZE = 256
const CACHE_MAX = 16

/** 'layerUrl|z/x/y' → ImageData の簡易LRU（Map の挿入順を利用） */
const cache = new Map<string, ImageData>()

function createCanvasContext(w: number, h: number): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
    if (ctx) return ctx
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas context を取得できません')
  return ctx
}

async function fetchTileImageData(
  urlTemplate: string,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal | undefined
): Promise<ImageData> {
  const key = `${urlTemplate}|${z}/${x}/${y}`
  const cached = cache.get(key)
  if (cached) {
    // LRU: 再挿入して最近使用に更新
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const url = urlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  const res = await fetch(url, { signal, mode: 'cors' })
  if (!res.ok) throw new Error(`タイル取得失敗: ${res.status} ${url}`)
  const bitmap = await createImageBitmap(await res.blob())
  try {
    const ctx = createCanvasContext(TILE_SIZE, TILE_SIZE)
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
    cache.set(key, data)
    while (cache.size > CACHE_MAX) {
      cache.delete(cache.keys().next().value!)
    }
    return data
  } finally {
    bitmap.close()
  }
}

export interface Patch {
  /** RGBA。長さ size*size*4 */
  data: Uint8ClampedArray
  size: number
}

/**
 * ワールドピクセル座標 (centerX, centerY) を中心とする (radius*2+1)² のパッチを切り出す。
 * パッチが跨るタイル（最大4枚）を取得して合成する。タイル取得失敗時は throw。
 */
export async function samplePatch(params: {
  urlTemplate: string
  z: number
  centerX: number
  centerY: number
  radius: number
  signal?: AbortSignal
}): Promise<Patch> {
  const { urlTemplate, z, centerX, centerY, radius, signal } = params
  const size = radius * 2 + 1
  const x0 = Math.round(centerX) - radius
  const y0 = Math.round(centerY) - radius
  const maxTile = 2 ** z - 1

  const tx0 = Math.floor(x0 / TILE_SIZE)
  const tx1 = Math.floor((x0 + size - 1) / TILE_SIZE)
  const ty0 = Math.floor(y0 / TILE_SIZE)
  const ty1 = Math.floor((y0 + size - 1) / TILE_SIZE)

  const tiles = new Map<string, ImageData>()
  const jobs: Promise<void>[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx > maxTile || ty > maxTile) continue
      jobs.push(
        fetchTileImageData(urlTemplate, z, tx, ty, signal).then((img) => {
          tiles.set(`${tx}/${ty}`, img)
        })
      )
    }
  }
  await Promise.all(jobs)

  // タイル範囲外（世界の端）は透明のまま残る → 分類側で背景/無視として扱われる
  const out = new Uint8ClampedArray(size * size * 4)
  for (let py = 0; py < size; py++) {
    const wy = y0 + py
    const ty = Math.floor(wy / TILE_SIZE)
    const iy = wy - ty * TILE_SIZE
    for (let px = 0; px < size; px++) {
      const wx = x0 + px
      const tx = Math.floor(wx / TILE_SIZE)
      const tile = tiles.get(`${tx}/${ty}`)
      if (!tile) continue
      const ix = wx - tx * TILE_SIZE
      const src = (iy * TILE_SIZE + ix) * 4
      const dst = (py * size + px) * 4
      out[dst] = tile.data[src]
      out[dst + 1] = tile.data[src + 1]
      out[dst + 2] = tile.data[src + 2]
      out[dst + 3] = tile.data[src + 3]
    }
  }
  return { data: out, size }
}
