// lane.ts（分離帯のある道路を、地図画像の車線に合わせる）の単体テスト（詳細設計書 §13）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LaneMatcher, laneScan, classifyLanePixel, isSubwayDashColor, type RasterSource } from '../../src/lib/routing/lane.ts'
import { worldToLatLng, latLngToWorld } from '../../src/lib/routing/geo.ts'
import { BG, ROAD, EDGE, IGNORE } from '../../src/lib/mapMatch/types.ts'

// ── 走査線の判定 ─────────────────────────────────────────
/** 文字列（. = 背景、# = 道路、| = 道路縁・分離帯）を走査線にする。index 0 が右、末尾が左（進む向きの左） */
function line(s: string): Uint8Array {
  return Uint8Array.from([...s].map((c) => (c === '#' ? ROAD : c === '|' ? EDGE : BG)))
}

/** [文字, 個数] の並びから走査線の文字列を作る（81 文字） */
function build(parts: [string, number][]): string {
  const s = parts.map(([c, n]) => c.repeat(n)).join('')
  assert.equal(s.length, 81)
  return s
}

test('laneScan: 分離帯が描かれていれば、左側の車道の中心へ', () => {
  // 右の車道 6〜38、分離帯 39〜40（線の上の点 40 はこの上）、左の車道 41〜72
  const s = line(build([['.', 5], ['|', 1], ['#', 33], ['|', 2], ['#', 32], ['|', 1], ['.', 7]]))
  const r = laneScan(s)!
  assert.equal(r.divided, true)
  assert.equal(r.offset, (41 + 72) / 2 - 40)
})

test('laneScan: 分離帯が描かれていなければ、道路全体の中心へ', () => {
  const s = line(build([['.', 10], ['|', 1], ['#', 55], ['|', 1], ['.', 14]]))
  const r = laneScan(s)!
  assert.equal(r.divided, false)
  assert.equal(r.offset, (11 + 65) / 2 - 40)
})

test('laneScan: 側道などで区切りが何本もあるときは、線の上の点に近いすき間を分離帯とみなす', () => {
  // 右から: 側道 1〜12 | 車道 15〜38 | 分離帯 39〜40（線の上の点 40）| 車道 41〜64 | 側道 67〜78
  const s = line(build([['|', 1], ['#', 12], ['|', 2], ['#', 24], ['|', 2], ['#', 24], ['|', 2], ['#', 12], ['|', 1], ['.', 1]]))
  const r = laneScan(s)!
  assert.equal(r.divided, true)
  assert.equal(r.offset, (41 + 64) / 2 - 40) // 左の車道の中心（側道との区切りとは取り違えない）
})

test('laneScan: 道路が走査の端まで続く（交差点・広場）なら決めない', () => {
  assert.equal(laneScan(line('#'.repeat(81))), null)
})

test('画素の分類: 道路の上の暗い赤の破線と中間色は注記として吸収する。国道の塗りは道路', () => {
  for (const c of [[100, 0, 0], [109, 15, 15], [129, 47, 47], [158, 95, 95], [196, 159, 159]] as const) {
    assert.ok(isSubwayDashColor(...c), String(c))
    assert.equal(classifyLanePixel(...c), IGNORE, String(c))
  }
  assert.equal(classifyLanePixel(255, 122, 122), ROAD) // 国道
  assert.equal(classifyLanePixel(255, 255, 255), ROAD)
  assert.equal(classifyLanePixel(100, 100, 100), EDGE) // 道路縁・分離帯
})

// ── 線を合わせる（合成の画像） ───────────────────────────────
// z18 のタイル（z14 の世界座標の 1 格子 = z18 の 1 画素）
const TX = 232832, TY = 103232
const Y0 = TY * 256 + 128 // 道路の中心の行（世界座標）

/** 東西に走る道路の画像。halfWidth = 片側の幅（画素）。median = 中央に 2 画素の分離帯を描く */
function roadRaster(halfWidth: number, median: boolean): RasterSource {
  return async (z, x, y) => {
    assert.equal(z, 18)
    const data = new Uint8ClampedArray(256 * 256 * 4)
    for (let j = 0; j < 256; j++) {
      const wy = y * 256 + j
      const d = wy - Y0
      let rgb = [200, 220, 180] // 背景
      if (Math.abs(d) <= halfWidth) rgb = [255, 255, 255]
      if (Math.abs(d) === halfWidth + 1) rgb = [100, 100, 100] // 道路縁
      if (median && (d === 0 || d === -1)) rgb = [100, 100, 100] // 分離帯
      for (let i = 0; i < 256; i++) {
        const o = (j * 256 + i) * 4
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255
      }
    }
    void x
    return { width: 256, height: 256, data }
  }
}

const ll = (wx: number, wy: number) => worldToLatLng(wx, wy)
const X0 = TX * 256 + 20, X1 = TX * 256 + 600

/** 線の中ほど（両端から 150 画素以上内側）の、道路の中心からのずれの平均（画素。+ = 北 = 画面の上） */
function midShift(pts: { lat: number; lng: number }[]): number {
  const w = pts.map((p) => latLngToWorld(p.lat, p.lng))
  const yAt = (x: number) => {
    for (let i = 1; i < w.length; i++) {
      const [ax, ay] = w[i - 1], [bx, by] = w[i]
      if ((ax - x) * (bx - x) <= 0 && ax !== bx) return ay + ((by - ay) * (x - ax)) / (bx - ax)
    }
    return NaN
  }
  const xs = [0.4, 0.5, 0.6].map((f) => X0 + (X1 - X0) * f)
  const ys = xs.map((x) => Y0 - yAt(x))
  assert.ok(ys.every(Number.isFinite))
  return ys.reduce((a, b) => a + b, 0) / ys.length
}

test('分離帯が描かれていれば、東へ進む線は北の車道、西へ進む線は南の車道の中心へ（左側通行）', async () => {
  const m = new LaneMatcher(roadRaster(20, true))
  // 線は分離帯の上（中心）にある。片側の車道は d = 1〜20（北は -20〜-2）。中心は ±約 11
  const east = await m.correct([ll(X0, Y0), ll(X1, Y0)])
  const west = await m.correct([ll(X1, Y0), ll(X0, Y0)])
  assert.ok(Math.abs(midShift(east) - 11) <= 1.5, `east ${midShift(east)}`)
  assert.ok(Math.abs(midShift(west) + 10.5) <= 1.5, `west ${midShift(west)}`)
  // 先頭と末尾は動かさない
  assert.deepEqual(east[0], ll(X0, Y0))
  assert.deepEqual(east[east.length - 1], ll(X1, Y0))
})

test('分離帯が描かれていなければ、道路全体の中心へ（進む向きによらない）', async () => {
  const m = new LaneMatcher(roadRaster(20, false))
  const off = 6 // 中心から 6 画素南にずれた線
  const east = await m.correct([ll(X0, Y0 + off), ll(X1, Y0 + off)])
  const west = await m.correct([ll(X1, Y0 + off), ll(X0, Y0 + off)])
  assert.ok(Math.abs(midShift(east)) <= 1, `east ${midShift(east)}`)
  assert.ok(Math.abs(midShift(west)) <= 1, `west ${midShift(west)}`)
})

test('画像を取れなければ、線はそのまま', async () => {
  const m = new LaneMatcher(async () => null)
  const pts = [ll(X0, Y0 + 5), ll(X1, Y0 + 5)]
  const out = await m.correct(pts)
  assert.equal(midShift(out), -5)
  const m2 = new LaneMatcher(async () => { throw new Error('network') })
  assert.equal(midShift(await m2.correct(pts)), -5)
})
