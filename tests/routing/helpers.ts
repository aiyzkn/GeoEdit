// 経路探索の単体テストの補助。手作りのタイル（タイル内の座標 0〜4096）を作る。
import { buildRoadTile } from '../../src/lib/routing/roadTiles.ts'
import { EXTENT, worldToLatLng } from '../../src/lib/routing/geo.ts'
import { RoadGraph } from '../../src/lib/routing/graph.ts'
import { snapToGraph } from '../../src/lib/routing/snap.ts'
import type { GraphPos, RoadTile, SearchParams } from '../../src/lib/routing/types.ts'

/** 東京付近の z14 のタイル */
export const TX = 14552
export const TY = 6451

export interface TestLine {
  cls: number
  lv?: number
  struct?: number
  pts: [number, number][]
}

export function makeTile(lines: TestLine[], x = TX, y = TY): RoadTile {
  return buildRoadTile(x, y, lines.map((l) => ({ cls: l.cls, lv: l.lv ?? 0, struct: l.struct ?? 0, local: l.pts.flat() })))
}

export function graphOf(...tiles: RoadTile[]): RoadGraph {
  const g = new RoadGraph()
  for (const t of tiles) g.addTile(t)
  return g
}

/** タイル内の座標 → 緯度経度 */
export function ll(x: number, y: number, tx = TX, ty = TY) {
  return worldToLatLng(tx * EXTENT + x, ty * EXTENT + y)
}

export function posAt(g: RoadGraph, x: number, y: number): GraphPos {
  const p = ll(x, y)
  const pos = snapToGraph(g, p.lat, p.lng, { radius: 5, bias: 0, maxClass: 6 })
  if (!pos) throw new Error(`no road at ${x},${y}`)
  return pos
}

export const STANDARD: SearchParams = {
  weight: [0, 8, 4, 2.4, 1.6, 1.2, 1.0],
  valley: 2000,
  valleyFloor: 2,
  maxClass: 6,
  maxExpand: 1_000_000,
}

export const UNIT: SearchParams = { ...STANDARD, weight: [0, 1, 1, 1, 1, 1, 1] }
