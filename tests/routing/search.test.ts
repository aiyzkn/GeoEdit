// search.ts の単体テスト（詳細設計書 §9.1）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { search, valleyPenalty, stepsToPoints } from '../../src/lib/routing/search.ts'
import { makeTile, graphOf, posAt, STANDARD, UNIT, type TestLine } from './helpers.ts'
import type { RoadGraph } from '../../src/lib/routing/graph.ts'
import type { SearchResult } from '../../src/lib/routing/types.ts'

function classesOf(g: RoadGraph, r: SearchResult): number[] {
  return r.steps.filter((s) => s.from !== s.to).map((s) => g.edgeCls[s.edge])
}

// (a) 国道 2 本が直角に交わり、角を県道が斜めに結ぶ
const CORNER: TestLine[] = [
  { cls: 4, pts: [[0, 2000], [1500, 2000]] },
  { cls: 4, pts: [[1500, 2000], [2000, 2000]] },
  { cls: 4, pts: [[2000, 2000], [4000, 2000]] },
  { cls: 4, pts: [[2000, 0], [2000, 1500]] },
  { cls: 4, pts: [[2000, 1500], [2000, 2000]] },
  { cls: 4, pts: [[2000, 2000], [2000, 4000]] },
  { cls: 3, pts: [[1500, 2000], [2000, 1500]] },
]

test('(a) 標準の値では、国道どうしの角を県道で抜けない', () => {
  const g = graphOf(makeTile(CORNER))
  const r = search(g, posAt(g, 1000, 2000), posAt(g, 2000, 1000), STANDARD)!
  assert.ok(r)
  assert.ok(!classesOf(g, r).includes(3), `classes ${classesOf(g, r)}`)
  assert.equal(r.valleys, 0)
})

test('(a) 重みが同じでも、谷の罰則があれば抜けない。罰則が 0 なら近道の県道を通る', () => {
  const g = graphOf(makeTile(CORNER))
  const a = posAt(g, 1000, 2000), b = posAt(g, 2000, 1000)
  const withValley = search(g, a, b, UNIT)!
  assert.ok(!classesOf(g, withValley).includes(3))
  const noValley = search(g, a, b, { ...UNIT, valley: 0 })!
  assert.ok(classesOf(g, noValley).includes(3))
  assert.ok(noValley.distance < withValley.distance)
})

// (b) 国道が途切れ、県道でしかつながらない
const GAP: TestLine[] = [
  { cls: 4, pts: [[0, 2000], [1500, 2000]] },
  { cls: 3, pts: [[1500, 2000], [2500, 2000]] },
  { cls: 4, pts: [[2500, 2000], [4000, 2000]] },
]

test('(b) 上位の道が途切れていれば、罰則を払って県道を通る', () => {
  const g = graphOf(makeTile(GAP))
  const r = search(g, posAt(g, 500, 2000), posAt(g, 3500, 2000), STANDARD)!
  assert.ok(r)
  assert.deepEqual(classesOf(g, r), [4, 3, 4])
  assert.equal(r.valleys, 1)
})

test('(c) 始点が市道の奥: 重みどおりの側へ出る', () => {
  // 始点 (1000,1000) から国道 y=2000 へ: 里道で 1000 格子（× 8）または市道で 1500 格子（× 4）
  const tile = makeTile([
    { cls: 4, pts: [[0, 2000], [500, 2000], [1000, 2000], [4000, 2000]] },
    { cls: 2, pts: [[500, 1000], [1000, 1000]] },
    { cls: 1, pts: [[1000, 1000], [1000, 2000]] },
    { cls: 2, pts: [[500, 1000], [500, 2000]] },
  ])
  const g = graphOf(tile)
  const r = search(g, posAt(g, 990, 1000), posAt(g, 3000, 2000), STANDARD)!
  assert.ok(r)
  assert.ok(!classesOf(g, r).includes(1), `classes ${classesOf(g, r)}`)
  // 最短（重みなし）なら里道を通る
  const s = search(g, posAt(g, 990, 1000), posAt(g, 3000, 2000), { ...UNIT, valley: 0 })!
  assert.ok(classesOf(g, s).includes(1))
})

test('(d) maxClass = 4 なら、近道の高速を通らない', () => {
  const tile = makeTile([
    { cls: 6, pts: [[0, 2000], [4000, 2000]] },
    { cls: 4, pts: [[0, 2000], [0, 3000]] },
    { cls: 4, pts: [[0, 3000], [4000, 3000]] },
    { cls: 4, pts: [[4000, 3000], [4000, 2000]] },
  ])
  const g = graphOf(tile)
  const a = posAt(g, 0, 2500), b = posAt(g, 4000, 2500)
  const withMw = search(g, a, b, STANDARD)!
  assert.ok(classesOf(g, withMw).includes(6))
  const noMw = search(g, a, b, { ...STANDARD, maxClass: 4 })!
  assert.ok(noMw)
  assert.ok(!classesOf(g, noMw).includes(6))
})

test('(e) つながっていなければ null', () => {
  const g = graphOf(makeTile([
    { cls: 4, pts: [[0, 1000], [1000, 1000]] },
    { cls: 4, pts: [[2000, 3000], [3000, 3000]] },
  ]))
  assert.equal(search(g, posAt(g, 500, 1000), posAt(g, 2500, 3000), STANDARD), null)
})

test('(f) 始点と終点を入れ替えても、同じコスト・逆順の同じ辺', () => {
  for (const [lines, a, b] of [[CORNER, [1000, 2000], [2000, 1000]], [GAP, [500, 2000], [3500, 2000]]] as const) {
    const g = graphOf(makeTile(lines as unknown as TestLine[]))
    const pa = posAt(g, a[0], a[1]), pb = posAt(g, b[0], b[1])
    const f = search(g, pa, pb, STANDARD)!
    const r = search(g, pb, pa, STANDARD)!
    assert.ok(Math.abs(f.cost - r.cost) < 1e-6)
    assert.deepEqual(f.steps.map((s) => s.edge), r.steps.map((s) => s.edge).reverse())
  }
})

test('谷の罰則の表（詳細設計書 §4.3）', () => {
  const p = STANDARD
  const pathPen = (seq: number[]) => {
    let c = seq[0], top = seq[0], pen = 0
    for (const n of seq.slice(1)) { pen += valleyPenalty(c, top, n, p); top = Math.max(top, n); c = n }
    return pen / p.valley
  }
  assert.equal(pathPen([2, 3, 4, 3, 2]), 0) // 山型
  assert.equal(pathPen([4, 3, 4]), 1) // 抜け道
  assert.equal(pathPen([4, 2, 4]), 2)
  assert.equal(pathPen([4, 3, 6]), 1) // (g) 取付道路は 1 段（3 段ではない）
  assert.equal(pathPen([6, 3, 4]), 1) // その逆
  assert.equal(pathPen([2, 1, 2]), 0) // (i) 市道 → 里道 → 市道
  assert.equal(pathPen([3, 1, 3]), 1) // 里道は市区町村道として数える
})

test('(h) 始点と終点が同じ辺の上なら、その辺をまっすぐ', () => {
  const g = graphOf(makeTile([{ cls: 2, pts: [[0, 1000], [4000, 1000]] }]))
  const r = search(g, posAt(g, 3000, 1000), posAt(g, 1000, 1000), STANDARD)!
  assert.equal(r.steps.length, 1)
  assert.ok(r.steps[0].from > r.steps[0].to)
  const pts = stepsToPoints(g, r.steps)
  assert.equal(pts.length, 2)
  assert.ok(pts[0].lng > pts[1].lng) // 東から西へ
})

test('点列は辺の形をたどり、つなぎ目の点を重ねない', () => {
  const g = graphOf(makeTile(GAP))
  const r = search(g, posAt(g, 500, 2000), posAt(g, 3500, 2000), STANDARD)!
  const pts = stepsToPoints(g, r.steps)
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].lng > pts[i - 1].lng)
  assert.equal(pts.length, 4) // 始点・2 つの交点・終点
})
