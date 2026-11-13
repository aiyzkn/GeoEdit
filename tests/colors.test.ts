// colors.ts のユニットテスト。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeColor, ROUTE_COLORS } from '../src/lib/colors.ts'

test('routeColor: 明示色が指定されていればそのまま返す', () => {
  assert.equal(routeColor('#123456', 0), '#123456')
  assert.equal(routeColor('#123456', 3), '#123456')
})

test('routeColor: undefined ならインデックスでパレットから選ぶ', () => {
  assert.equal(routeColor(undefined, 0), ROUTE_COLORS[0])
  assert.equal(routeColor(undefined, 2), ROUTE_COLORS[2])
})

test('routeColor: インデックスはパレット長で循環する', () => {
  const n = ROUTE_COLORS.length
  assert.equal(routeColor(undefined, n), ROUTE_COLORS[0])
  assert.equal(routeColor(undefined, n + 1), ROUTE_COLORS[1])
})

test('ROUTE_COLORS: 8色でありすべて有効な16進カラー', () => {
  assert.equal(ROUTE_COLORS.length, 8)
  for (const c of ROUTE_COLORS) {
    assert.match(c, /^#[0-9a-f]{6}$/i)
  }
})
