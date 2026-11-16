// どの z14 のタイルを取るか（詳細設計書 §6）。
// 段階 1 は 1 段階の探索だけ: 5 km 以下は §6.1 の範囲、5〜12 km も 1 段階、それより長い区間は too-long（§0.3）。
// 2 段階の探索（coarse.ts）は段階 4 で足す。

import { EXTENT, latLngToWorld, metersPerUnit } from './geo.ts'
import type { LatLng } from './types.ts'

export const CORRIDOR = {
  directMaxKm: 5,
  directRadiusMinM: 1000,
  directRadiusRatio: 0.5,
  maxLegKm: 100,
  /** 段階 1 で、1 段階の探索をする上限（2 段階の探索が入るまで） */
  retryDirectMaxKm: 12,
  /** 点のまわりのタイルを取る半径（寄せ・道の無いところからの接続に使う） */
  pointRadiusM: 300,
} as const

export type LegPlan = { kind: 'direct'; radiusM: number } | { kind: 'too-long' }

export function planLeg(distanceM: number): LegPlan {
  const km = distanceM / 1000
  if (km > CORRIDOR.maxLegKm || km > CORRIDOR.retryDirectMaxKm) return { kind: 'too-long' }
  return { kind: 'direct', radiusM: Math.max(CORRIDOR.directRadiusMinM, CORRIDOR.directRadiusRatio * distanceM) }
}

function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const L2 = dx * dx + dy * dy
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

/** 線分 a–b から radiusM 以内にかかる z14 のタイル（a と b が同じなら、点のまわり） */
export function tilesAroundSegment(a: LatLng, b: LatLng, radiusM: number): { x: number; y: number }[] {
  const [ax, ay] = latLngToWorld(a.lat, a.lng)
  const [bx, by] = latLngToWorld(b.lat, b.lng)
  const r = radiusM / metersPerUnit((a.lat + b.lat) / 2)
  const x0 = Math.floor((Math.min(ax, bx) - r) / EXTENT), x1 = Math.floor((Math.max(ax, bx) + r) / EXTENT)
  const y0 = Math.floor((Math.min(ay, by) - r) / EXTENT), y1 = Math.floor((Math.max(ay, by) + r) / EXTENT)
  const half = EXTENT / 2
  const halfDiag = Math.SQRT2 * half
  const out: { x: number; y: number }[] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const cx = x * EXTENT + half, cy = y * EXTENT + half
      // タイルの中心から線分までの距離 − 半対角 ≤ r なら、かかっている可能性がある（多めに取る）
      if (distPointSeg(cx, cy, ax, ay, bx, by) - halfDiag <= r) out.push({ x, y })
    }
  }
  return out
}
