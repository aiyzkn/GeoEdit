import type { TrackPoint } from '@/types/route'

const EARTH_RADIUS_M = 6371000

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export interface NearestPointResult {
  index: number
  distM: number
}

/** Find the point in `points` nearest to (lat, lng). Returns null if points is empty. */
export function nearestPointIndex(lat: number, lng: number, points: TrackPoint[]): NearestPointResult | null {
  if (points.length === 0) return null
  let best: NearestPointResult = { index: 0, distM: haversineM(lat, lng, points[0].lat, points[0].lng) }
  for (let i = 1; i < points.length; i++) {
    const d = haversineM(lat, lng, points[i].lat, points[i].lng)
    if (d < best.distM) best = { index: i, distM: d }
  }
  return best
}
