// snap.ts・corridor.ts・settings.ts・Router の単体テスト（詳細設計書 §9.1・§11.4）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { snapToGraph } from '../../src/lib/routing/snap.ts'
import { metersPerUnit, distanceLL } from '../../src/lib/routing/geo.ts'
import { planLeg, tilesAroundSegment } from '../../src/lib/routing/corridor.ts'
import { Router } from '../../src/lib/routing/index.ts'
import {
  DEFAULT_ROUTING_SETTINGS, presetParams, resolveRoutingOptions, resolveSearchParams, sanitizeSettings,
} from '../../src/lib/routing/settings.ts'
import { search } from '../../src/lib/routing/search.ts'
import { makeTile, graphOf, ll, posAt, TY } from './helpers.ts'

const SNAP = { radius: 30, bias: 15, maxClass: 6 as const }

test('snap: 一般道の 5 m 横と高速の 2 m 横なら、一般道', () => {
  const lat = ll(2000, 2000).lat
  const u = 1 / metersPerUnit(lat)
  const g = graphOf(makeTile([
    { cls: 6, pts: [[0, 2000 - 2 * u], [4000, 2000 - 2 * u]].map(([x, y]) => [x, Math.round(y)]) as [number, number][] },
    { cls: 2, pts: [[0, Math.round(2000 + 5 * u)], [4000, Math.round(2000 + 5 * u)]] },
  ]))
  const p = ll(2000, 2000)
  const s = snapToGraph(g, p.lat, p.lng, SNAP)!
  assert.equal(g.edgeCls[s.edge], 2)
  // 高速しか無ければ高速
  const g2 = graphOf(makeTile([{ cls: 6, pts: [[0, Math.round(2000 - 2 * u)], [4000, Math.round(2000 - 2 * u)]] }]))
  assert.equal(g2.edgeCls[snapToGraph(g2, p.lat, p.lng, SNAP)!.edge], 6)
})

test('snap: 半径の外に道が無ければ null。寄せた位置をもう一度寄せても同じ', () => {
  const g = graphOf(makeTile([{ cls: 2, pts: [[0, 1000], [4000, 1000]] }]))
  const far = ll(2000, 1300) // 約 150 m 離れている
  assert.equal(snapToGraph(g, far.lat, far.lng, SNAP), null)
  const near = ll(2000, 1030)
  const s1 = snapToGraph(g, near.lat, near.lng, SNAP)!
  const s2 = snapToGraph(g, s1.lat, s1.lng, SNAP)!
  assert.equal(s1.edge, s2.edge)
  assert.ok(Math.abs(s1.t - s2.t) < 1e-6)
})

test('planLeg: 段階 1 は 12 km まで 1 段階、それより長いと too-long', () => {
  assert.deepEqual(planLeg(3000), { kind: 'direct', radiusM: 1500 })
  assert.deepEqual(planLeg(1000), { kind: 'direct', radiusM: 1000 })
  assert.equal(planLeg(11_000).kind, 'direct')
  assert.equal(planLeg(20_000).kind, 'too-long')
  assert.equal(planLeg(120_000).kind, 'too-long')
})

test('tilesAroundSegment: 点のまわりは、そのタイルを含む', () => {
  const p = ll(2000, 2000)
  const tiles = tilesAroundSegment(p, p, 300)
  assert.ok(tiles.some((t) => t.x === 14552 && t.y === TY))
  assert.ok(tiles.length <= 4)
})

test('settings: 既定値・プリセット・カスタム・avoid', () => {
  const d = DEFAULT_ROUTING_SETTINGS
  const sp = resolveSearchParams(d)
  assert.deepEqual(sp.weight, [0, 8, 4, 2.4, 1.6, 1.2, 1.0])
  assert.equal(sp.valley, 2000)
  assert.equal(sp.maxClass, 6)
  assert.deepEqual(resolveSearchParams({ ...d, preset: 'shortest' }).weight, [0, 1, 1, 1, 1, 1, 1])
  assert.equal(resolveSearchParams({ ...d, preset: 'shortest' }).valley, 0)
  const custom = { ...d, preset: 'custom' as const, weights: [5, 4, 3, 2, 1.5, 1] as [number, number, number, number, number, number], valleyPenaltyM: 1234 }
  assert.deepEqual(resolveSearchParams(custom).weight, [0, 5, 4, 3, 2, 1.5, 1])
  assert.equal(resolveSearchParams(custom).valley, 1234)
  // custom でないときは weights を見ない
  assert.equal(resolveSearchParams({ ...custom, preset: 'standard' }).valley, 2000)
  assert.equal(resolveSearchParams({ ...d, avoidMotorway: true }).maxClass, 5)
  assert.equal(resolveSearchParams({ ...d, avoidToll: true }).maxClass, 4)
  assert.equal(resolveRoutingOptions({ ...d, avoidToll: true }).snap.maxClass, 4)
  assert.deepEqual(presetParams('standard').weights, [8, 4, 2.4, 1.6, 1.2, 1.0])
})

test('settings: 壊れた値は項目ごとに既定値へ戻す', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_ROUTING_SETTINGS)
  assert.deepEqual(sanitizeSettings('x'), DEFAULT_ROUTING_SETTINGS)
  assert.deepEqual(sanitizeSettings({ version: 2, enabled: false }), DEFAULT_ROUTING_SETTINGS)
  const s = sanitizeSettings({ enabled: false, preset: 'nope', weights: [0, 100, 'a', 2, 1.234, 1], valleyPenaltyM: -5, snapRadiusM: 1000, snapMotorwayBiasM: 'x' })
  assert.equal(s.enabled, false)
  assert.equal(s.preset, 'standard')
  assert.deepEqual(s.weights, [1, 20, 2.4, 2, 1.23, 1])
  assert.equal(s.valleyPenaltyM, 0)
  assert.equal(s.snapRadiusM, 100)
  assert.equal(s.snapMotorwayBiasM, 15)
  assert.deepEqual(sanitizeSettings({ weights: [1, 2] }).weights, DEFAULT_ROUTING_SETTINGS.weights)
  // 既定値のオブジェクトを書き換えない
  sanitizeSettings(null).weights[0] = 99
  assert.equal(DEFAULT_ROUTING_SETTINGS.weights[0], 8)
})

test('settings: 「最短」なら、角を県道で抜ける（谷の罰則が 0）', () => {
  const g = graphOf(makeTile([
    { cls: 4, pts: [[0, 2000], [1500, 2000]] },
    { cls: 4, pts: [[1500, 2000], [2000, 2000]] },
    { cls: 4, pts: [[2000, 2000], [2000, 1500]] },
    { cls: 4, pts: [[2000, 1500], [2000, 0]] },
    { cls: 3, pts: [[1500, 2000], [2000, 1500]] },
  ]))
  const r = search(g, posAt(g, 1000, 2000), posAt(g, 2000, 1000), resolveSearchParams({ ...DEFAULT_ROUTING_SETTINGS, preset: 'shortest' }))!
  assert.ok(r.steps.some((s) => g.edgeCls[s.edge] === 3))
})

// ---- Router（実タイルを返す loader） ----
const FIX_X = 14488, FIX_Y = 6413
const fixture = readFileSync(new URL('./fixtures/14_14488_6413.pbf', import.meta.url))
const fixtureLoader = async (x: number, y: number) => (x === FIX_X && y === FIX_Y ? new Uint8Array(fixture).buffer : null)
const OPTS = resolveRoutingOptions(DEFAULT_ROUTING_SETTINGS)

function inFixture(fx: number, fy: number) {
  return ll(fx * 4096, fy * 4096, FIX_X, FIX_Y)
}

test('Router: 実タイルの中の 2 点を道なりに結ぶ。先頭と末尾は入力の位置', async () => {
  const router = new Router(fixtureLoader)
  // 道のある点を探す: タイルの中央付近を寄せる
  const a0 = await router.snap(inFixture(0.3, 0.3), { ...OPTS, snap: { ...OPTS.snap, radius: 100 } })
  const b0 = await router.snap(inFixture(0.7, 0.7), { ...OPTS, snap: { ...OPTS.snap, radius: 100 } })
  assert.ok(a0 && b0, 'fixture should have roads near the center')
  const r = await router.routeLeg(a0, b0, OPTS)
  assert.equal(r.status, 'ok', r.reason)
  assert.ok(r.points.length > 2)
  assert.deepEqual(r.points[0], a0)
  assert.deepEqual(r.points[r.points.length - 1], b0)
  assert.ok(r.distance >= distanceLL(a0, b0) - 1)
})

test('Router: loader が失敗し続けたら tile-error（throw しない）', async () => {
  const router = new Router(async () => { throw new Error('network') })
  const r = await router.routeLeg(inFixture(0.3, 0.3), inFixture(0.6, 0.6), OPTS)
  assert.equal(r.status, 'fallback')
  assert.equal(r.reason, 'tile-error')
  assert.equal(r.points.length, 2)
})

test('Router: 始める前に abort されていれば aborted', async () => {
  const router = new Router(fixtureLoader)
  const ac = new AbortController()
  ac.abort()
  const r = await router.routeLeg(inFixture(0.3, 0.3), inFixture(0.6, 0.6), OPTS, ac.signal)
  assert.equal(r.reason, 'aborted')
})

test('Router: 道の無いところ（全部 404）は no-road。長すぎる区間は too-long', async () => {
  const router = new Router(async () => null)
  const r = await router.routeLeg({ lat: 30, lng: 140 }, { lat: 30.01, lng: 140.01 }, OPTS)
  assert.equal(r.reason, 'no-road')
  const long = await router.routeLeg({ lat: 35, lng: 139 }, { lat: 35.3, lng: 139.3 }, OPTS)
  assert.equal(long.reason, 'too-long')
})
