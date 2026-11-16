// draft.ts（作成モードの下書き）の単体テスト（designs/経路探索詳細設計書.md §8.2・§9.1）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyDraft, addAnchor, insertAnchor, moveAnchor, removeAnchor, setLegResult, bumpPending,
  resetAutoLegs, pendingLegs, draftPoints, draftDistance,
} from '../src/lib/editors/draft.ts'
import type { Draft } from '../src/types/editor.ts'

const A = { id: 'a', lat: 35.0, lng: 139.0 }
const B = { id: 'b', lat: 35.0, lng: 139.01 }
const C = { id: 'c', lat: 35.01, lng: 139.01 }

function abc(mode1: 'auto' | 'straight' = 'auto', mode2: 'auto' | 'straight' = 'auto'): Draft {
  return addAnchor(addAnchor(addAnchor(emptyDraft(), A, 'auto'), B, mode1), C, mode2)
}

test('addAnchor: 1 点目は区間なし。auto の区間は pending、straight は ok', () => {
  const d1 = addAnchor(emptyDraft(), A, 'auto')
  assert.equal(d1.legs.length, 0)
  const d = abc('auto', 'straight')
  assert.equal(d.anchors.length, 3)
  assert.equal(d.legs.length, 2)
  assert.equal(d.legs[0].status, 'pending')
  assert.equal(d.legs[1].status, 'ok')
  assert.deepEqual(d.legs[0].points, [{ lat: A.lat, lng: A.lng }, { lat: B.lat, lng: B.lng }])
  assert.ok(d.legs[0].distance > 900 && d.legs[0].distance < 920)
})

test('引数を書き換えない', () => {
  const d = abc()
  const snap = JSON.stringify(d)
  moveAnchor(d, 'b', 1, 1)
  removeAnchor(d, 'b')
  insertAnchor(d, d.legs[0].id, { id: 'x', lat: 35, lng: 139.005 })
  setLegResult(d, d.legs[0].id, 0, { status: 'ok', points: [A, B], distance: 1 })
  resetAutoLegs(d)
  bumpPending(d)
  assert.equal(JSON.stringify(d), snap)
})

test('insertAnchor: 区間を 2 つに分ける。mode は元の区間と同じ', () => {
  const d = abc('straight', 'auto')
  const x = { id: 'x', lat: 35.0, lng: 139.005 }
  const e = insertAnchor(d, d.legs[0].id, x)
  assert.deepEqual(e.anchors.map((a) => a.id), ['a', 'x', 'b', 'c'])
  assert.equal(e.legs.length, 3)
  assert.deepEqual(e.legs.map((l) => l.mode), ['straight', 'straight', 'auto'])
  assert.equal(e.legs[2], d.legs[1]) // 触っていない区間はそのまま
})

test('moveAnchor: 前後の区間だけ pending に戻し gen を増やす。離れた区間は変えない', () => {
  let d = abc()
  d = setLegResult(d, d.legs[0].id, 0, { status: 'ok', points: [A, { lat: 35.001, lng: 139.005 }, B], distance: 1000 })
  d = setLegResult(d, d.legs[1].id, 0, { status: 'ok', points: [B, C], distance: 1100 })
  const e = moveAnchor(d, 'c', 35.02, 139.02)
  assert.equal(e.legs[0], d.legs[0])
  assert.equal(e.legs[1].status, 'pending')
  assert.equal(e.legs[1].gen, 1)
  assert.deepEqual(e.legs[1].points[1], { lat: 35.02, lng: 139.02 })
})

test('removeAnchor: 端は区間を 1 つ消す。途中は前後をまとめる（両方 straight なら straight）', () => {
  const d = abc('straight', 'straight')
  const first = removeAnchor(d, 'a')
  assert.deepEqual(first.anchors.map((a) => a.id), ['b', 'c'])
  assert.equal(first.legs.length, 1)
  const last = removeAnchor(d, 'c')
  assert.equal(last.legs.length, 1)
  const mid = removeAnchor(d, 'b')
  assert.equal(mid.legs.length, 1)
  assert.equal(mid.legs[0].mode, 'straight')
  assert.equal(mid.legs[0].status, 'ok')
  const mixed = removeAnchor(abc('straight', 'auto'), 'b')
  assert.equal(mixed.legs[0].mode, 'auto')
  assert.equal(mixed.legs[0].status, 'pending')
  assert.deepEqual(removeAnchor(addAnchor(emptyDraft(), A, 'auto'), 'a'), emptyDraft())
})

test('locked の通過点は動かせない・消せない', () => {
  const d = addAnchor(addAnchor(emptyDraft(), { ...A, locked: true }, 'auto'), B, 'auto')
  assert.equal(moveAnchor(d, 'a', 1, 1), d)
  assert.equal(removeAnchor(d, 'a'), d)
})

test('setLegResult: gen が違う（古い）結果は捨てる。先頭と末尾は通過点の位置にする', () => {
  const d = abc()
  const leg = d.legs[0]
  assert.equal(setLegResult(d, leg.id, leg.gen + 1, { status: 'ok', points: [A, B], distance: 1 }), d)
  assert.equal(setLegResult(d, 'nope', 0, { status: 'ok', points: [A, B], distance: 1 }), d)
  const e = setLegResult(d, leg.id, leg.gen, { status: 'ok', points: [{ lat: 34.99999, lng: 139 }, { lat: 35.0005, lng: 139.005 }, { lat: 35, lng: 139.00999 }], distance: 950 })
  assert.equal(e.legs[0].status, 'ok')
  assert.equal(e.legs[0].distance, 950)
  assert.deepEqual(e.legs[0].points[0], { lat: A.lat, lng: A.lng })
  assert.deepEqual(e.legs[0].points[2], { lat: B.lat, lng: B.lng })
  const f = setLegResult(d, leg.id, leg.gen, { status: 'fallback', reason: 'no-route', points: [A, B], distance: 900 })
  assert.equal(f.legs[0].status, 'fallback')
  assert.equal(f.legs[0].reason, 'no-route')
})

test('draftPoints: 区間の点列をつなぎ目を重ねずに連結。通過点 1 つならその点', () => {
  assert.deepEqual(draftPoints(addAnchor(emptyDraft(), A, 'auto')), [{ lat: A.lat, lng: A.lng }])
  let d = abc()
  d = setLegResult(d, d.legs[0].id, 0, { status: 'ok', points: [A, { lat: 35.001, lng: 139.005 }, B], distance: 1000 })
  const pts = draftPoints(d)
  assert.equal(pts.length, 4) // A, 中間, B, C
  assert.equal(draftDistance(d), 1000 + d.legs[1].distance)
})

test('bumpPending・resetAutoLegs・pendingLegs', () => {
  let d = abc('auto', 'straight')
  d = setLegResult(d, d.legs[0].id, 0, { status: 'ok', points: [A, B], distance: 900 })
  assert.equal(pendingLegs(d).length, 0)
  assert.equal(bumpPending(d), d)
  const r = resetAutoLegs(d)
  assert.equal(r.legs[0].status, 'pending')
  assert.equal(r.legs[0].gen, 1)
  assert.equal(r.legs[1], d.legs[1]) // straight は変えない
  const b = bumpPending(r)
  assert.equal(b.legs[0].gen, 2)
})
