// どの z14 のタイルを取るか（詳細設計書 §6）。
// 5 km 以下は 1 段階（§6.1）。5〜100 km は 2 段階（coarse.ts で z12 の粗い経路 → そのまわりの z14 だけを取る。§6.2）。

import { EXTENT, TILE_ZOOM, latLngToWorld, metersPerUnit } from './geo.ts'
import type { LatLng } from './types.ts'

export const CORRIDOR = {
  directMaxKm: 5,
  directRadiusMinM: 1000,
  directRadiusRatio: 0.5,
  maxLegKm: 100,
  /** 2 段階で粗い経路が見つからなかったとき、1 段階でやり直す上限 */
  retryDirectMaxKm: 12,
  /** 回廊: 粗い経路の線からこの距離にかかる z14 のタイル、と、始点・終点からこの距離にかかるタイル */
  bufferM: 1000,
  endRadiusM: 2500,
  /** 点のまわりのタイルを取る半径（寄せ・道の無いところからの接続に使う） */
  pointRadiusM: 300,
} as const

export type LegPlan = { kind: 'direct'; radiusM: number } | { kind: 'two-stage' } | { kind: 'too-long' }

/** 1 段階で探索するときの、線分のまわりの半径 */
export function directRadius(distanceM: number): number {
  return Math.max(CORRIDOR.directRadiusMinM, CORRIDOR.directRadiusRatio * distanceM)
}

/** §6.1: 5 km 以下は 1 段階、100 km 以下は 2 段階、それより長い区間は探索しない */
export function planLeg(distanceM: number): LegPlan {
  const km = distanceM / 1000
  if (km > CORRIDOR.maxLegKm) return { kind: 'too-long' }
  if (km > CORRIDOR.directMaxKm) return { kind: 'two-stage' }
  return { kind: 'direct', radiusM: directRadius(distanceM) }
}

function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const L2 = dx * dx + dy * dy
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

/** 線分 a–b から radiusM 以内にかかるタイル（既定は z14。a と b が同じなら、点のまわり） */
export function tilesAroundSegment(a: LatLng, b: LatLng, radiusM: number, zoom: number = TILE_ZOOM): { x: number; y: number }[] {
  const [ax, ay] = latLngToWorld(a.lat, a.lng)
  const [bx, by] = latLngToWorld(b.lat, b.lng)
  return tilesAroundWorldSegment(ax, ay, bx, by, radiusM / metersPerUnit((a.lat + b.lat) / 2), zoom)
}

/** 世界座標（z14）の線分から r（格子）以内にかかる、ズーム zoom のタイル */
export function tilesAroundWorldSegment(ax: number, ay: number, bx: number, by: number, r: number, zoom: number = TILE_ZOOM): { x: number; y: number }[] {
  const size = EXTENT * 2 ** (TILE_ZOOM - zoom) // そのズームのタイル 1 枚の、z14 の世界座標での幅
  const x0 = Math.floor((Math.min(ax, bx) - r) / size), x1 = Math.floor((Math.max(ax, bx) + r) / size)
  const y0 = Math.floor((Math.min(ay, by) - r) / size), y1 = Math.floor((Math.max(ay, by) + r) / size)
  const half = size / 2
  const halfDiag = Math.SQRT2 * half
  const out: { x: number; y: number }[] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const cx = x * size + half, cy = y * size + half
      // タイルの中心から線分までの距離 − 半対角 ≤ r なら、かかっている可能性がある（多めに取る）
      if (distPointSeg(cx, cy, ax, ay, bx, by) - halfDiag <= r) out.push({ x, y })
    }
  }
  return out
}
