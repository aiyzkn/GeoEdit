// palette.ts のユニットテスト。色値は 2026-07-13 の実タイル実測に基づく（palette.ts 冒頭コメント参照）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BG, ROAD, EDGE, IGNORE } from '../src/lib/mapMatch/types.ts'
import { classifyPixel } from '../src/lib/mapMatch/palette.ts'

test('標準地図: 道路の塗りは ROAD に分類される', () => {
  assert.equal(classifyPixel('gsi-std', 255, 255, 255), ROAD, '一般道（白）')
  assert.equal(classifyPixel('gsi-std', 245, 245, 245), ROAD, '一般道のアンチエイリアス')
  assert.equal(classifyPixel('gsi-std', 255, 122, 122), ROAD, '国道 #ff7a7a')
  assert.equal(classifyPixel('gsi-std', 255, 255, 0), ROAD, '都道府県道 #ffff00')
  assert.equal(classifyPixel('gsi-std', 100, 195, 115), ROAD, '高速道路 #64c373')
})

test('標準地図: 道路以外は ROAD に分類されない', () => {
  assert.equal(classifyPixel('gsi-std', 255, 135, 75), BG, '市街地塗り #ff874b（国道と近い色）')
  assert.equal(classifyPixel('gsi-std', 190, 210, 255), BG, '水域 #bed2ff')
  assert.equal(classifyPixel('gsi-std', 216, 216, 216), BG, '建物 #d8d8d8')
  assert.equal(classifyPixel('gsi-std', 100, 100, 100), EDGE, '道路縁 #646464')
  assert.equal(classifyPixel('gsi-std', 138, 138, 138), EDGE, '中間グレー #8a8a8a')
})

test('標準地図: 注記・記号は IGNORE に分類される', () => {
  assert.equal(classifyPixel('gsi-std', 0, 0, 0), IGNORE, '注記黒')
  assert.equal(classifyPixel('gsi-std', 0, 90, 60), IGNORE, '駅名等の緑注記 #005a3c')
  assert.equal(classifyPixel('gsi-std', 20, 90, 255), IGNORE, '地下鉄等の青 #145aff')
  assert.equal(classifyPixel('gsi-std', 200, 160, 60), IGNORE, '行政界の金色破線 #c8a03c')
})

test('淡色地図: 道路の塗りは ROAD、市街地は BG に分類される', () => {
  assert.equal(classifyPixel('gsi-pale', 255, 255, 255), ROAD, '一般道・都道府県道（白）')
  assert.equal(classifyPixel('gsi-pale', 255, 220, 150), ROAD, '国道 #ffdc96')
  assert.equal(classifyPixel('gsi-pale', 120, 220, 160), ROAD, '高速道路 #78dca0')
  assert.equal(classifyPixel('gsi-pale', 210, 210, 210), BG, '市街地塗り #d2d2d2')
  assert.equal(classifyPixel('gsi-pale', 100, 100, 100), EDGE, '道路縁 #646464')
})

test('白地図: 全画素 BG（道路が描画されないため常にフォールバック）', () => {
  assert.equal(classifyPixel('gsi-blank', 255, 255, 255), BG)
  assert.equal(classifyPixel('gsi-blank', 0, 0, 0), BG)
})
