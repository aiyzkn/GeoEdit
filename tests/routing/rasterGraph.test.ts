// rasterGraph.ts（地図画像の道をグラフに足す）と、経路の元の設定の単体テスト（経路の元の選択設計書 §3・§7）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXTENT, latLngToWorld, metersPerUnit, worldToLatLng } from '../../src/lib/routing/geo.ts'
import { DISABLED_CLASS } from '../../src/lib/routing/graph.ts'
import { addRasterRoads, RasterRoadSource, RASTER_ROAD_ZOOM, similarPaths, simplify, type RasterRoadLine } from '../../src/lib/routing/rasterGraph.ts'
import { RK_MOTORWAY, RK_NATIONAL } from '../../src/lib/routing/rasterRoads.ts'
import { search } from '../../src/lib/routing/search.ts'
import { snapToGraph } from '../../src/lib/routing/snap.ts'
import { Router } from '../../src/lib/routing/index.ts'
import { DEFAULT_ROUTING_SETTINGS, resolveRoutingOptions, sanitizeSettings } from '../../src/lib/routing/settings.ts'
import { graphOf, ll, makeTile, STANDARD, TX, TY } from './helpers.ts'

const lat = ll(2000, 2000).lat
const u = 1 / metersPerUnit(lat) // 1 m の世界座標の長さ
const W = (x: number, y: number) => [TX * EXTENT + x, TY * EXTENT + y]
const line = (kind: RasterRoadLine['kind'], pts: [number, number][]): RasterRoadLine => ({ kind, coords: pts.flatMap(([x, y]) => W(x, y)) })
const snapAt = (g: ReturnType<typeof graphOf>, x: number, y: number) => {
  const p = ll(x, y)
  const s = snapToGraph(g, p.lat, p.lng, { radius: 10, bias: 0, maxClass: 6 })
  assert.ok(s, `no road at ${x},${y}`)
  return s
}

test('hybrid: ベクトルに無い画像の高速を足し、端を近くの道へつなぐ（道を分ける）。道を少し越えた端でも通れる', () => {
  const g = graphOf(makeTile([{ cls: 2, pts: [[0, 2000], [4000, 2000]] }]))
  // 画像の高速: 北から南へ、一般道を 8 m 越えた所で終わる
  const r = addRasterRoads(g, [line(RK_MOTORWAY, [[2000, 200], [2000, Math.round(2000 + 8 * u)]])], true, lat)
  assert.equal(r.connections, 1)
  assert.equal(g.edgeCls[0], DISABLED_CLASS) // 元の一般道は、分けた辺で置き換えた
  const a = snapAt(g, 2000, 300)
  assert.ok(g.edgeSrc[a.edge] === 1 && g.edgeCls[a.edge] === 6)
  const b = snapAt(g, 100, 2000)
  const res = search(g, a, b, STANDARD)
  assert.ok(res, '画像の高速から一般道へ出られる')
  assert.ok(res.steps.some((s) => g.edgeSrc[s.edge] === 2), 'つなぐ線を通る')
  assert.ok(res.steps.every((s) => g.edgeCls[s.edge] !== DISABLED_CLASS))
  // 逆向きも
  assert.ok(search(g, b, a, STANDARD))
})

test('hybrid: ベクトルに同じ種類の道がある所は足さない。種類が違えば足す', () => {
  const mw = line(RK_MOTORWAY, [[2000 + Math.round(10 * u), 500], [2000 + Math.round(10 * u), 3500]])
  const g = graphOf(makeTile([{ cls: 6, med: 1, pts: [[2000, 0], [2000, 4000]] }]))
  const before = g.edgeCount
  assert.equal(addRasterRoads(g, [mw], true, lat).lines, 0)
  assert.equal(g.edgeCount, before)
  // 近くにあるのが一般道（市区町村道）なら、高速は足す
  const g2 = graphOf(makeTile([{ cls: 2, pts: [[2000, 0], [2000, 4000]] }]))
  assert.ok(addRasterRoads(g2, [mw], true, lat).lines > 0)
  assert.ok(g2.edgeSrc.some((s) => s === 1))
})

test('hybrid: 一部だけベクトルにある道は、無い所だけを足す', () => {
  // ベクトルの国道は y = 0〜2000 だけ。画像の国道は y = 0〜4000
  const g = graphOf(makeTile([{ cls: 4, pts: [[2000, 0], [2000, 2000]] }]))
  addRasterRoads(g, [line(RK_NATIONAL, [[2000, 0], [2000, 4000]])], true, lat)
  const added: number[] = []
  for (let e = 0; e < g.edgeCount; e++) if (g.edgeSrc[e] === 1) added.push(e)
  assert.ok(added.length > 0)
  for (const e of added) {
    for (let k = 0; k < g.shapeLength(e); k++) {
      const [, y] = g.shapePoint(e, k)
      assert.ok(y - TY * EXTENT > 2000 - 20 * u, `足したのはベクトルに無い所だけ（y=${y - TY * EXTENT}）`)
    }
  }
})

test('raster: 骨格の線をそのまま足す（つながない・分けない）', () => {
  const g = graphOf()
  const r = addRasterRoads(g, [line(RK_MOTORWAY, [[0, 2000], [2000, 2000]]), line(RK_NATIONAL, [[2000, 2000], [2000, 4000]])], false, lat)
  assert.equal(r.lines, 2)
  assert.equal(r.connections, 0)
  assert.deepEqual(g.edgeCls, [6, 4])
  const res = search(g, snapAt(g, 100, 2000), snapAt(g, 2000, 3900), STANDARD)
  assert.ok(res)
})

test('similarPaths: 離れが 50 m 以下・道のりの差が 5% 以下なら似ている', () => {
  const p = [ll(0, 2000), ll(4000, 2000)]
  const off = (m: number) => [ll(0, Math.round(2000 + m * u)), ll(4000, Math.round(2000 + m * u))]
  assert.equal(similarPaths(p, off(30)), true)
  assert.equal(similarPaths(p, off(80)), false)
  const detour = [ll(0, 2000), ll(2000, Math.round(2000 + 40 * u)), ll(2000, Math.round(2000 + 600 * u)), ll(2000, Math.round(2000 + 40 * u)), ll(4000, 2000)]
  assert.equal(similarPaths(p, detour), false) // 道のりが大きく違う
})

test('simplify: まっすぐな点は両端だけ残す。曲がり角は残す', () => {
  assert.deepEqual(simplify([0, 0, 1, 0, 2, 0, 3, 0], 0.5), [0, 0, 3, 0])
  assert.deepEqual(simplify([0, 0, 5, 0, 5, 5], 0.5), [0, 0, 5, 0, 5, 5])
})

// ── 画像の取得（偽の画像） ───────────────────────────────

/** 各タイルの x = 128 の列に、幅 8 画素の高速の緑の帯を描いた画像（そのほかは白） */
function bandSource(calls: string[] = []) {
  return async (z: number, x: number, y: number) => {
    calls.push(`${z}/${x}/${y}`)
    const data = new Uint8ClampedArray(256 * 256 * 4).fill(255)
    for (let j = 0; j < 256; j++) for (let i = 124; i < 132; i++) { const o = (j * 256 + i) * 4; data[o] = 0x64; data[o + 1] = 0xc3; data[o + 2] = 0x73 }
    return { width: 256, height: 256, data }
  }
}

/** z16 のタイル (tx, ty) の画素 (px, py) の緯度経度 */
function z16(tx: number, px: number, ty: number, py: number) {
  const s = 2 ** (14 + 12 - 8 - RASTER_ROAD_ZOOM)
  return worldToLatLng((tx * 256 + px) * s, (ty * 256 + py) * s)
}

test('RasterRoadSource: 区間のまわりの z16 の画像から、高速の骨格の線を世界座標で返す。画像は覚える', async () => {
  const calls: string[] = []
  const src = new RasterRoadSource(bandSource(calls))
  const tx = TX * 4 + 1, ty = TY * 4 + 1
  const from = z16(tx, 128, ty, 20), to = z16(tx, 128, ty + 2, 200)
  const r = await src.lines(from, to)
  assert.ok(r.ok)
  assert.ok(r.lines.length > 0)
  const s = 2 ** (14 + 12 - 8 - RASTER_ROAD_ZOOM)
  const col = r.lines.filter((l) => l.kind === RK_MOTORWAY && Math.abs(l.coords[0] - (tx * 256 + 128) * s) <= 3 * s)
  assert.ok(col.length > 0, '区間の上の帯の骨格がある')
  const n = calls.length
  assert.equal(n, r.tiles)
  await src.lines(from, to)
  assert.equal(calls.length, n, '2 回目は取得しない')
})

test('RasterRoadSource: 取得に失敗したら tile-error、斜めの長い区間は too-large', async () => {
  const bad = new RasterRoadSource(async () => { throw new Error('network') })
  const a = z16(TX * 4, 0, TY * 4, 0)
  const r = await bad.lines(a, z16(TX * 4, 0, TY * 4 + 3, 0))
  assert.deepEqual(r, { ok: false, reason: 'tile-error' })
  const big = await new RasterRoadSource(bandSource()).lines(a, z16(TX * 4 + 40, 0, TY * 4 + 40, 0))
  assert.deepEqual(big, { ok: false, reason: 'too-large' })
})

// ── Router と設定 ─────────────────────────────────────

test('Router: 地図画像を読めない環境（Node の既定）では、ベクトルだけで探して raster: unavailable', async () => {
  const router = new Router(async () => null, { coarseLoader: async () => null, raster: null })
  const o = resolveRoutingOptions({ ...DEFAULT_ROUTING_SETTINGS, source: 'hybrid' })
  const r = await router.routeLeg({ lat: 30, lng: 140 }, { lat: 30.01, lng: 140.01 }, o)
  assert.equal(r.reason, 'no-road')
  assert.equal(r.raster, 'unavailable')
})

test('Router: raster で画像に道が無ければ no-road。取得に失敗したらベクトルだけで探して tile-error', async () => {
  const white = async () => ({ width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4).fill(255) })
  const router = new Router(async () => null, { coarseLoader: async () => null, raster: white })
  const from = ll(1000, 1000), to = ll(3000, 3000)
  const r = await router.routeLeg(from, to, resolveRoutingOptions({ ...DEFAULT_ROUTING_SETTINGS, source: 'raster' }))
  assert.equal(r.reason, 'no-road')
  const failing = new Router(async () => null, { coarseLoader: async () => null, raster: async () => { throw new Error('x') } })
  const r2 = await failing.routeLeg(from, to, resolveRoutingOptions({ ...DEFAULT_ROUTING_SETTINGS, source: 'hybrid' }))
  assert.equal(r2.raster, 'tile-error')
  assert.equal(r2.reason, 'no-road') // ベクトルにも道が無い
})

test('Router: raster で画像の高速の帯をたどる', async () => {
  const router = new Router(async () => null, { coarseLoader: async () => null, raster: bandSource() })
  const tx = TX * 4 + 1, ty = TY * 4 + 1
  const from = z16(tx, 128, ty, 40), to = z16(tx, 128, ty + 2, 200)
  const r = await router.routeLeg(from, to, resolveRoutingOptions({ ...DEFAULT_ROUTING_SETTINGS, source: 'raster' }))
  assert.equal(r.status, 'ok', r.reason)
  assert.equal(r.raster, 'used')
  // 帯の中心（x = 128）から離れない
  const cx = latLngToWorld(from.lat, from.lng)[0]
  for (const p of r.points) assert.ok(Math.abs(latLngToWorld(p.lat, p.lng)[0] - cx) < 4 * 4)
})

test('設定: 経路の元の既定は vector。壊れた値は既定へ。探索の値に渡る', () => {
  assert.equal(DEFAULT_ROUTING_SETTINGS.source, 'vector')
  assert.equal(sanitizeSettings({ source: 'hybrid' }).source, 'hybrid')
  assert.equal(sanitizeSettings({ source: 'raster' }).source, 'raster')
  assert.equal(sanitizeSettings({ source: 'nope' }).source, 'vector')
  assert.equal(sanitizeSettings({}).source, 'vector')
  assert.equal(resolveRoutingOptions({ ...DEFAULT_ROUTING_SETTINGS, source: 'hybrid' }).source, 'hybrid')
})
