// geometry.ts のユニットテスト。
// 実行: npm test（node --test。型ストリッピングで .ts を直接実行。エイリアス '@/' は
// tests/register-alias.mjs のフックで解決するが、このモジュールは型のみ依存なので不要）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineM, nearestPointIndex } from '../src/lib/geometry.ts'
import type { TrackPoint } from '../src/types/route.ts'

const pt = (lat: number, lng: number): TrackPoint => ({ lat, lng })

test('haversineM: 同一地点は距離0', () => {
  assert.equal(haversineM(35.68, 139.76, 35.68, 139.76), 0)
})

test('haversineM: 赤道上の経度1度は約111.19km', () => {
  const d = haversineM(0, 0, 0, 1)
  // 6371000 * (π/180) ≈ 111194.9 m
  assert.ok(Math.abs(d - 111194.9) < 5, `d=${d}`)
})

test('haversineM: 緯度1度は経度によらず約111.19km', () => {
  const atEquator = haversineM(0, 0, 1, 0)
  const atTokyo = haversineM(35, 139, 36, 139)
  assert.ok(Math.abs(atEquator - 111194.9) < 5, `equator=${atEquator}`)
  assert.ok(Math.abs(atTokyo - 111194.9) < 5, `tokyo=${atTokyo}`)
})

test('haversineM: 対称性（a→b と b→a は等しい）', () => {
  const ab = haversineM(35.681, 139.767, 34.702, 135.495)
  const ba = haversineM(34.702, 135.495, 35.681, 139.767)
  assert.equal(ab, ba)
})

test('haversineM: 東京〜大阪は約400km前後', () => {
  const d = haversineM(35.681236, 139.767125, 34.702485, 135.495951)
  assert.ok(d > 390_000 && d < 410_000, `d=${d}`)
})

test('nearestPointIndex: 空配列は null', () => {
  assert.equal(nearestPointIndex(0, 0, []), null)
})

test('nearestPointIndex: 単一点はその点を返す', () => {
  const r = nearestPointIndex(0, 0, [pt(1, 1)])
  assert.equal(r?.index, 0)
  assert.ok(r!.distM > 0)
})

test('nearestPointIndex: 最も近い点のインデックスを返す', () => {
  const points = [pt(0, 0), pt(0, 10), pt(0, 20)]
  // (0, 9) は index1(0,10) に最も近い
  const r = nearestPointIndex(0, 9, points)
  assert.equal(r?.index, 1)
})

test('nearestPointIndex: 同距離のときは先に現れた方を返す', () => {
  const points = [pt(0, 0), pt(0, 2)]
  // (0,1) は両点から等距離 → 厳密不等号 (<) のため先勝ちで index0
  const r = nearestPointIndex(0, 1, points)
  assert.equal(r?.index, 0)
})

test('nearestPointIndex: distM は実距離（haversine）と一致', () => {
  const points = [pt(35.0, 139.0), pt(36.0, 139.0)]
  const r = nearestPointIndex(35.1, 139.0, points)
  assert.equal(r?.index, 0)
  assert.equal(r?.distM, haversineM(35.1, 139.0, 35.0, 139.0))
})
