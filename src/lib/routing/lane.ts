// 分離帯のある道路の線を、地理院地図（標準地図）の画像の車線に合わせる（詳細設計書 §13。利用者の指示 2026-11-16）。
//
// - 画像に分離帯が描かれている所: 進む向きの左側（日本は左側通行）の車道の中心へ
// - 画像に分離帯が描かれていない所: 道路全体の中心へ
//
// 線に沿って約 5 m ごとに、進む向きに直交する向きで z18 の画像を走査し、道路の塗りの区間（run）を見て寄せる量を決める。
// z18 の画素 1 つは、z14 の世界座標の 1 格子と同じ大きさ（4096 格子 = z18 のタイル 16 枚 × 256 画素）。
// 単体テストから直接 import できるよう、'@/' エイリアスを使わない。

import { classifyPixel } from '../mapMatch/palette.ts'
import { extractRuns, fillSymbolNoise } from '../mapMatch/matcher.ts'
import { BG, IGNORE, type PixelClass } from '../mapMatch/types.ts'
import { latLngToWorld, worldToLatLng } from './geo.ts'
import type { LatLng } from './types.ts'

export const LANE_ZOOM = 18

/** RGBA の画像（256 × 256）。404・取得できない・大きさが違うときは null */
export interface RasterTile { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export type RasterSource = (z: number, x: number, y: number, signal?: AbortSignal) => Promise<RasterTile | null>

export const LANE = {
  /** 走査の間隔（z18 の画素 ≒ 約 0.5 m） */
  stepPx: 10,
  /** 走査の半幅 */
  scanPx: 40,
  /** 分離帯とみなす、2 つの run の間のすき間（画素） */
  medianMinPx: 1,
  medianMaxPx: 24,
  /** 車道・道路とみなす run の幅（画素） */
  minRunPx: 4,
  maxRunPx: 70,
  /** 線の上の点から、run までの許容（画素） */
  nearPx: 4,
  /** 寄せる量の上限（画素 ≒ 15 m） */
  maxShiftPx: 30,
  /** 分離帯が途切れて描かれている所（交差点・横断歩道など）を、前後の分離帯の結果でつなぐ長さ（画素 ≒ 50 m） */
  bridgePx: 100,
  /** 高速の本線で、中央値を取る範囲（前後の点数。±8 点 ≒ ±40 m）と、要る点数 */
  motorwayWindow: 8,
  motorwayMinSamples: 3,
  /** 区間の両端で、寄せる量を 0 から増やしていく長さ（画素 ≒ 20 m） */
  taperPx: 40,
  /** 寄せたあとの点の間引きの許容（画素） */
  simplifyPx: 1,
} as const

/**
 * 画素の分類。マップマッチングと同じ（標準地図）。
 * 標準地図（z18）の分離帯は、道路縁と同じ灰色の線で囲った島として描かれ、区切り（EDGE）になる。
 * 道路の中央に描かれた暗い赤の破線は地下鉄など（分離帯ではない）で、注記と同じく道路に吸収する（2026-11-16 に実タイルで確認）
 */
export function classifyLanePixel(r: number, g: number, b: number): PixelClass {
  if (isSubwayDashColor(r, g, b)) return IGNORE
  return classifyPixel('gsi-std', r, g, b)
}

/**
 * 道路の上の暗い赤の破線（#640000）と、その縁の白との中間色（#6d0f0f・#812f2f・#9e5f5f・#c49f9f など）。
 * 中間色が背景（BG）に分類されると、破線の両側に 2 画素以上のすき間が残って分離帯と誤るので、注記として吸収させる。
 * 国道の塗り #ff7a7a（r = 255）は含めない
 */
export function isSubwayDashColor(r: number, g: number, b: number): boolean {
  return r >= 90 && r <= 215 && r - g >= 30 && Math.abs(g - b) <= 20
}

/** 走査の値。一般道と高速道路の本線で分ける */
export interface ScanParams {
  /** 走査の半幅（画素） */
  scanPx: number
  /** 車道とみなす run の幅の下限。これより細い run は、分離帯の中（帯として描かれた分離帯の内側）や線のすき間とみなす */
  minRunPx: number
  maxRunPx: number
  /** 分離帯とみなすすき間の上限 */
  medianMaxPx: number
}
export const ROAD_SCAN: ScanParams = { scanPx: LANE.scanPx, minRunPx: LANE.minRunPx, maxRunPx: LANE.maxRunPx, medianMaxPx: LANE.medianMaxPx }
/**
 * 高速道路の本線: 片側 3 車線 + 路肩で 15 m（30 画素）を超え、分離帯が幅のある帯（2 本の線の間に 6〜8 画素の白）で
 * 描かれる所がある。走査を広げ、12 画素（約 6 m）より細い run は車道とみなさない
 */
export const MOTORWAY_SCAN: ScanParams = { scanPx: 64, minRunPx: 12, maxRunPx: 90, medianMaxPx: 34 }

/** 走査線（index R が線の上の点、index が増える向きが進む向きの左）の分類から、寄せる量（画素）を決める。決められなければ null */
export function laneOffset(samples: Uint8Array): number | null {
  return laneScan(samples)?.offset ?? null
}

/** laneOffset と同じ。あわせて、分離帯が描かれていたか（divided）を返す */
export function laneScan(samples: Uint8Array, p: ScanParams = ROAD_SCAN): { offset: number; divided: boolean } | null {
  const R = (samples.length - 1) / 2
  const last = samples.length - 1
  const runs = extractRuns(samples).filter((r) => r.end - r.start + 1 >= p.minRunPx)
  const bounded = (r: { start: number; end: number }) => r.start > 0 && r.end < last
  const mid = (r: { start: number; end: number }) => (r.start + r.end) / 2
  // 分離帯が描かれている: 隣り合う 2 つの run の間に分離帯の幅のすき間があり、線の上の点がその近くにある。
  // 側道などで区切りが何本もあるときは、すき間の中心が線の上の点にいちばん近い組を選ぶ
  let pair: { b: { start: number; end: number }; d: number } | null = null
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i], b = runs[i + 1]
    const gap = b.start - a.end - 1
    if (gap < LANE.medianMinPx || gap > p.medianMaxPx) continue
    if (R < a.start - LANE.nearPx || R > b.end + LANE.nearPx) continue
    if (!bounded(a) || !bounded(b)) continue
    if (a.end - a.start + 1 > p.maxRunPx || b.end - b.start + 1 > p.maxRunPx) continue
    const d = Math.abs((a.end + b.start) / 2 - R)
    if (!pair || d < pair.d) pair = { b, d }
  }
  // 線の上の点が、選んだすき間から離れすぎていなければ（どちらかの車道の中にある程度まで）、左側の車道へ
  if (pair && pair.d <= p.medianMaxPx) return { offset: mid(pair.b) - R, divided: true } // 左側（index が大きい側）の車道の中心
  // 分離帯が描かれていない: 線の上の点を含む（または近い）run の中心
  let best: { start: number; end: number } | null = null
  let bestD = Infinity
  for (const r of runs) {
    const d = R < r.start ? r.start - R : R > r.end ? R - r.end : 0
    if (d < bestD) { bestD = d; best = r }
  }
  if (!best || bestD > LANE.nearPx || !bounded(best) || best.end - best.start + 1 > p.maxRunPx) return null
  return { offset: mid(best) - R, divided: false }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Douglas–Peucker（世界座標）。最初と最後は残す */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()!
    const [ax, ay] = pts[i0], [bx, by] = pts[i1]
    const dx = bx - ax, dy = by - ay
    const L = Math.hypot(dx, dy)
    let worst = -1, wi = -1
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = pts[i]
      const d = L > 0 ? Math.abs((px - ax) * dy - (py - ay) * dx) / L : Math.hypot(px - ax, py - ay)
      if (d > worst) { worst = d; wi = i }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([i0, wi], [wi, i1]) }
  }
  return pts.filter((_, i) => keep[i])
}

export interface CorrectOptions {
  /**
   * 高速道路の本線（上下線を兼ねる 1 本の線。画像ではいつも分離帯が描かれている）。
   * 分離帯を見つけた点だけを使い、広い範囲の中央値で均す（注記・ランプの線・橋で 1 点ずつ振れないように。§14.5）
   */
  motorway?: boolean
  /** false なら、その端で寄せる量を 0 に戻さない（端の点も動かす）。ランプへなめらかにつなぐとき。既定は true */
  taperStart?: boolean
  taperEnd?: boolean
}

export class LaneMatcher {
  private readonly source: RasterSource
  private readonly tiles = new Map<string, Uint8Array | null>()
  private readonly max: number

  constructor(source: RasterSource, opts: { cacheTiles?: number } = {}) {
    this.source = source
    this.max = opts.cacheTiles ?? 300
  }

  private async loadTiles(keys: string[], signal?: AbortSignal) {
    const missing = keys.filter((k) => !this.tiles.has(k))
    await Promise.all(missing.map(async (k) => {
      const [x, y] = k.split('/').map(Number)
      let cls: Uint8Array | null = null
      try {
        const img = await this.source(LANE_ZOOM, x, y, signal)
        if (img && img.width === 256 && img.height === 256) {
          cls = new Uint8Array(256 * 256)
          const d = img.data
          for (let i = 0; i < cls.length; i++) cls[i] = classifyLanePixel(d[4 * i], d[4 * i + 1], d[4 * i + 2])
        }
      } catch {
        cls = null
      }
      this.tiles.set(k, cls)
    }))
    while (this.tiles.size > this.max) {
      const oldest = this.tiles.keys().next().value
      if (oldest === undefined) break
      this.tiles.delete(oldest)
    }
  }

  private pixel(x: number, y: number): PixelClass | -1 {
    const t = this.tiles.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`)
    if (!t) return -1
    return t[(((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)] as PixelClass
  }

  /** (cx, cy) を中心に、向き (nx, ny) の走査線の分類。画像が無ければ null */
  private scan(cx: number, cy: number, nx: number, ny: number, R: number): Uint8Array | null {
    const size = 2 * R + 1
    const patch = new Uint8Array(size * size)
    const x0 = Math.round(cx) - R, y0 = Math.round(cy) - R
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const c = this.pixel(x0 + i, y0 + j)
        if (c === -1) return null
        patch[j * size + i] = c
      }
    }
    const filled = fillSymbolNoise(patch, size)
    const out = new Uint8Array(size)
    const ox = cx - x0, oy = cy - y0
    for (let t = -R; t <= R; t++) {
      const x = Math.round(ox + t * nx), y = Math.round(oy + t * ny)
      out[t + R] = x < 0 || y < 0 || x >= size || y >= size ? BG : filled[y * size + x]
    }
    return out
  }

  /**
   * 分離帯のある区間の線（進む向きの順）を、画像の車線に合わせて返す。先頭と末尾の点は動かさない。
   * 画像を取れない・判定できない所は、元の線のまま（例外は投げない）
   */
  async correct(points: LatLng[], signal?: AbortSignal, opts: CorrectOptions = {}): Promise<LatLng[]> {
    if (points.length < 2) return points
    const world = points.map((p) => latLngToWorld(p.lat, p.lng))
    // 1. 一定の間隔の点を作る（元の頂点も残す）
    const samples: { x: number; y: number; s: number }[] = []
    let s = 0
    samples.push({ x: world[0][0], y: world[0][1], s: 0 })
    for (let i = 1; i < world.length; i++) {
      const [ax, ay] = world[i - 1], [bx, by] = world[i]
      const L = Math.hypot(bx - ax, by - ay)
      const n = Math.max(1, Math.ceil(L / LANE.stepPx))
      for (let k = 1; k <= n; k++) samples.push({ x: ax + ((bx - ax) * k) / n, y: ay + ((by - ay) * k) / n, s: s + (L * k) / n })
      s += L
    }
    const total = s
    if (total < 2 * LANE.stepPx) return points
    // 2. 画像のタイルを取る
    const keys = new Set<string>()
    const sp = opts.motorway ? MOTORWAY_SCAN : ROAD_SCAN
    const R = sp.scanPx + 2
    for (const p of samples) {
      for (const dx of [-R, R]) for (const dy of [-R, R]) keys.add(`${Math.floor((p.x + dx) / 256)}/${Math.floor((p.y + dy) / 256)}`)
    }
    await this.loadTiles([...keys], signal)
    if (signal?.aborted) return points
    // 3. 点ごとに、進む向きの左の法線で走査して寄せる量を決める
    const scans: ({ offset: number; divided: boolean } | null)[] = []
    const normals: [number, number][] = []
    for (let i = 0; i < samples.length; i++) {
      const a = samples[Math.max(0, i - 2)], b = samples[Math.min(samples.length - 1, i + 2)]
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L
      const nx = ty, ny = -tx // 画面の座標（y が下向き）で、進む向きの左
      normals.push([nx, ny])
      const line = this.scan(samples[i].x, samples[i].y, nx, ny, sp.scanPx)
      scans.push(line ? laneScan(line, sp) : null)
    }
    // 分離帯が描かれている所に挟まれた、短い「描かれていない」所（交差点など）は、車線を保ったまま通す
    const offs: (number | null)[] = scans.map((r, i) => {
      if (!r || r.divided) return r ? r.offset : null
      let l = i - 1, rr = i + 1
      while (l >= 0 && samples[i].s - samples[l].s <= LANE.bridgePx && !scans[l]?.divided) l--
      while (rr < scans.length && samples[rr].s - samples[i].s <= LANE.bridgePx && !scans[rr]?.divided) rr++
      const left = l >= 0 && samples[i].s - samples[l].s <= LANE.bridgePx ? l : -1
      const right = rr < scans.length && samples[rr].s - samples[i].s <= LANE.bridgePx ? rr : -1
      if (left < 0 || right < 0) return r.offset
      const f = (samples[i].s - samples[left].s) / (samples[right].s - samples[left].s)
      return scans[left]!.offset + (scans[right]!.offset - scans[left]!.offset) * f
    })
    // 4. 決められなかった所は前後から補い、外れ値を中央値で均し、上限で切り、両端で 0 へ近づける
    let smooth: number[]
    if (opts.motorway) {
      // 高速の本線: 分離帯を見つけた点だけを使い、前後 ±W 点（約 ±40 m）の中央値 → 移動平均で均す
      const vals = scans.map((r) => (r && r.divided ? r.offset : null))
      const W = LANE.motorwayWindow
      const med: (number | null)[] = vals.map((_, i) => {
        const win = vals.slice(Math.max(0, i - W), i + W + 1).filter((v): v is number => v !== null)
        return win.length >= LANE.motorwayMinSamples ? median(win) : null
      })
      if (med.every((v) => v === null)) return points // どこでも分離帯を見つけられなかった
      const filledM = med.map((v, i) => {
        if (v !== null) return v
        let l = i - 1, r = i + 1
        while (l >= 0 && med[l] === null) l--
        while (r < med.length && med[r] === null) r++
        if (l >= 0 && r < med.length) return med[l]! + ((med[r]! - med[l]!) * (i - l)) / (r - l)
        return l >= 0 ? med[l]! : med[r]!
      })
      smooth = filledM.map((_, i) => {
        const win = filledM.slice(Math.max(0, i - 3), i + 4)
        return win.reduce((x, y) => x + y, 0) / win.length
      })
    } else {
      const filled = offs.map((o, i) => {
        if (o !== null) return o
        let l = i - 1, r = i + 1
        while (l >= 0 && offs[l] === null) l--
        while (r < offs.length && offs[r] === null) r++
        if (l >= 0 && r < offs.length) {
          const f = (samples[i].s - samples[l].s) / (samples[r].s - samples[l].s)
          return offs[l]! + (offs[r]! - offs[l]!) * f
        }
        return l >= 0 ? offs[l]! : r < offs.length ? offs[r]! : 0
      })
      smooth = filled.map((_, i) => median(filled.slice(Math.max(0, i - 2), i + 3)))
    }
    const taperStart = opts.taperStart !== false, taperEnd = opts.taperEnd !== false
    const moved: [number, number][] = samples.map((p, i) => {
      const taper = Math.min(1, taperStart ? p.s / LANE.taperPx : 1, taperEnd ? (total - p.s) / LANE.taperPx : 1)
      const o = Math.max(-LANE.maxShiftPx, Math.min(LANE.maxShiftPx, smooth[i])) * Math.max(0, taper)
      return [p.x + o * normals[i][0], p.y + o * normals[i][1]]
    })
    if (taperStart) moved[0] = [world[0][0], world[0][1]]
    if (taperEnd) moved[moved.length - 1] = [world[world.length - 1][0], world[world.length - 1][1]]
    // 5. 点を間引いて緯度経度に戻す
    return simplify(moved, LANE.simplifyPx).map(([x, y], i, arr) => {
      if (i === 0 && taperStart) return { ...points[0] }
      if (i === arr.length - 1 && taperEnd) return { ...points[points.length - 1] }
      const ll = worldToLatLng(x, y)
      return { lat: Math.round(ll.lat * 1e7) / 1e7, lng: Math.round(ll.lng * 1e7) / 1e7 }
    })
  }
}
