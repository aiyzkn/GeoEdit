// アンカーを道へ寄せる（詳細設計書 §5）。

import { latLngToWorld, metersPerUnit, worldToLatLng } from './geo.ts'
import type { RoadGraph } from './graph.ts'
import { STRUCT_TUNNEL, type GraphPos, type SnapParams } from './types.ts'

export function snapToGraph(g: RoadGraph, lat: number, lng: number, p: SnapParams): GraphPos | null {
  const [px, py] = latLngToWorld(lat, lng)
  const mpu = metersPerUnit(lat)
  const reach = (p.radius + p.bias) / mpu
  const near = g.segmentsNear(px - reach, py - reach, px + reach, py + reach)
  let best: { score: number; e: number; k: number; f: number } | null = null
  for (let i = 0; i < near.length; i += 2) {
    const e = near[i], k = near[i + 1]
    if (g.edgeCls[e] > p.maxClass) continue
    const [ax, ay] = g.shapePoint(e, k - 1)
    const [bx, by] = g.shapePoint(e, k)
    const dx = bx - ax, dy = by - ay
    const L2 = dx * dx + dy * dy
    let f = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
    f = Math.max(0, Math.min(1, f))
    const d = Math.hypot(px - ax - f * dx, py - ay - f * dy) * mpu
    if (d > p.radius) continue
    const penalized = g.edgeCls[e] === 6 || g.edgeStruct[e] === STRUCT_TUNNEL
    const score = d + (penalized ? p.bias : 0)
    // 同点のときは辺の番号の小さいほう（結果を決定的にする）
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && e < best.e)) {
      best = { score, e, k, f }
    }
  }
  if (!best) return null
  const { e, k, f } = best
  const cum = g.cumulative(e)
  const total = cum[cum.length - 1]
  const along = cum[k - 1] + (cum[k] - cum[k - 1]) * f
  const t = total > 0 ? along / total : 0
  const [ax, ay] = g.shapePoint(e, k - 1)
  const [bx, by] = g.shapePoint(e, k)
  const ll = worldToLatLng(ax + (bx - ax) * f, ay + (by - ay) * f)
  return { edge: e, t, lat: ll.lat, lng: ll.lng }
}
