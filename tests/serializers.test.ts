// シリアライザ（GPX/GeoJSON/KML 出力）のユニットテスト（要件定義書9章）。
// gpxSerializer は '@/lib/version' 値インポートを含むため register-alias.mjs で解決。
// geojson/kml シリアライザは型のみ依存。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serializeGpx } from '../src/lib/serializers/gpxSerializer.ts'
import { serializeGeoJson } from '../src/lib/serializers/geojsonSerializer.ts'
import { serializeKml } from '../src/lib/serializers/kmlSerializer.ts'
import type { RouteData, TrackPoint } from '../src/types/route.ts'

const p = (lat: number, lng: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({ lat, lng, ...extra })

function route(over: Partial<RouteData> = {}): RouteData {
  return {
    id: 'r', name: 'MyRoute', sourceFormat: 'gpx', sourceFileName: 'r.gpx',
    kind: 'track',
    tracks: [{ name: 'trk1', points: [p(35.0, 139.0, { ele: 10 }), p(35.1, 139.1, { ele: 20 })] }],
    standaloneWaypoints: [],
    ...over,
  }
}

// ── GPX ────────────────────────────────────────────────────────────────
test('serializeGpx: trk として trkseg/trkpt を出力', () => {
  const xml = serializeGpx(route(), 'original')
  assert.match(xml, /<gpx/)
  assert.match(xml, /<trk>/)
  assert.match(xml, /<trkseg>/)
  assert.equal((xml.match(/<trkpt/g) ?? []).length, 2)
  assert.match(xml, /lat="35"/)
  assert.match(xml, /<ele>10\.00<\/ele>/)
})

test('serializeGpx: kind=route は rte/rtept で出力', () => {
  const xml = serializeGpx(route({ kind: 'route' }), 'original')
  assert.match(xml, /<rte>/)
  assert.equal((xml.match(/<rtept/g) ?? []).length, 2)
  assert.doesNotMatch(xml, /<trkseg>/)
})

test('serializeGpx: トラック名・番号を出力', () => {
  const xml = serializeGpx(route({ tracks: [{ name: 'T', number: 7, points: [p(0, 0)] }] }), 'original')
  assert.match(xml, /<name>T<\/name>/)
  assert.match(xml, /<number>7<\/number>/)
})

test('serializeGpx: original はウェイポイントを含む', () => {
  const xml = serializeGpx(route({ standaloneWaypoints: [{ lat: 1, lng: 2, name: 'wp' }] }), 'original')
  assert.match(xml, /<wpt lat="1" lon="2">/)
  assert.match(xml, /<name>wp<\/name>/)
})

test('serializeGpx: original-no-wpt はトラックの wpt を除外', () => {
  const xml = serializeGpx(route({ standaloneWaypoints: [{ lat: 1, lng: 2, name: 'wp' }] }), 'original-no-wpt')
  assert.doesNotMatch(xml, /<wpt /)
})

test('serializeGpx: minimal は trkpt の name/cmt/desc を削るが緯度経度標高時刻は残す', () => {
  const r = route({ tracks: [{ points: [p(35.0, 139.0, { ele: 5, time: new Date('2026-01-01T00:00:00Z'), waypoint: { name: 'x', cmt: 'c' } })] }] })
  const xml = serializeGpx(r, 'minimal')
  assert.match(xml, /<trkpt/)
  assert.match(xml, /<ele>5\.00<\/ele>/)
  assert.match(xml, /<time>/)
  // trkpt 内の name/cmt は削られる
  assert.doesNotMatch(xml, /<cmt>c<\/cmt>/)
})

test('serializeGpx: kind=waypoint は no-wpt モードでも wpt を保持（本体データのため）', () => {
  const r = route({ kind: 'waypoint', tracks: [], standaloneWaypoints: [{ lat: 1, lng: 2, name: 'wp' }] })
  const xml = serializeGpx(r, 'minimal-no-wpt')
  assert.match(xml, /<wpt lat="1" lon="2">/)
  assert.match(xml, /<name>wp<\/name>/)
})

test('serializeGpx: XML特殊文字はエスケープされる', () => {
  const r = route({ tracks: [{ name: 'a<b>&"c', points: [p(0, 0)] }] })
  const xml = serializeGpx(r, 'original')
  assert.match(xml, /a&lt;b&gt;&amp;&quot;c/)
})

test('serializeGpx: creator にアプリ名が入る', () => {
  const xml = serializeGpx(route(), 'original')
  assert.match(xml, /creator="GeoJSON \/ GPX \/ KML Editor"/)
})

// ── GeoJSON ──────────────────────────────────────────────────────────
test('serializeGeoJson: FeatureCollection の LineString を生成', () => {
  const json = JSON.parse(serializeGeoJson(route()))
  assert.equal(json.type, 'FeatureCollection')
  assert.equal(json.features[0].geometry.type, 'LineString')
  // [lng, lat, ele]
  assert.deepEqual(json.features[0].geometry.coordinates[0], [139.0, 35.0, 10])
})

test('serializeGeoJson: 時刻があれば coordTimes プロパティを付与', () => {
  const r = route({ tracks: [{ points: [
    p(0, 0, { time: new Date('2026-01-01T00:00:00Z') }),
    p(0, 1, { time: new Date('2026-01-01T00:01:00Z') }),
  ] }] })
  const json = JSON.parse(serializeGeoJson(r))
  assert.equal(json.features[0].properties.coordTimes.length, 2)
})

test('serializeGeoJson: 標高が無い点は [lng, lat] の2要素', () => {
  const r = route({ tracks: [{ points: [p(35, 139)] }] })
  const json = JSON.parse(serializeGeoJson(r))
  assert.deepEqual(json.features[0].geometry.coordinates[0], [139, 35])
})

test('serializeGeoJson: standaloneWaypoints は Point Feature として出力', () => {
  const r = route({ standaloneWaypoints: [{ lat: 1, lng: 2, name: 'wp', desc: 'd' }] })
  const json = JSON.parse(serializeGeoJson(r))
  const point = json.features.find((f: { geometry: { type: string } }) => f.geometry.type === 'Point')
  assert.ok(point)
  assert.deepEqual(point.geometry.coordinates, [2, 1])
  assert.equal(point.properties.description, 'd')
})

// ── KML ──────────────────────────────────────────────────────────────
test('serializeKml: Placemark/LineString/coordinates を生成', () => {
  const kml = serializeKml(route())
  assert.match(kml, /<kml/)
  assert.match(kml, /<Placemark>/)
  assert.match(kml, /<LineString>/)
  // lng,lat,ele 形式
  assert.match(kml, /139,35,10/)
})

test('serializeKml: 標高が無い点は z=0 で出力', () => {
  const kml = serializeKml(route({ tracks: [{ points: [p(35, 139)] }] }))
  assert.match(kml, /139,35,0/)
})

test('serializeKml: ドキュメント名と特殊文字エスケープ', () => {
  const kml = serializeKml(route({ name: 'A&B<C>' }))
  assert.match(kml, /<name>A&amp;B&lt;C&gt;<\/name>/)
})

test('serializeKml: standaloneWaypoints は Point Placemark として出力', () => {
  const r = route({ standaloneWaypoints: [{ lat: 1, lng: 2, name: 'wp', desc: 'メモ' }] })
  const kml = serializeKml(r)
  assert.match(kml, /<Point>/)
  assert.match(kml, /<coordinates>2,1,0<\/coordinates>/)
  assert.match(kml, /<description>メモ<\/description>/)
})
