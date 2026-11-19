// match.ts（トラックのマップマッチング）と Router.matchTrack の単体テスト（トラックのマップマッチング設計書 §6）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { candidatesAt, matchTrack, pickObservations, DEFAULT_MATCH_PARAMS, type TrackMatch } from '../../src/lib/routing/match.ts'
import { distanceLL, EXTENT, latLngToWorld, metersPerUnit } from '../../src/lib/routing/geo.ts'
import { Router } from '../../src/lib/routing/index.ts'
import { DEFAULT_ROUTING_SETTINGS, resolveRoutingOptions } from '../../src/lib/routing/settings.ts'
import type { LatLng } from '../../src/lib/routing/types.ts'
import { makeTile, graphOf, ll, TY } from './helpers.ts'

const U = 1 / metersPerUnit(ll(2000, 2000).lat) // 1 m あたりのタイル内の座標
const Y0 = 2000

/** タイル内の座標で、(x0, y) → (x1, y) を step m ごとに。off(i) m だけ南北にずらす */
function along(x0: number, x1: number, y: number, stepM: number, off: (i: number) => number = () => 0): LatLng[] {
  const out: LatLng[] = []
  const n = Math.floor(Math.abs(x1 - x0) / (stepM * U))
  for (let i = 0; i <= n; i++) out.push(ll(x0 + Math.sign(x1 - x0) * i * stepM * U, y + off(i) * U))
  return out
}
/** 決まった揺れ（±amp m） */
const wobble = (amp: number) => (i: number) => amp * Math.sin(i * 2.3) * (i % 3 === 0 ? 1 : 0.6)

/** 区間の入力の範囲が、0 から n − 1 までを重ならずに覆っていること */
function assertCovers(m: TrackMatch, n: number) {
  let next = 0
  for (const s of m.sections) {
    assert.equal(s.input[0], next, `section starts at ${s.input[0]}, expected ${next}`)
    assert.ok(s.input[1] >= s.input[0])
    next = s.input[1] + 1
  }
  assert.equal(next, n)
}

/** 点と、y = 一定の線（タイル内の座標）との距離（m） */
const offY = (p: LatLng, y: number) => Math.abs(latLngToWorld(p.lat, p.lng)[1] - (TY * EXTENT + y)) / U

test('pickObservations: 先頭・末尾と、stepM ごとの点', () => {
  const pts = along(100, 1100, Y0, 10) // 10 m おき
  const o = pickObservations(pts, 35) // 境目（ちょうど 40 m）を避ける
  assert.equal(o[0], 0)
  assert.equal(o[o.length - 1], pts.length - 1)
  for (let i = 1; i < o.length - 1; i++) assert.equal(o[i] - o[i - 1], 4)
  assert.deepEqual(pickObservations([], 40), [])
  assert.deepEqual(pickObservations([pts[0]], 40), [0])
})

test('candidatesAt: 半径の中の道だけ、近い順に、数の上限まで', () => {
  const g = graphOf(makeTile([
    { cls: 2, pts: [[0, Y0], [4000, Y0]] },
    { cls: 2, pts: [[0, Math.round(Y0 + 20 * U)], [4000, Math.round(Y0 + 20 * U)]] },
    { cls: 2, pts: [[0, Math.round(Y0 + 80 * U)], [4000, Math.round(Y0 + 80 * U)]] },
  ]))
  const p = ll(2000, Y0 + 5 * U)
  const c = candidatesAt(g, p, 30, 8, 6)
  assert.equal(c.length, 2)
  assert.ok(c[0].d < c[1].d)
  assert.ok(Math.abs(c[0].d - 5) < 1)
  assert.equal(candidatesAt(g, p, 30, 1, 6).length, 1)
  assert.equal(candidatesAt(g, p, 30, 8, 1).length, 0) // 階級の上限（一般道は 2）
})

test('matchTrack: まっすぐな道。揺れた点が道の上に乗り、全体が 1 つの区間', () => {
  const g = graphOf(makeTile([{ cls: 2, pts: [[200, Y0], [3800, Y0]] }]))
  const pts = along(300, 3500, Y0, 10, wobble(6))
  const m = matchTrack(g, pts)!
  assertCovers(m, pts.length)
  assert.equal(m.sections.length, 1)
  const s = m.sections[0]
  assert.equal(s.kind, 'matched')
  if (s.kind !== 'matched') return
  assert.ok(s.steps.length >= 1)
  for (const a of s.anchors) assert.ok(offY(a.at, Y0) < 0.5, 'anchor on the road')
  assert.equal(m.matched, m.observed)
})

test('matchTrack: 30 m 離れた並ぶ道。ときどき隣へ寄る点があっても、通った道を保つ', () => {
  const yB = Math.round(Y0 + 30 * U)
  const g = graphOf(makeTile([
    { cls: 2, pts: [[200, Y0], [3800, Y0]] },
    { cls: 2, pts: [[200, yB], [3800, yB]] },
  ]))
  // 南北の揺れ ±4 m に、10 点に 1 つ、隣の道へ 17 m 寄った点を混ぜる（その点だけ見ると隣の道が近い）
  const pts = along(300, 3500, Y0, 10, (i) => (i % 10 === 5 ? 17 : wobble(4)(i)))
  const m = matchTrack(g, pts, { ...DEFAULT_MATCH_PARAMS, stepM: 10 })!
  assertCovers(m, pts.length)
  assert.equal(m.sections.length, 1)
  const s = m.sections[0]
  assert.equal(s.kind, 'matched')
  if (s.kind !== 'matched') return
  for (const a of s.anchors) assert.ok(offY(a.at, Y0) < 0.5, `anchor ${a.input} should stay on road A`)
})

test('matchTrack: 交差点で曲がる軌跡は、角を通る', () => {
  // 東へ 1 km → 交差点 (2000, Y0) → 北へ 1 km。どちらの道も交差点の先へ続く
  const g = graphOf(makeTile([
    { cls: 2, pts: [[200, Y0], [2000, Y0]] },
    { cls: 2, pts: [[2000, Y0], [3800, Y0]] },
    { cls: 2, pts: [[2000, 3800], [2000, Y0]] },
    { cls: 2, pts: [[2000, Y0], [2000, 200]] },
  ]))
  const east = along(400, 2000, Y0, 10, wobble(5))
  const north: LatLng[] = []
  for (let i = 1; i * 10 * U <= 1500; i++) north.push(ll(2000 + wobble(5)(i) * U, Y0 - i * 10 * U))
  const pts = [...east, ...north]
  const m = matchTrack(g, pts)!
  assertCovers(m, pts.length)
  assert.equal(m.sections.length, 1)
  const s = m.sections[0]
  if (s.kind !== 'matched') return assert.fail('matched')
  const edges = new Set(s.steps.map((st) => st.edge))
  assert.equal(edges.size, 2, 'east road then north road')
  // 道のりは、まっすぐの東 + 北にほぼ等しい（ほかの腕へ入って戻らない）
  const corner = ll(2000, Y0)
  const expect = distanceLL(s.anchors[0].at, corner) + distanceLL(corner, s.anchors[s.anchors.length - 1].at)
  const len = s.steps.reduce((a, st) => a + Math.abs(st.to - st.from) * g.edgeLen[st.edge], 0)
  assert.ok(Math.abs(len - expect) < 5, `len ${len} vs ${expect}`)
})

test('matchTrack: 道の無い所を通った区間は、元の点を残す（kept）', () => {
  const g = graphOf(makeTile([{ cls: 2, pts: [[200, Y0], [3800, Y0]] }]))
  const a = along(300, 1300, Y0, 10, wobble(4))
  // 道から 300 m 北へ離れて、東へ 500 m 進んでから戻る（道の候補が無い）
  const off: LatLng[] = []
  for (let i = 1; i <= 10; i++) off.push(ll(1300 + i * 5 * U, Y0 - i * 30 * U))
  for (let i = 1; i <= 10; i++) off.push(ll(1300 + 50 * U + i * 50 * U, Y0 - 300 * U))
  for (let i = 1; i <= 9; i++) off.push(ll(1300 + 550 * U + i * 5 * U, Y0 - 300 * U + i * 30 * U))
  const b = along(Math.round(1300 + 600 * U), 3500, Y0, 10, wobble(4))
  const pts = [...a, ...off, ...b]
  const m = matchTrack(g, pts)!
  assertCovers(m, pts.length)
  assert.deepEqual(m.sections.map((s) => s.kind), ['matched', 'kept', 'matched'])
  const kept = m.sections[1]
  // 道から 30 m（候補の半径）より離れた点は、すべて kept に入る
  for (let i = 0; i < pts.length; i++) {
    if (offY(pts[i], Y0) > 31) assert.ok(i >= kept.input[0] && i <= kept.input[1], `point ${i} should be kept`)
  }
})

test('matchTrack: つながっていない 2 本の道を続けて通ると、2 つの区間に分かれる', () => {
  const g = graphOf(makeTile([
    { cls: 2, pts: [[200, Y0], [1500, Y0]] },
    { cls: 2, pts: [[1600, Y0], [3800, Y0]] },
  ]))
  const pts = along(300, 3500, Y0, 10, wobble(3))
  const m = matchTrack(g, pts)!
  assertCovers(m, pts.length)
  assert.equal(m.sections.filter((s) => s.kind === 'matched').length, 2)
})

test('matchTrack: 道が 1 本も無ければ、全体を元のまま。中止できる', () => {
  const g = graphOf(makeTile([{ cls: 2, pts: [[200, Y0], [3800, Y0]] }]))
  const pts = along(300, 3500, Math.round(Y0 + 500 * U), 10)
  const m = matchTrack(g, pts)!
  assert.deepEqual(m.sections, [{ kind: 'kept', input: [0, pts.length - 1] }])
  assert.equal(m.matched, 0)
  assert.equal(matchTrack(g, pts, DEFAULT_MATCH_PARAMS, () => true), null)
})

// ---- Router.matchTrack（実タイル） ----
const FIX_X = 14488, FIX_Y = 6413
const fixture = readFileSync(new URL('./fixtures/14_14488_6413.pbf', import.meta.url))
const fixtureLoader = async (x: number, y: number): Promise<ArrayBuffer | null> => (x === FIX_X && y === FIX_Y ? new Uint8Array(fixture).buffer : null)
const OPTS = resolveRoutingOptions(DEFAULT_ROUTING_SETTINGS)
const inFixture = (fx: number, fy: number) => ll(fx * 4096, fy * 4096, FIX_X, FIX_Y)

test('Router.matchTrack: 実タイルの経路に揺れを足した軌跡を、元の経路に戻す', async () => {
  const router = new Router(fixtureLoader)
  const a0 = await router.snap(inFixture(0.3, 0.3), { ...OPTS, snap: { ...OPTS.snap, radius: 100 } })
  const b0 = await router.snap(inFixture(0.7, 0.7), { ...OPTS, snap: { ...OPTS.snap, radius: 100 } })
  assert.ok(a0 && b0)
  const route = await router.routeLeg(a0, b0, OPTS)
  assert.equal(route.status, 'ok')
  // 経路を 10 m ごとに取り、東西に ±5 m 揺らす
  const pts: LatLng[] = []
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i - 1], q = route.points[i]
    const n = Math.max(1, Math.round(distanceLL(p, q) / 10))
    for (let k = 0; k < n; k++) {
      const f = k / n
      const dx = (5 * Math.sin(pts.length * 1.7)) / (111_320 * Math.cos(p.lat * Math.PI / 180))
      pts.push({ lat: p.lat + (q.lat - p.lat) * f, lng: p.lng + (q.lng - p.lng) * f + dx })
    }
  }
  const r = await router.matchTrack(pts, OPTS)
  assert.ok(r)
  assert.ok(r.matched / r.observed > 0.9, `${r.matched}/${r.observed}`)
  // 合わせた線の点は、元の経路の線から 5 m 以内（95% 以上）
  const near = (p: LatLng) => {
    let best = Infinity
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i]
      for (let k = 0; k <= 10; k++) best = Math.min(best, distanceLL(p, { lat: a.lat + (b.lat - a.lat) * k / 10, lng: a.lng + (b.lng - a.lng) * k / 10 }))
    }
    return best
  }
  const ok = r.points.filter((p) => near(p) <= 5).length
  assert.ok(ok / r.points.length >= 0.95, `${ok}/${r.points.length}`)
  // 区間は入力を覆う
  let next = 0
  for (const s of r.sections) { assert.equal(s.input[0], next); next = s.input[1] + 1 }
  assert.equal(next, pts.length)
})

test('Router.matchTrack: タイルを取れなければ null（throw しない）。点が 2 つ未満も null', async () => {
  const router = new Router(async () => { throw new Error('network') })
  assert.equal(await router.matchTrack([inFixture(0.3, 0.3), inFixture(0.4, 0.4)], OPTS), null)
  assert.equal(await new Router(fixtureLoader).matchTrack([inFixture(0.3, 0.3)], OPTS), null)
})
