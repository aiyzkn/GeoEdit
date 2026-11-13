const GSI_ELEV_URL = 'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php'
const MAX_PARALLEL = 5
const DELAY_MS = 100

interface LatLng {
  lat: number
  lng: number
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

/**
 * Fetch GSI elevations for a list of points, at most MAX_PARALLEL concurrent
 * requests, pausing DELAY_MS every 100 requests to avoid rate limiting.
 */
export async function fetchElevations(points: LatLng[]): Promise<(number | null)[]> {
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
