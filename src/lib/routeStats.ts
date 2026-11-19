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
/** 点列の登り・下り（m）。標高が無い区間は数えない（確定後の統計と同じ決まり） */
export function computeGainLoss(points: { ele?: number | null }[]): { gainM: number; lossM: number } {
  let gainM = 0
  let lossM = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].ele, b = points[i].ele
    if (a == null || b == null) continue
    const diff = b - a
    if (diff > 0) gainM += diff
    else lossM += -diff
  }
  return { gainM, lossM }
}

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
      if (a.time && p.time) {
        const segMs = p.time.getTime() - a.time.getTime()
        if (segMs > 0) {
          const segSpeedKmh = (segM / 1000) / (segMs / 3_600_000)
          maxSpeedKmh = maxSpeedKmh == null ? segSpeedKmh : Math.max(maxSpeedKmh, segSpeedKmh)
        }
      }
    }
    const gl = computeGainLoss(track.points)
    gainM += gl.gainM
    lossM += gl.lossM
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
