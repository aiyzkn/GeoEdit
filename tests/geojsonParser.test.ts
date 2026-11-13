// geojsonParser.ts のユニットテスト（要件定義書4章）。
// GPX/KMLパーサーは DOMParser（ブラウザAPI）依存のため node:test では動かせず、
// E2E 側でカバーする。GeoJSONパーサーは JSON.parse のみで DOM 非依存のため単体テスト可能。
// crypto.randomUUID() は Node に存在する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGeoJson } from '../src/lib/parsers/geojsonParser.ts'

test('FeatureCollection の LineString を1ルートとして読み込む', () => {
  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'ルートA' },
      geometry: { type: 'LineString', coordinates: [[139, 35, 10], [139.1, 35.1, 20]] },
    }],
  })
  const routes = parseGeoJson(gj, 'test.geojson')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].name, 'ルートA')
  assert.equal(routes[0].kind, 'track')
  assert.equal(routes[0].tracks[0].points.length, 2)
  // coordinates は [lng, lat, ele] → TrackPoint に反転して格納
  assert.equal(routes[0].tracks[0].points[0].lat, 35)
  assert.equal(routes[0].tracks[0].points[0].lng, 139)
  assert.equal(routes[0].tracks[0].points[0].ele, 10)
})

test('複数 Feature はそれぞれ別ルートになる', () => {
  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      { type: 'Feature', properties: { name: 'B' }, geometry: { type: 'LineString', coordinates: [[2, 2], [3, 3]] } },
    ],
  })
  const routes = parseGeoJson(gj, 'multi.geojson')
  assert.equal(routes.length, 2)
  assert.deepEqual(routes.map((r) => r.name), ['A', 'B'])
})

test('名前の無い Feature が複数ならファイル名 + 連番で命名', () => {
  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[2, 2], [3, 3]] } },
    ],
  })
  const routes = parseGeoJson(gj, 'trip.geojson')
  assert.equal(routes[0].name, 'trip (1)')
  assert.equal(routes[1].name, 'trip (2)')
})

test('coordTimes を時刻として読み込む', () => {
  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { coordTimes: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'] },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    }],
  })
  const routes = parseGeoJson(gj, 'timed.geojson')
  const pts = routes[0].tracks[0].points
  assert.ok(pts[0].time instanceof Date)
  assert.equal(pts[1].time!.toISOString(), '2026-01-01T00:01:00.000Z')
})

test('MultiLineString は複数トラックとして読み込む', () => {
  const gj = JSON.stringify({
    type: 'Feature',
    properties: { name: 'multi' },
    geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3], [4, 4]]] },
  })
  const routes = parseGeoJson(gj, 'ml.geojson')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].tracks.length, 2)
  assert.equal(routes[0].tracks[0].points.length, 2)
  assert.equal(routes[0].tracks[1].points.length, 3)
})

test('Point のみのファイルは kind=waypoint の単一ルート', () => {
  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'p1', description: 'desc' }, geometry: { type: 'Point', coordinates: [139, 35, 3] } },
      { type: 'Feature', properties: { name: 'p2' }, geometry: { type: 'Point', coordinates: [140, 36] } },
    ],
  })
  const routes = parseGeoJson(gj, 'points.geojson')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'waypoint')
  assert.equal(routes[0].name, 'points')
  assert.equal(routes[0].standaloneWaypoints.length, 2)
  assert.equal(routes[0].standaloneWaypoints[0].ele, 3)
  assert.equal(routes[0].standaloneWaypoints[0].desc, 'desc')
})

test('裸のジオメトリ（Featureで包まれていない LineString）も読める', () => {
  const gj = JSON.stringify({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })
  const routes = parseGeoJson(gj, 'bare.geojson')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].tracks[0].points.length, 2)
})

test('ライン + Point 混在: Point は先頭ルートの standaloneWaypoints へ付与', () => {
  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'line' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      { type: 'Feature', properties: { name: 'wp' }, geometry: { type: 'Point', coordinates: [5, 5] } },
    ],
  })
  const routes = parseGeoJson(gj, 'mix.geojson')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'track')
  assert.equal(routes[0].standaloneWaypoints.length, 1)
})

test('sourceFormat / sourceFileName が設定される', () => {
  const gj = JSON.stringify({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })
  const routes = parseGeoJson(gj, 'my.geojson')
  assert.equal(routes[0].sourceFormat, 'geojson')
  assert.equal(routes[0].sourceFileName, 'my.geojson')
})
