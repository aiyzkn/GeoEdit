// 世界座標（z14 のタイル番号 × 4096 + タイル内の座標）と緯度経度の変換、距離の計算。

import type { LatLng } from './types.ts'

export const TILE_ZOOM = 14
export const EXTENT = 4096
/** z14 の世界座標の 1 周の格子数 */
export const WORLD_SIZE = 2 ** TILE_ZOOM * EXTENT
const EARTH_RADIUS = 6371008.8
const RAD = Math.PI / 180

export function latLngToWorld(lat: number, lng: number): [number, number] {
  const x = ((lng + 180) / 360) * WORLD_SIZE
  const r = lat * RAD
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD_SIZE
  return [x, y]
}

export function worldToLatLng(wx: number, wy: number): LatLng {
  const lng = (wx / WORLD_SIZE) * 360 - 180
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / WORLD_SIZE))) / RAD
  return { lat, lng }
}

export function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * RAD
  const dLng = (bLng - aLng) * RAD
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function distanceLL(a: LatLng, b: LatLng): number {
  return haversine(a.lat, a.lng, b.lat, b.lng)
}

/** 緯度 lat での、世界座標 1 格子あたりの m（東西方向。メルカトルなので南北も同じ） */
export function metersPerUnit(lat: number): number {
  return (2 * Math.PI * EARTH_RADIUS * Math.cos(lat * RAD)) / WORLD_SIZE
}

/** 小数 7 桁（約 1 cm）に丸める */
export function round7(v: number): number {
  return Math.round(v * 1e7) / 1e7
}

export function pathDistance(points: LatLng[]): number {
  let d = 0
  for (let i = 1; i < points.length; i++) d += distanceLL(points[i - 1], points[i])
  return d
}
