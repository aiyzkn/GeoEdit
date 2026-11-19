// 標高の取得（要件定義書・基本設計書 11 章）。
// まず国土地理院の標高タイル（PNG）を読み、読めなかった点だけを標高 API（1 点 1 要求）で取る
// （designs/機能追加・UI改善設計書.md B6）。呼び出し側の形は変えない。

import { DemTileReader } from './elevationTiles.ts'

const GSI_ELEV_URL = 'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php'
const MAX_PARALLEL = 5
const DELAY_MS = 100

interface LatLng {
  lat: number
  lng: number
}

let reader: DemTileReader | null = null
function tileReader(): DemTileReader {
  if (!reader) reader = new DemTileReader()
  return reader
}

async function fetchElevationBatch(pts: LatLng[]): Promise<(number | null)[]> {
  const batchPromises = pts.map(async (pt) => {
    const res = await fetch(`${GSI_ELEV_URL}?lon=${pt.lng}&lat=${pt.lat}&outtype=JSON`)
    if (!res.ok) return null
    const data = await res.json() as { elevation?: number }
    const elev = data?.elevation
    return typeof elev === 'number' && !isNaN(elev) ? elev : null
  })
  const resolved = await Promise.allSettled(batchPromises)
  return resolved.map((r) => (r.status === 'fulfilled' ? r.value : null))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 標高 API だけで取る（1 点 1 要求。同時に MAX_PARALLEL 本、100 要求ごとに DELAY_MS 休む） */
export async function fetchElevationsByApi(points: LatLng[]): Promise<(number | null)[]> {
  const allElevs: (number | null)[] = []
  let requestCount = 0

  for (let i = 0; i < points.length; i += MAX_PARALLEL) {
    const batch = points.slice(i, i + MAX_PARALLEL)
    const elevs = await fetchElevationBatch(batch)
    allElevs.push(...elevs)
    requestCount += batch.length
    if (requestCount >= 100) {
      await sleep(DELAY_MS)
      requestCount = 0
    }
  }

  return allElevs
}

/** 標高タイルで読めた点はそれを使い、読めなかった点（タイルが無い・無効値）だけ API で取る */
export async function fetchElevations(points: LatLng[], signal?: AbortSignal): Promise<(number | null)[]> {
  let result: (number | null)[]
  try {
    result = await tileReader().elevations(points, signal)
  } catch {
    result = points.map(() => null)
  }
  const missing = result.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0)
  if (missing.length > 0 && !signal?.aborted) {
    const api = await fetchElevationsByApi(missing.map((i) => points[i]))
    missing.forEach((i, k) => { result[i] = api[k] })
  }
  return result
}
