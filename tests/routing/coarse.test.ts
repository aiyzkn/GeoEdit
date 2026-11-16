// coarse.ts（長い区間の粗い探索）の単体テスト（詳細設計書 §6.2・§9.1）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCoarseGraph, coarsePath } from '../../src/lib/routing/coarse.ts'
import { buildRoadTile } from '../../src/lib/routing/roadTiles.ts'
import { EXTENT, metersPerUnit, worldToLatLng } from '../../src/lib/routing/geo.ts'
import { STANDARD } from './helpers.ts'

// z12 のタイル（番号は z14 の 1/4）
const X = 3638, Y = 1612

function z12Tile(lines: { cls: number; pts: [number, number][] }[], x = X, y = Y) {
  return buildRoadTile(x, y, lines.map((l) => ({ cls: l.cls, lv: 0, struct: 0, local: l.pts.flat() })))
}

/** z12 のタイル内の座標 → 緯度経度 */
function ll(lx: number, ly: number) {
  return worldToLatLng((X * EXTENT + lx) * 4, (Y * EXTENT + ly) * 4)
}

function connected(g: ReturnType<typeof buildCoarseGraph>, a: number, b: number): boolean {
  const seen = new Set([a]), st = [a]
  while (st.length) {
    const u = st.pop()!
    if (u === b) return true
    for (const e of g.adj[u]) {
      const v = g.edgeA[e] === u ? g.edgeB[e] : g.edgeA[e]
      if (!seen.has(v)) { seen.add(v); st.push(v) }
    }
  }
  return false
}

/** z12 で m メートルにあたる格子の数 */
const unitsZ12 = (m: number) => m / (metersPerUnit(ll(2000, 2000).lat) * 4)

test('3 格子ずれた端点はつながる。4 格子ならつながらない（ほかの補いが無いとき）', () => {
  for (const [shift, expected] of [[3, true], [5, false]] as const) {
    const g = buildCoarseGraph([z12Tile([
      { cls: 4, pts: [[0, 2000], [2000, 2000]] },
      { cls: 4, pts: [[2000 + shift, 2000], [4000, 2000]] },
    ])])
    // 行き止まりの橋渡し（d）は 800 m なので、それより遠い両端で確かめる
    const west = g.edgeA[0], east = g.edgeB[1]
    if (expected) assert.ok(connected(g, west, east), `shift ${shift}`)
    else {
      // d の仮の道でつながることはある。長さ 0 の辺（b）が無いことを確かめる
      const zero = g.edgeLen.some((l, e) => l === 0 && g.edgeA[e] !== g.edgeB[e])
      assert.equal(zero, false, `shift ${shift}`)
    }
  }
})

test('行き止まりの近くの線分（交差点で切れていない線）へは、その辺の両端につなぐ', () => {
  const g = buildCoarseGraph([z12Tile([
    { cls: 4, pts: [[0, 2000], [4000, 2000]] },
    { cls: 3, pts: [[2000, 0], [2000, 1998]] }, // 2 格子手前で止まっている県道
  ])])
  const west = g.edgeA[0], north = g.edgeA[1]
  assert.ok(connected(g, north, west))
})

test('500 m 離れた行き止まりは、仮の市区町村道（階級 2）でつなぐ', () => {
  const gap = Math.round(unitsZ12(500))
  const g = buildCoarseGraph([z12Tile([
    { cls: 3, pts: [[0, 2000], [1000, 2000]] },
    { cls: 3, pts: [[1000 + gap, 2000], [3000, 2000]] },
  ])])
  assert.ok(connected(g, g.edgeA[0], g.edgeB[1]))
  assert.ok(g.edgeCls.includes(2))
})

test('高速の線分の 2 格子横にある県道の行き止まりは、高速へつながない', () => {
  const g = buildCoarseGraph([z12Tile([
    { cls: 6, pts: [[0, 2000], [4000, 2000]] },
    { cls: 3, pts: [[2000, 3500], [2000, 2002]] },
  ])])
  // 県道の行き止まりから出る辺に、高速の端へつながるもの（階級 6 の仮の辺）が無い
  const deadEnd = g.edgeB[1]
  for (const e of g.adj[deadEnd]) assert.notEqual(g.edgeCls[e], 6)
  // 仮の市区町村道（d）は高速の端（2 km 先）には届かない
  assert.equal(connected(g, deadEnd, g.edgeA[0]), false)
})

test('coarsePath: 経路の線を返し、グラフは元のまま（仮のノード・辺を外す）', () => {
  const g = buildCoarseGraph([z12Tile([
    { cls: 4, pts: [[0, 2000], [2000, 2000]] },
    { cls: 4, pts: [[2000, 2000], [4000, 2000]] },
  ])])
  const nodes = g.nodeX.length, edges = g.edgeA.length
  const p = coarsePath(g, ll(100, 2050), ll(3900, 2050), STANDARD)
  assert.ok(p && p.length >= 4)
  assert.equal(g.nodeX.length, nodes)
  assert.equal(g.edgeA.length, edges)
  for (const a of g.adj) for (const e of a) assert.ok(e < edges)
  // 2 回目も同じ結果（仮の辺の重複の記録が残っていない）
  assert.deepEqual(coarsePath(g, ll(100, 2050), ll(3900, 2050), STANDARD), p)
})

test('coarsePath: 近くに道が無ければ null', () => {
  const g = buildCoarseGraph([z12Tile([{ cls: 4, pts: [[0, 100], [500, 100]] }])])
  assert.equal(coarsePath(g, worldToLatLng(0, 0), worldToLatLng(10, 10), STANDARD), null)
})
