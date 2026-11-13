// zoomRange.ts とタイル定義（tileLayers.ts）のズーム範囲に関するユニットテスト。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  baseZoomRange,
  baseTileZoomOptions,
  overlayTileZoomOptions,
  clampZoom,
  describeZoomRange,
  OVERZOOM_LEVELS,
  MAP_MAX_ZOOM_CAP,
} from '../src/lib/zoomRange.ts'
import { BASE_LAYERS, OVERLAY_LAYERS } from '../src/lib/tileLayers.ts'

test('baseZoomRange: 未指定は 0〜18（＋拡大表示）', () => {
  const r = baseZoomRange({ type: 'raster' })
  assert.equal(r.min, 0)
  assert.equal(r.nativeMax, 18)
  assert.equal(r.max, 18 + OVERZOOM_LEVELS)
})

test('baseZoomRange: 提供上限が低い地図は OVERZOOM_LEVELS 段だけ拡大できる', () => {
  const r = baseZoomRange({ type: 'raster', minZoom: 5, maxZoom: 14 })
  assert.deepEqual(r, { min: 5, max: 14 + OVERZOOM_LEVELS, nativeMin: 5, nativeMax: 14 })
})

test('baseZoomRange: 上限は MAP_MAX_ZOOM_CAP を超えないが、提供上限より下げない', () => {
  assert.equal(baseZoomRange({ type: 'raster', maxZoom: 19 }).max, Math.max(19, Math.min(19 + OVERZOOM_LEVELS, MAP_MAX_ZOOM_CAP)))
  assert.equal(baseZoomRange({ type: 'raster', maxZoom: 20 }).max, 20)
})

test('baseZoomRange: ベクトル地図もラスタと同じ規則（上限超えは拡大表示）', () => {
  assert.deepEqual(baseZoomRange({ type: 'vector', minZoom: 5, maxZoom: 18 }), {
    min: 5,
    max: Math.min(18 + OVERZOOM_LEVELS, MAP_MAX_ZOOM_CAP),
    nativeMin: 5,
    nativeMax: 18,
  })
})

test('地理院地図Vector: タイル提供範囲 4〜16 と画面のズーム範囲（＝タイルのズーム＋1）が整合している', () => {
  const def = BASE_LAYERS.find((l) => l.id === 'gsi-vector')!
  const style = def.style as { sources: Record<string, { minzoom?: number; maxzoom?: number }> }
  const src = style.sources.bvmap
  assert.equal(src.minzoom, 4)
  assert.equal(src.maxzoom, 16, 'z17 以上のタイルは存在しないので 16 にしてオーバーズームさせる')
  const r = baseZoomRange(def)
  // 画面のズーム z のとき MapLibre は z-1 で描画する。縮小下限でもタイル範囲内であること
  assert.ok(r.min - 1 >= src.minzoom!, `min=${r.min}`)
  assert.equal(r.nativeMax, 18)
})

test('clampZoom', () => {
  assert.equal(clampZoom(10, { min: 14, max: 20 }), 14)
  assert.equal(clampZoom(10, { min: 5, max: 13 }), 10)
  assert.equal(clampZoom(19, { min: 5, max: 13 }), 13)
})

test('baseTileZoomOptions / overlayTileZoomOptions: maxNativeZoom は提供上限、maxZoom はそれ以上', () => {
  const b = baseTileZoomOptions({ type: 'raster', minZoom: 5, maxZoom: 11 })
  assert.equal(b.maxNativeZoom, 11)
  assert.ok(b.maxZoom >= b.maxNativeZoom)
  assert.equal(b.minZoom, 5)
  const o = overlayTileZoomOptions({ minZoom: 14, maxZoom: 18 })
  assert.deepEqual(o, { minZoom: 14, maxZoom: MAP_MAX_ZOOM_CAP, maxNativeZoom: 18 })
})

test('describeZoomRange', () => {
  assert.equal(describeZoomRange({ min: 5, max: 16, nativeMin: 5, nativeMax: 14 }), 'ズーム 5〜16（15以上は拡大表示）')
  assert.equal(describeZoomRange({ min: 4, max: 18, nativeMin: 4, nativeMax: 18 }), 'ズーム 4〜18')
  assert.equal(describeZoomRange({ min: 5, max: 20, nativeMin: 5, nativeMax: 18 }), 'ズーム 5〜20（19以上は拡大表示）')
})

test('タイル定義: すべてのレイヤーで minZoom <= maxZoom、ID が一意', () => {
  for (const list of [BASE_LAYERS, OVERLAY_LAYERS]) {
    const ids = new Set<string>()
    for (const l of list) {
      assert.ok(!ids.has(l.id), `重複ID: ${l.id}`)
      ids.add(l.id)
      const r = baseZoomRange(l)
      assert.ok(r.min <= r.nativeMax && r.nativeMax <= r.max, `${l.id}: ${JSON.stringify(r)}`)
    }
  }
})

test('タイル定義: 産総研地質図は /tiles/{z}/{y}/{x}.png 形式・提供上限13', () => {
  const gsj = [...BASE_LAYERS, ...OVERLAY_LAYERS].filter((l) => l.url?.includes('gbank.gsj.jp'))
  assert.ok(gsj.length >= 1)
  for (const l of gsj) {
    assert.equal(l.url, 'https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png', l.id)
    assert.equal(l.maxZoom, 13, l.id)
  }
})

test('タイル定義: 地理院の主要ベースマップは公式の提供ズーム範囲', () => {
  const expected: Record<string, [number, number]> = {
    'gsi-std': [2, 18],
    'gsi-pale': [2, 18],
    'gsi-blank': [5, 14],
    'gsi-english': [5, 11],
    'gsi-relief': [5, 15],
    'gsi-hillshademap': [2, 16],
    'gsi-seamlessphoto': [2, 18],
    'gsi-lcm25k': [10, 16],
    'gsi-vbm': [11, 17],
  }
  for (const [id, [min, max]] of Object.entries(expected)) {
    const l = BASE_LAYERS.find((x) => x.id === id)
    assert.ok(l, id)
    assert.equal(l!.minZoom, min, `${id} minZoom`)
    assert.equal(l!.maxZoom, max, `${id} maxZoom`)
  }
  for (const l of BASE_LAYERS.filter((x) => x.id.startsWith('gsi-nendophoto'))) {
    assert.equal(l.minZoom, 14, l.id)
    assert.ok(l.url!.endsWith('.png'), l.id)
  }
})
