// matchCarry.ts（道に合わせた線へ、元の軌跡の時刻・標高・ウェイポイントを移す）の単体テスト
// （designs/トラックのマップマッチング設計書.md §8.2）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carryAlongMatch, cumulative, projectMonotone } from '../src/lib/editors/matchCarry.ts'
import type { TrackPoint } from '../src/types/route.ts'

const T0 = new Date('2026-11-20T09:00:00').getTime()
/** 緯度 35° で、経度 139 + i × step の点 */
const E = (i: number, step = 0.001, lat = 35): TrackPoint => ({ lat, lng: 139 + i * step })

test('projectMonotone: 先頭は 0・末尾は全長。少しずれた点も、線の上の順の位置になる', () => {
  const line = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => E(i))
  const cum = cumulative(line)
  const pts = [E(0), { lat: 35.0001, lng: 139.0025 }, { lat: 34.9999, lng: 139.0061 }, E(10)]
  const pos = projectMonotone(line, pts, cum)
  assert.equal(pos[0], 0)
  assert.equal(pos[3], cum[10])
  assert.ok(Math.abs(pos[1] - cum[10] * 0.25) < 3, `pos1=${pos[1]}`)
  assert.ok(Math.abs(pos[2] - cum[10] * 0.61) < 3, `pos2=${pos[2]}`)
})

test('projectMonotone: 往復の線で、帰りの点を行きの位置へ戻さない', () => {
  // 東へ 5 区間進んで、同じ道を西へ戻る
  const line = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map((i) => E(i))
  const cum = cumulative(line)
  const pts = [E(0), E(2), E(4), E(5), E(3), E(1), E(0)]
  const pos = projectMonotone(line, pts, cum)
  for (let k = 1; k < pos.length; k++) assert.ok(pos[k] >= pos[k - 1], `k=${k}`)
  // 帰りの E(3) は、行きの位置（cum[3]）ではなく帰りの位置（cum[7]）
  assert.ok(Math.abs(pos[4] - cum[7]) < 1, `pos4=${pos[4]} cum7=${cum[7]}`)
})

test('carryAlongMatch: 時刻は元の点の位置に置き、間を道のりで補う（速さの変化を保つ）', () => {
  // 前半はゆっくり（2 区間に 20 分）、後半は速い（2 区間に 4 分）
  const orig: TrackPoint[] = [
    { ...E(0), time: new Date(T0) },
    { ...E(2), time: new Date(T0 + 20 * 60_000) },
    { ...E(4), time: new Date(T0 + 24 * 60_000) },
  ]
  const mid = [1, 2, 3].map((i) => E(i)) // 道に合わせた中の点（時刻なし）
  const r = carryAlongMatch(orig, mid)
  assert.equal(r.timed, true)
  const min = r.mid.map((p) => Math.round((p.time!.getTime() - T0) / 60_000))
  assert.deepEqual(min, [10, 20, 22]) // 両端の比なら 6・12・18 になる
})

test('carryAlongMatch: 時刻が戻る点は使わない。時刻が 1 つも無ければ timed = false', () => {
  const orig: TrackPoint[] = [
    { ...E(0), time: new Date(T0) },
    { ...E(1), time: new Date(T0 - 60_000) }, // 戻る
    { ...E(2), time: new Date(T0 + 2 * 60_000) },
  ]
  const r = carryAlongMatch(orig, [E(1)])
  assert.equal(r.mid[0].time!.getTime(), T0 + 60_000)
  const none = carryAlongMatch([E(0), E(1), E(2)], [E(1)])
  assert.equal(none.timed, false)
  assert.equal(none.mid[0].time, undefined)
})

test('carryAlongMatch: 標高は中の点に無いときだけ補う', () => {
  const orig: TrackPoint[] = [{ ...E(0), ele: 100 }, { ...E(4), ele: 140 }]
  const r = carryAlongMatch(orig, [E(1), { ...E(2), ele: 5 }, E(3)])
  assert.deepEqual(r.mid.map((p) => p.ele), [110, 5, 130])
})

test('carryAlongMatch: 中のウェイポイントを最寄りの点へ移す。同じ点に重なれば隣へ', () => {
  const orig: TrackPoint[] = [
    E(0),
    { lat: 35.0001, lng: 139.0029, waypoint: { name: 'A' } },
    { lat: 35.0001, lng: 139.0031, waypoint: { name: 'B' } },
    { lat: 35.0001, lng: 139.0072, waypoint: { name: 'C' } },
    E(10),
  ]
  const mid = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => E(i))
  const r = carryAlongMatch(orig, mid)
  assert.equal(r.waypoints, 3)
  const names = r.mid.map((p) => p.waypoint?.name ?? null)
  assert.equal(names[2], 'A') // E(3)
  assert.ok(names[1] === 'B' || names[3] === 'B') // E(3) がふさがっているので隣
  assert.equal(names[6], 'C') // E(7)
  // 引数を書き換えない
  assert.equal(mid[2].waypoint, undefined)
})
