// routeStats.ts のユニットテスト（要件定義書12.1）。
// '@/lib/geometry' 値インポートを含むため register-alias.mjs のフックで解決される。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRouteStats } from '../src/lib/routeStats.ts'
import type { RouteData, TrackPoint } from '../src/types/route.ts'

const p = (lat: number, lng: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({ lat, lng, ...extra })

function route(tracks: RouteData['tracks']): RouteData {
  return {
    id: 'r', name: 'r', sourceFormat: 'gpx', sourceFileName: 'r.gpx',
    kind: 'track', tracks, standaloneWaypoints: [],
  }
}

test('空トラックは全て0/null', () => {
  const s = computeRouteStats(route([]))
  assert.equal(s.distanceM, 0)
  assert.equal(s.pointCount, 0)
  assert.equal(s.maxEle, null)
  assert.equal(s.minEle, null)
  assert.equal(s.durationMs, null)
  assert.equal(s.avgSpeedKmh, null)
  assert.equal(s.maxSpeedKmh, null)
})

test('pointCount は全トラックの合計', () => {
  const s = computeRouteStats(route([{ points: [p(0, 0), p(0, 1)] }, { points: [p(1, 1)] }]))
  assert.equal(s.pointCount, 3)
})

test('総距離は全セグメントの積算（haversine）', () => {
  const s = computeRouteStats(route([{ points: [p(0, 0), p(0, 1), p(0, 2)] }]))
  // 経度2度分 ≈ 222.4km
  assert.ok(Math.abs(s.distanceM - 222389.8) < 20, `dist=${s.distanceM}`)
})

test('累積標高差: 登り(gain)と下り(loss)を別々に積算', () => {
  const s = computeRouteStats(route([{ points: [
    p(0, 0, { ele: 100 }),
    p(0, 0.001, { ele: 150 }), // +50
    p(0, 0.002, { ele: 120 }), // -30
    p(0, 0.003, { ele: 140 }), // +20
  ] }]))
  assert.equal(s.gainM, 70)
  assert.equal(s.lossM, 30)
})

test('最高標高・最低標高', () => {
  const s = computeRouteStats(route([{ points: [
    p(0, 0, { ele: 100 }), p(0, 1, { ele: 5 }), p(0, 2, { ele: 250 }),
  ] }]))
  assert.equal(s.maxEle, 250)
  assert.equal(s.minEle, 5)
})

test('標高が無い点は min/max 集計に影響しない', () => {
  const s = computeRouteStats(route([{ points: [p(0, 0), p(0, 1, { ele: 42 }), p(0, 2)] }]))
  assert.equal(s.maxEle, 42)
  assert.equal(s.minEle, 42)
})

test('総所要時間 = 先頭〜末尾の時刻差', () => {
  const s = computeRouteStats(route([{ points: [
    p(0, 0, { time: new Date('2026-01-01T00:00:00Z') }),
    p(0, 1, { time: new Date('2026-01-01T01:00:00Z') }),
  ] }]))
  assert.equal(s.durationMs, 3600_000)
})

test('時刻が無ければ所要時間・平均速度は null', () => {
  const s = computeRouteStats(route([{ points: [p(0, 0), p(0, 1)] }]))
  assert.equal(s.durationMs, null)
  assert.equal(s.avgSpeedKmh, null)
})

test('平均速度 = 総距離 / 総所要時間', () => {
  // 経度1度(≈111.19km)を1時間 → 約111km/h
  const s = computeRouteStats(route([{ points: [
    p(0, 0, { time: new Date('2026-01-01T00:00:00Z') }),
    p(0, 1, { time: new Date('2026-01-01T01:00:00Z') }),
  ] }]))
  assert.ok(s.avgSpeedKmh != null && Math.abs(s.avgSpeedKmh - 111.19) < 0.5, `avg=${s.avgSpeedKmh}`)
})

test('最高速度は最速セグメントの速度', () => {
  const s = computeRouteStats(route([{ points: [
    p(0, 0, { time: new Date('2026-01-01T00:00:00Z') }),
    p(0, 1, { time: new Date('2026-01-01T01:00:00Z') }), // 1度/1h
    p(0, 3, { time: new Date('2026-01-01T01:30:00Z') }), // 2度/0.5h ＝ 速い
  ] }]))
  // 最速区間は 2度/0.5h ≈ 444km/h
  assert.ok(s.maxSpeedKmh != null && s.maxSpeedKmh > 400, `max=${s.maxSpeedKmh}`)
})

test('複数トラックで距離・所要時間・点数を合算', () => {
  const s = computeRouteStats(route([
    { points: [
      p(0, 0, { time: new Date('2026-01-01T00:00:00Z') }),
      p(0, 1, { time: new Date('2026-01-01T01:00:00Z') }),
    ] },
    { points: [
      p(10, 10, { time: new Date('2026-01-01T02:00:00Z') }),
      p(10, 11, { time: new Date('2026-01-01T03:00:00Z') }),
    ] },
  ]))
  assert.equal(s.pointCount, 4)
  // 各トラック1時間 → 合計2時間
  assert.equal(s.durationMs, 2 * 3600_000)
})
