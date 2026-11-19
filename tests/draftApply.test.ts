// draftApply.ts（下書きの確定）の単体テスト（designs/経路探索詳細設計書.md §10.2）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDraft, countWaypointsInRange } from '../src/lib/editors/draftApply.ts'
import { WALK } from '../src/lib/editors/routeEditors.ts'
import type { RouteData, TrackPoint } from '../src/types/route.ts'

const T0 = new Date('2026-11-19T09:00:00')
function route(withTime: boolean): RouteData {
  const pts: TrackPoint[] = [0, 1, 2, 3, 4].map((i) => ({
    lat: 35, lng: 139 + i * 0.01, ele: 10 + i,
    ...(withTime ? { time: new Date(T0.getTime() + i * 600_000) } : {}),
  }))
  pts[2] = { ...pts[2], waypoint: { name: 'WP' }, _extensions: '<hr>120</hr>' }
  return { id: 'r1', name: 'R', sourceFormat: 'gpx', sourceFileName: 'r.gpx', kind: 'track', tracks: [{ points: pts }], standaloneWaypoints: [] }
}
const P = (lng: number, lat = 35): TrackPoint => ({ lat, lng })

test('new: 新しいルートを足す。開始日時があれば時刻を付ける。2 点未満は too-few-points', () => {
  const r = applyDraft([], { target: { kind: 'new' }, points: [P(139), P(139.01)], newRoute: { id: 'n', name: 'N', startTime: T0 }, speed: WALK })
  assert.ok(r.ok)
  assert.equal(r.routes.length, 1)
  assert.equal(r.undoLabel, 'ルート作成')
  assert.equal(r.routes[0].tracks[0].points[0].time!.getTime(), T0.getTime())
  const bad = applyDraft([], { target: { kind: 'new' }, points: [P(139)], newRoute: { id: 'n', name: 'N' }, speed: WALK })
  assert.deepEqual(bad, { ok: false, error: 'too-few-points' })
})

test('append tail: つなぎ目の点は既存のまま。末尾の時刻から続けて時刻を付ける', () => {
  const routes = [route(true)]
  const snapshot = JSON.stringify(routes)
  const r = applyDraft(routes, { target: { kind: 'append', routeId: 'r1', trackIndex: 0, end: 'tail' }, points: [P(139.04), P(139.05), P(139.06)], speed: WALK })
  assert.ok(r.ok)
  const pts = r.routes[0].tracks[0].points
  assert.equal(pts.length, 7)
  assert.equal(r.addedPoints, 2)
  assert.equal(pts[4], routes[0].tracks[0].points[4]) // 既存の点はそのまま
  assert.ok(pts[5].time!.getTime() > pts[4].time!.getTime())
  assert.ok(pts[6].time!.getTime() > pts[5].time!.getTime())
  assert.equal(JSON.stringify(routes), snapshot) // 元を書き換えない
  // 時刻が無ければ付けない
  const r2 = applyDraft([route(false)], { target: { kind: 'append', routeId: 'r1', trackIndex: 0, end: 'tail' }, points: [P(139.04), P(139.05)], speed: WALK })
  assert.ok(r2.ok)
  assert.equal(r2.routes[0].tracks[0].points[5].time, undefined)
})

test('append head: 外へ向かって描いた線を逆にしてつなぐ。時刻は先頭からさかのぼり、単調に増える', () => {
  const r = applyDraft([route(true)], { target: { kind: 'append', routeId: 'r1', trackIndex: 0, end: 'head' }, points: [P(139), P(138.99), P(138.98)], speed: WALK })
  assert.ok(r.ok)
  const pts = r.routes[0].tracks[0].points
  assert.equal(pts.length, 7)
  assert.deepEqual([pts[0].lng, pts[1].lng, pts[2].lng], [138.98, 138.99, 139])
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].time!.getTime() > pts[i - 1].time!.getTime(), `i ${i}`)
  assert.equal(pts[2].time!.getTime(), T0.getTime()) // 既存の先頭の時刻は変わらない
})

test('replace: 両端は元の点のまま（ウェイポイント・拡張を保つ）。間は下書きの点、時刻は道のりの比', () => {
  const routes = [route(true)]
  const r = applyDraft(routes, {
    target: { kind: 'replace', routeId: 'r1', trackIndex: 0, startIndex: 1, endIndex: 3 },
    points: [P(139.01), P(139.015, 35.001), P(139.02, 35.002), P(139.025, 35.001), P(139.03)],
    speed: WALK,
  })
  assert.ok(r.ok)
  const pts = r.routes[0].tracks[0].points
  assert.equal(pts.length, 2 + 3 + 2) // [0,1] + 3 + [3,4]
  assert.equal(pts[1], routes[0].tracks[0].points[1])
  assert.equal(pts[5], routes[0].tracks[0].points[3])
  assert.ok(!pts.some((p) => p.waypoint)) // 区間の中のウェイポイントは消える
  const t1 = routes[0].tracks[0].points[1].time!.getTime(), t3 = routes[0].tracks[0].points[3].time!.getTime()
  for (let i = 2; i <= 4; i++) assert.ok(pts[i].time!.getTime() > t1 && pts[i].time!.getTime() < t3)
  assert.equal(r.undoLabel, '道なり補正')
})

test('replace: 始点と終点の順が逆でもよい（下書きは選んだ順に描かれている）', () => {
  const r = applyDraft([route(false)], {
    target: { kind: 'replace', routeId: 'r1', trackIndex: 0, startIndex: 3, endIndex: 1 },
    points: [P(139.03), P(139.025, 35.001), P(139.01)],
    speed: WALK,
  })
  assert.ok(r.ok)
  const pts = r.routes[0].tracks[0].points
  assert.equal(pts[2].lng, 139.025)
  assert.equal(pts.length, 2 + 1 + 2)
})

test('replace: 隣どうしの点の間に点を足すだけ。範囲の外・同じ点は target-missing', () => {
  const r = applyDraft([route(false)], {
    target: { kind: 'replace', routeId: 'r1', trackIndex: 0, startIndex: 0, endIndex: 1 },
    points: [P(139), P(139.005, 35.001), P(139.01)], speed: WALK,
  })
  assert.ok(r.ok)
  assert.equal(r.routes[0].tracks[0].points.length, 6)
  assert.deepEqual(applyDraft([route(false)], { target: { kind: 'replace', routeId: 'r1', trackIndex: 0, startIndex: 0, endIndex: 9 }, points: [P(1), P(2)], speed: WALK }), { ok: false, error: 'target-missing' })
  assert.deepEqual(applyDraft([route(false)], { target: { kind: 'replace', routeId: 'r1', trackIndex: 0, startIndex: 2, endIndex: 2 }, points: [P(1), P(2)], speed: WALK }), { ok: false, error: 'target-missing' })
  assert.deepEqual(applyDraft([route(false)], { target: { kind: 'append', routeId: 'nope', trackIndex: 0, end: 'tail' }, points: [P(1), P(2)], speed: WALK }), { ok: false, error: 'target-missing' })
})

test('countWaypointsInRange: 両端を除く', () => {
  const pts = route(false).tracks[0].points
  assert.equal(countWaypointsInRange(pts, 1, 3), 1)
  assert.equal(countWaypointsInRange(pts, 2, 4), 0) // 端の 2 は数えない
  assert.equal(countWaypointsInRange(pts, 3, 1), 1)
})
