// 結合テスト（データパイプライン）: parse → edit → serialize を複数モジュールにまたいで検証する。
//
// 位置づけ:
//   - ユニット   : 各関数単体の入出力（tests/*.test.ts）
//   - 結合(これ) : パーサー→編集ロジック→シリアライザを繋いだ「データが端から端まで
//                  壊れずに流れるか」を検証。フォーマット変換・往復・編集反映など、
//                  単体では見えない結合部の不整合を捕捉する
//   - E2E        : ブラウザUI導線（tests/e2e/）
//
// 制約: GPX/KMLパーサーは DOMParser 依存で node:test では動かせないため、入口は
//       GeoJSONパーサー（純粋）に統一する。出口は3形式すべてのシリアライザを対象にできる。
//       '@/' 値インポートは tests/register-alias.mjs のフックで解決される。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGeoJson } from '../../src/lib/parsers/geojsonParser.ts'
import { serializeGpx } from '../../src/lib/serializers/gpxSerializer.ts'
import { serializeGeoJson } from '../../src/lib/serializers/geojsonSerializer.ts'
import { serializeKml } from '../../src/lib/serializers/kmlSerializer.ts'
import {
  convertRouteKind, thinOutByDistance, deleteRange, reverseTrack,
  redistributeTime, mergeRoutesSimple,
} from '../../src/lib/editors/routeEditors.ts'
import { computeRouteStats } from '../../src/lib/routeStats.ts'
import type { RouteData } from '../../src/types/route.ts'

// ── フィクスチャ生成 ───────────────────────────────────────────────────
function lineFC(coords: number[][], props: Record<string, unknown> = { name: 'L' }) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } }],
  })
}

const FIVE = [
  [139.767125, 35.681236, 3],
  [139.768, 35.682, 4],
  [139.7695, 35.683, 5.5],
  [139.7703, 35.6842, 6],
  [139.771, 35.6855, 7.5],
]

// ── フォーマット変換（GeoJSON → 各形式）─────────────────────────────────
test('GeoJSON→GPX: 座標・点数・標高が保持される', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  const gpx = serializeGpx(route, 'original')
  assert.equal((gpx.match(/<trkpt/g) ?? []).length, 5)
  assert.match(gpx, /lat="35.681236"/)
  assert.match(gpx, /lon="139.767125"/)
  assert.match(gpx, /<ele>3\.00<\/ele>/)
})

test('GeoJSON→KML: lng,lat,ele 形式の coordinates が出力される', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  const kml = serializeKml(route)
  assert.match(kml, /<LineString>/)
  assert.match(kml, /139.767125,35.681236,3/)
})

// ── 種別変換を挟んだパイプライン ────────────────────────────────────────
test('parse→convertRouteKind(track→route)→GPX: <rte>/<rtept> になる', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  const asRoute = convertRouteKind(route, 'route')
  const gpx = serializeGpx(asRoute, 'original')
  assert.match(gpx, /<rte>/)
  assert.equal((gpx.match(/<rtept/g) ?? []).length, 5)
  assert.doesNotMatch(gpx, /<trkseg>/)
})

test('parse→convertRouteKind(→waypoint)→GPX: 全点が <wpt> になる', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  const asWpt = convertRouteKind(route, 'waypoint')
  const gpx = serializeGpx(asWpt, 'original')
  assert.equal((gpx.match(/<wpt /g) ?? []).length, 5)
  assert.doesNotMatch(gpx, /<trk>/)
})

// ── 編集がシリアライズ結果に反映されるか ────────────────────────────────
test('parse→thinOutByDistance→GPX: 間引き後の点数が出力に反映される', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  const thinned = thinOutByDistance(route.tracks[0].points, 100_000) // 始点・終点のみ
  route.tracks[0].points = thinned
  const gpx = serializeGpx(route, 'original')
  assert.equal((gpx.match(/<trkpt/g) ?? []).length, 2)
})

test('parse→deleteRange→GPX: 区間削除が出力に反映される', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  route.tracks[0].points = deleteRange(route.tracks[0].points, 1, 3) // 3点削除→2点
  const gpx = serializeGpx(route, 'original')
  assert.equal((gpx.match(/<trkpt/g) ?? []).length, 2)
})

test('parse→reverseTrack→GPX: 逆順になり時刻が消える', () => {
  const timed = lineFC(FIVE, { name: 'L', coordTimes: FIVE.map((_, i) => `2026-01-01T00:0${i}:00Z`) })
  const route = parseGeoJson(timed, 'r.geojson')[0]
  route.tracks[0].points = reverseTrack(route.tracks[0].points)
  const gpx = serializeGpx(route, 'original')
  // 逆順で先頭が元の末尾（lon 139.771）になる
  const firstLat = gpx.match(/lat="([\d.]+)"/)![1]
  assert.equal(firstLat, '35.6855')
  // 時刻は除去される（要件6.10）
  assert.doesNotMatch(gpx, /<time>/)
})

test('parse→redistributeTime→GPX: 時刻が付与され単調増加する', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  route.tracks[0].points = redistributeTime(route.tracks[0].points, new Date('2026-01-01T00:00:00Z'))
  const gpx = serializeGpx(route, 'original')
  const times = [...gpx.matchAll(/<time>([^<]+)<\/time>/g)].map((m) => Date.parse(m[1]))
  assert.equal(times.length, 5)
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `time[${i}] 単調増加`)
})

// ── 複数ルートの結合パイプライン ────────────────────────────────────────
test('2ルートを parse→mergeRoutesSimple→GPX: トラックが連結される', () => {
  const a = parseGeoJson(lineFC([[0, 0], [0, 1]]), 'a.geojson')[0]
  const b = parseGeoJson(lineFC([[0, 2], [0, 3]]), 'b.geojson')[0]
  const mergedTracks = mergeRoutesSimple(a.tracks, b.tracks)
  const merged: RouteData = { ...a, tracks: mergedTracks }
  const gpx = serializeGpx(merged, 'original')
  // 2トラック → trkseg が2つ
  assert.equal((gpx.match(/<trkseg>/g) ?? []).length, 2)
  assert.equal((gpx.match(/<trkpt/g) ?? []).length, 4)
})

// ── 往復（round-trip）安定性 ────────────────────────────────────────────
test('GeoJSON round-trip: parse→serializeGeoJson→parse で座標・点数が保たれる', () => {
  const original = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  const reparsed = parseGeoJson(serializeGeoJson(original), 'r2.geojson')[0]
  assert.equal(reparsed.tracks[0].points.length, 5)
  assert.deepEqual(
    reparsed.tracks[0].points.map((p) => [p.lng, p.lat, p.ele]),
    original.tracks[0].points.map((p) => [p.lng, p.lat, p.ele]),
  )
})

test('GeoJSON round-trip: coordTimes（時刻）も保たれる', () => {
  const timed = lineFC(FIVE, { name: 'L', coordTimes: FIVE.map((_, i) => `2026-01-01T00:0${i}:00.000Z`) })
  const original = parseGeoJson(timed, 'r.geojson')[0]
  const reparsed = parseGeoJson(serializeGeoJson(original), 'r2.geojson')[0]
  assert.deepEqual(
    reparsed.tracks[0].points.map((p) => p.time?.toISOString()),
    original.tracks[0].points.map((p) => p.time?.toISOString()),
  )
})

// ── ウェイポイントのパイプライン ────────────────────────────────────────
test('Point-only GeoJSON → 各形式でウェイポイントが保持される', () => {
  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'P1', description: 'd1' }, geometry: { type: 'Point', coordinates: [139, 35, 10] } },
      { type: 'Feature', properties: { name: 'P2' }, geometry: { type: 'Point', coordinates: [140, 36] } },
    ],
  })
  const route = parseGeoJson(gj, 'wpt.geojson')[0]
  assert.equal(route.kind, 'waypoint')

  const gpx = serializeGpx(route, 'original')
  assert.equal((gpx.match(/<wpt /g) ?? []).length, 2)
  assert.match(gpx, /<name>P1<\/name>/)

  const kml = serializeKml(route)
  assert.equal((kml.match(/<Point>/g) ?? []).length, 2)

  const back = parseGeoJson(serializeGeoJson(route), 'wpt2.geojson')[0]
  assert.equal(back.standaloneWaypoints.length, 2)
})

// ── パーサー出力に対する統計の整合 ──────────────────────────────────────
test('parse→computeRouteStats: 点数と標高範囲がパイプラインと整合する', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  const stats = computeRouteStats(route)
  assert.equal(stats.pointCount, 5)
  assert.equal(stats.maxEle, 7.5)
  assert.equal(stats.minEle, 3)
  assert.ok(stats.distanceM > 0)
})

test('parse→編集(間引き)→computeRouteStats: 編集後の点数が統計に反映される', () => {
  const route = parseGeoJson(lineFC(FIVE), 'r.geojson')[0]
  route.tracks[0].points = thinOutByDistance(route.tracks[0].points, 100_000)
  assert.equal(computeRouteStats(route).pointCount, 2)
})
