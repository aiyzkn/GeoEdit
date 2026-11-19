// 標高のタイル方式・時刻の速度指定・形を保つ間引き（designs/機能追加・UI改善設計書.md B3〜B6）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeDemPixel, pixelOf, DemTileReader, type DemImage, type DemLayer } from '../src/lib/elevationTiles.ts'
import {
  redistributeTime, redistributeTimeWithRange, estimateDurationMs, simplifyByTolerance, WALK,
} from '../src/lib/editors/routeEditors.ts'
import { computeGainLoss } from '../src/lib/routeStats.ts'
import { addAnchor, emptyDraft, setLegResult, draftPointsSimplified, draftPoints } from '../src/lib/editors/draft.ts'
import type { TrackPoint } from '../src/types/route.ts'

// ── B6: 標高タイル ─────────────────────────────────────────────

test('decodeDemPixel: 地理院の標高タイルの式（0.01 m 単位、2^23 は無効、負の値）', () => {
  // 457.34 m（上田で API と突き合わせた値）= 45734 = 0x00B2A6
  assert.equal(decodeDemPixel(0x00, 0xb2, 0xa6), 457.3)
  assert.equal(decodeDemPixel(0, 0, 0), 0)
  assert.equal(decodeDemPixel(128, 0, 0), null) // 無効値
  // 負の値: x = 2^24 − 500（−5.00 m）
  const x = 2 ** 24 - 500
  assert.equal(decodeDemPixel((x >> 16) & 255, (x >> 8) & 255, x & 255), -5)
  assert.equal(decodeDemPixel(0, 0, 100, 0), null) // 透明
})

test('pixelOf: タイル番号と画素', () => {
  const p = pixelOf(36.40, 138.25, 15)
  assert.equal(p.x, Math.floor(((138.25 + 180) / 360) * 2 ** 15))
  assert.ok(p.px >= 0 && p.px < 256 && p.py >= 0 && p.py < 256)
})

/** すべての画素が同じ標高 m の画像（m = null なら無効値） */
function flatImage(m: number | null): DemImage {
  const data = new Uint8ClampedArray(256 * 256 * 4)
  const x = m === null ? 2 ** 23 : Math.round(m * 100)
  for (let i = 0; i < 256 * 256; i++) {
    data[4 * i] = (x >> 16) & 255
    data[4 * i + 1] = (x >> 8) & 255
    data[4 * i + 2] = x & 255
    data[4 * i + 3] = 255
  }
  return { width: 256, height: 256, data }
}

test('DemTileReader: 5 m メッシュが無効・無い所は 10 m メッシュ。両方無い点は null', async () => {
  const calls: string[] = []
  const reader = new DemTileReader(async (layer: DemLayer, z, x, y) => {
    calls.push(`${layer.id}/${z}/${x}/${y}`)
    if (layer.id === 'dem5a_png') return x % 2 === 0 ? flatImage(100) : flatImage(null) // 偶数の列だけ 5 m がある
    return x % 4 === 1 ? flatImage(50) : null // 10 m は一部だけ
  })
  // z15 で偶数列・奇数列になる 2 点と、どちらも無い点
  const lngOf = (col: number) => (col + 0.5) / 2 ** 15 * 360 - 180
  const even = { lat: 36.4, lng: lngOf(2 * 14000) }
  const odd = { lat: 36.4, lng: lngOf(2 * 14000 + 1) }
  const r = await reader.elevations([even, odd])
  assert.equal(r[0], 100)
  // 奇数列の点は z14 で列 14000 → 14000 % 4 = 0 → 10 m も無い
  assert.equal(r[1], null)
  // 同じタイルは 2 回取らない
  const before = calls.length
  await reader.elevations([even])
  assert.equal(calls.length, before)
})

test('DemTileReader: 取得の失敗は覚えず、次は取り直す', async () => {
  let fail = true
  const reader = new DemTileReader(async () => { if (fail) throw new Error('network'); return flatImage(12.3) })
  const p = { lat: 35.7, lng: 139.7 }
  assert.deepEqual(await reader.elevations([p]), [null])
  fail = false
  assert.deepEqual(await reader.elevations([p]), [12.3])
})

// ── B3: 速度の指定 ─────────────────────────────────────────────

const flat: TrackPoint[] = [
  { lat: 35.0, lng: 139.0, ele: 0 },
  { lat: 35.0, lng: 139.011, ele: 0 }, // 約 1 km
  { lat: 35.0, lng: 139.022, ele: 0 },
]

test('estimateDurationMs: 徒歩は平地 4 km/h、一定の速度は道のりに比例', () => {
  const walk = estimateDurationMs(flat, WALK)
  const km = (walk / 3_600_000) * 4
  assert.ok(km > 1.95 && km < 2.05, `km ${km}`)
  const c20 = estimateDurationMs(flat, { kind: 'constant', kmh: 20 })
  assert.ok(Math.abs(c20 - walk / 5) < 2)
  // 範囲外の速度は 1〜200 に丸める
  assert.equal(estimateDurationMs(flat, { kind: 'constant', kmh: 1000 }), estimateDurationMs(flat, { kind: 'constant', kmh: 200 }))
})

test('redistributeTime: 既定は徒歩（いままでと同じ）。一定の速度を指定できる', () => {
  const start = new Date('2026-11-19T09:00:00')
  const a = redistributeTime(flat, start)
  const b = redistributeTime(flat, start, WALK)
  assert.deepEqual(a.map((p) => p.time!.getTime()), b.map((p) => p.time!.getTime()))
  const c = redistributeTime(flat, start, { kind: 'constant', kmh: 40 })
  const total = c[2].time!.getTime() - start.getTime()
  assert.ok(Math.abs(total - estimateDurationMs(flat, { kind: 'constant', kmh: 40 })) <= 2)
  // 終了日時を指定すると、速度によらず合計は終了日時に合う
  const end = new Date('2026-11-19T10:00:00')
  const d = redistributeTimeWithRange(flat, start, end, { kind: 'constant', kmh: 40 })
  assert.equal(d[2].time!.getTime(), end.getTime())
})

// ── B4: 形を保つ間引き ─────────────────────────────────────────

test('simplifyByTolerance: まっすぐな所の点は落とし、角の頂点は残す。両端・ウェイポイントは残す', () => {
  const pts: TrackPoint[] = []
  for (let i = 0; i <= 10; i++) pts.push({ lat: 35, lng: 139 + i * 0.001 }) // 東へまっすぐ
  for (let i = 1; i <= 10; i++) pts.push({ lat: 35 + i * 0.001, lng: 139.01 }) // 北へ曲がる
  pts[5] = { ...pts[5], waypoint: { name: 'WP' } }
  const out = simplifyByTolerance(pts, 2)
  assert.deepEqual(out.map((p) => pts.indexOf(p)), [0, 5, 10, 20])
  // 許容を大きくしても、ウェイポイントと両端は残る
  assert.ok(simplifyByTolerance(pts, 100000).includes(pts[5]))
  // 2 点以下はそのまま
  assert.equal(simplifyByTolerance(pts.slice(0, 2), 2).length, 2)
})

test('simplifyByTolerance: 許容より小さいずれは落とし、大きいずれは残す', () => {
  // 東西 1 km の線の真ん中が、北へ約 1.1 m（0.00001°）または約 5.5 m ずれる
  const mk = (dLat: number): TrackPoint[] => [{ lat: 35, lng: 139 }, { lat: 35 + dLat, lng: 139.0055 }, { lat: 35, lng: 139.011 }]
  assert.equal(simplifyByTolerance(mk(0.00001), 2).length, 2)
  assert.equal(simplifyByTolerance(mk(0.00005), 2).length, 3)
})

test('draftPointsSimplified: 経路探索で結べた区間だけ間引く。通過点は残る', () => {
  let d = addAnchor(addAnchor(addAnchor(emptyDraft(), { id: 'a', lat: 35, lng: 139 }, 'auto'), { id: 'b', lat: 35, lng: 139.01 }, 'auto'), { id: 'c', lat: 35.01, lng: 139.01 }, 'straight')
  const line = [] as { lat: number; lng: number }[]
  for (let i = 0; i <= 10; i++) line.push({ lat: 35, lng: 139 + i * 0.001 })
  d = setLegResult(d, d.legs[0].id, 0, { status: 'ok', points: line, distance: 900 })
  assert.equal(draftPoints(d).length, 12) // 11 + 通過点 c
  assert.deepEqual(draftPointsSimplified(d, true), [{ lat: 35, lng: 139 }, { lat: 35, lng: 139.01 }, { lat: 35.01, lng: 139.01 }])
  assert.equal(draftPointsSimplified(d, false).length, 12)
})

test('computeGainLoss: 標高の無い区間は数えない', () => {
  assert.deepEqual(computeGainLoss([{ ele: 10 }, { ele: 15 }, {}, { ele: 30 }, { ele: 20 }]), { gainM: 5, lossM: 10 })
})
