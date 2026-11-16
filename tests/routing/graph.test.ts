// roadTiles.ts（切る・デコード）と graph.ts（縫い合わせ）の単体テスト（詳細設計書 §9.1）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clipLine, decodeRoadTile } from '../../src/lib/routing/roadTiles.ts'
import { roadClassOf } from '../../src/lib/routing/roadClass.ts'
import { makeTile, graphOf, TX, TY } from './helpers.ts'
import type { RoadGraph } from '../../src/lib/routing/graph.ts'

function connected(g: RoadGraph, a: number, b: number): boolean {
  const seen = new Set([a])
  const st = [a]
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

test('roadClassOf: 仕様書の表のとおり', () => {
  assert.equal(roadClassOf({ ftCode: 2701, rdCtg: 3, motorway: 1, tollSect: 1 }), 6)
  assert.equal(roadClassOf({ ftCode: 2703, rdCtg: 0, motorway: 1 }), 6)
  assert.equal(roadClassOf({ ftCode: 2701, rdCtg: 1, tollSect: 1 }), 5)
  assert.equal(roadClassOf({ ftCode: 2701, rdCtg: 0, tollSect: 0 }), 4)
  assert.equal(roadClassOf({ ftCode: 2701, rdCtg: 0, tollSect: 2 }), 4) // 暫定無料は有料に入れない
  assert.equal(roadClassOf({ ftCode: 2704, rdCtg: 1 }), 3)
  assert.equal(roadClassOf({ ftCode: 2701, rdCtg: 2, rnkWidth: 1 }), 2)
  assert.equal(roadClassOf({ ftCode: 2701, rdCtg: 2, rnkWidth: 0 }), 1) // 幅員 3 m 未満
  assert.equal(roadClassOf({ ftCode: 2711, rdCtg: 2, rnkWidth: 2 }), 1) // 庭園路
  assert.equal(roadClassOf({ ftCode: 2731, rdCtg: 2 }), 1) // 石段
  assert.equal(roadClassOf({ ftCode: 2701, rdCtg: 6 }), 1) // 不明
  assert.equal(roadClassOf({ ftCode: 2201, rdCtg: 0 }), 0) // 道路縁
  assert.equal(roadClassOf({}), 0)
})

test('clipLine: 余白から入る線をタイルの縁で切る。切り口は整数', () => {
  const out = clipLine([-80, 100, 4176, 300])
  assert.equal(out.length, 1)
  const l = out[0]
  assert.equal(l[0], 0)
  assert.equal(l[l.length - 2], 4096)
  for (const v of l) assert.ok(Number.isInteger(v))
})

test('clipLine: 範囲の外だけの線は捨てる。外へ出て戻る線は 2 本に分かれる', () => {
  assert.deepEqual(clipLine([-80, -50, -10, -60]), [])
  const out = clipLine([100, 100, 100, -50, 200, 100])
  assert.equal(out.length, 2)
})

test('隣り合うタイルで境界の切り口が 1 格子ずれていても、つながる。2 格子ならつながらない', () => {
  for (const [shift, expected] of [[0, true], [1, true], [2, false]] as const) {
    const left = makeTile([{ cls: 2, pts: [[3000, 2000], [4096, 2000]] }], TX, TY)
    const right = makeTile([{ cls: 2, pts: [[0, 2000 + shift], [1000, 2000 + shift]] }], TX + 1, TY)
    const g = graphOf(left, right)
    // 左の線の西端と右の線の東端
    const west = g.edgeA[0], east = g.edgeB[1]
    assert.equal(connected(g, west, east), expected, `shift ${shift}`)
  }
})

test('交わっても端点を共有しない線（立体交差）は、つながない', () => {
  const g = graphOf(makeTile([
    { cls: 6, struct: 2, lv: 1, pts: [[0, 2000], [4000, 2000]] },
    { cls: 2, pts: [[2000, 0], [2000, 4000]] },
  ]))
  assert.equal(g.nodeCount, 4)
  assert.equal(connected(g, g.edgeA[0], g.edgeA[1]), false)
})

test('線の途中の点がほかの線の端点と同じなら、そこで分けてつなぐ', () => {
  const g = graphOf(makeTile([
    { cls: 3, pts: [[0, 2000], [2000, 2000], [4000, 2000]] },
    { cls: 2, pts: [[2000, 2000], [2000, 0]] },
  ]))
  assert.equal(g.edgeCount, 3)
  const north = g.edgeB[2]
  assert.ok(connected(g, g.edgeA[0], north))
})

test('同じタイルを 2 回足しても、何も増えない', () => {
  const t = makeTile([{ cls: 2, pts: [[0, 0], [100, 100]] }])
  const g = graphOf(t)
  g.addTile(t)
  assert.equal(g.edgeCount, 1)
})

test('実タイル（保存した z14）のデコード: 中心線だけが残り、座標はタイルの範囲に収まる', () => {
  const bytes = readFileSync(new URL('./fixtures/14_14488_6413.pbf', import.meta.url))
  const tile = decodeRoadTile(14488, 6413, bytes)
  assert.ok(tile.count > 100)
  for (let i = 0; i < tile.count; i++) assert.ok(tile.cls[i] >= 1 && tile.cls[i] <= 6)
  for (let i = 0; i < tile.coords.length; i += 2) {
    const lx = tile.coords[i] - 14488 * 4096, ly = tile.coords[i + 1] - 6413 * 4096
    assert.ok(lx >= 0 && lx <= 4096 && ly >= 0 && ly <= 4096)
  }
  const g = graphOf(tile)
  assert.ok(g.edgeCount > 100)
})
