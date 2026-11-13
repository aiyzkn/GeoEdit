import type { RouteData } from '@/types/route'
import { haversineM } from '@/lib/geometry'

export interface RouteStats {
  distanceM: number
  gainM: number
  lossM: number
  maxEle: number | null
  minEle: number | null
  durationMs: number | null
  avgSpeedKmh: number | null
  maxSpeedKmh: number | null
  pointCount: number
}

// 要件定義書12.1: 選択中の編集ルートの統計値（総距離・累積標高差・最高/最低標高・
// 総所要時間・平均/最高速度・トラックポイント総数）を全トラック分積算して算出する。
export function computeRouteStats(route: RouteData): RouteStats {
  let distanceM = 0
  let gainM = 0
  let lossM = 0
  let maxEle: number | null = null
  let minEle: number | null = null
  let durationMs: number | null = null
  let maxSpeedKmh: number | null = null
  let pointCount = 0

  route.tracks.forEach((track) => {
    pointCount += track.points.length
    for (let i = 0; i < track.points.length; i++) {
      const p = track.points[i]
      if (p.ele != null) {
        maxEle = maxEle == null ? p.ele : Math.max(maxEle, p.ele)
        minEle = minEle == null ? p.ele : Math.min(minEle, p.ele)
      }
      if (i === 0) continue
      const a = track.points[i - 1]
      const segM = haversineM(a.lat, a.lng, p.lat, p.lng)
      distanceM += segM
      if (a.ele != null && p.ele != null) {
        const diff = p.ele - a.ele
        if (diff > 0) gainM += diff
        else lossM += -diff
      }
      if (a.time && p.time) {
        const segMs = p.time.getTime() - a.time.getTime()
        if (segMs > 0) {
          const segSpeedKmh = (segM / 1000) / (segMs / 3_600_000)
          maxSpeedKmh = maxSpeedKmh == null ? segSpeedKmh : Math.max(maxSpeedKmh, segSpeedKmh)
        }
      }
    }
    const first = track.points[0]
    const last = track.points[track.points.length - 1]
    if (first?.time && last?.time) {
      const trackDurationMs = last.time.getTime() - first.time.getTime()
      durationMs = (durationMs ?? 0) + Math.max(0, trackDurationMs)
    }
  })

  const avgSpeedKmh = durationMs && durationMs > 0
    ? (distanceM / 1000) / (durationMs / 3_600_000)
    : null

  return { distanceM, gainM, lossM, maxEle, minEle, durationMs, avgSpeedKmh, maxSpeedKmh, pointCount }
}
