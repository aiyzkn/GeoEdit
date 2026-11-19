// 道に合わせた線へ、元の軌跡の時刻・標高・ウェイポイントを移す（トラックのマップマッチング設計書 §8.2）。純粋関数。
// 下書きは確定の前に手で直せるので、確定のときの線に対して、元の点を順に投影しなおす。
// 単体テストから直接 import できるよう '@/' を使わない。

import type { TrackPoint } from '../../types/route.ts'
import { haversineM } from '../geometry.ts'

type LL = { lat: number; lng: number }

/** 1 つ前の元の点からの直線距離の何倍まで、線の上を先へ探すか（戻らない・先へ飛びすぎないため） */
const REACH_FACTOR = 3
/** 先へ探す距離に足す余白（m） */
const REACH_MARGIN_M = 100

/** 線の各点までの道のり（m） */
export function cumulative(line: LL[]): number[] {
  const cum = [0]
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversineM(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng))
  return cum
}

/** 点 p を線分 a–b に投影する（局所の平面近似）。t = 線分の上の位置（0〜1）、dist = 距離（m） */
function projectOnSegment(p: LL, a: LL, b: LL): { t: number; dist: number } {
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111_320
  const ky = 110_540
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
  const x = ax + t * dx, y = ay + t * dy
  return { t, dist: Math.hypot(x, y) }
}

/**
 * 元の点の列を、線の上へ順に投影し、それぞれの線の上の道のり（m）を返す。
 * 前の点より後ろへは戻らない。先へは「前の元の点からの直線距離 × 3 + 100 m」までしか探さない（往復・周回で後の通過に飛ばないため）。
 * 先頭は 0、末尾は線の全長に固定する（両端は元の点のまま残るため）
 */
export function projectMonotone(line: LL[], pts: LL[], cum: number[] = cumulative(line)): number[] {
  const total = cum[cum.length - 1] ?? 0
  if (pts.length === 0) return []
  if (line.length < 2) return pts.map(() => 0)
  const out: number[] = [0]
  let seg = 0
  let last = 0
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k]
    const reach = haversineM(pts[k - 1].lat, pts[k - 1].lng, p.lat, p.lng) * REACH_FACTOR + REACH_MARGIN_M
    let best = Infinity, bestD = last, bestSeg = seg
    for (let j = seg; j < line.length - 1; j++) {
      if (cum[j] > last + reach) break
      const { t, dist } = projectOnSegment(p, line[j], line[j + 1])
      const d = Math.max(last, cum[j] + t * (cum[j + 1] - cum[j]))
      if (dist < best) { best = dist; bestD = d; bestSeg = j }
    }
    out.push(bestD)
    last = bestD
    seg = bestSeg
  }
  out[out.length - 1] = total
  for (let k = 0; k < out.length; k++) out[k] = Math.min(out[k], total)
  return out
}

/** (位置, 値) の節から、位置 d の値を線形に補う。節の外は端の値。節が無ければ undefined */
function interp(knots: [number, number][], d: number): number | undefined {
  if (knots.length === 0) return undefined
  if (d <= knots[0][0]) return knots[0][1]
  const lastK = knots[knots.length - 1]
  if (d >= lastK[0]) return lastK[1]
  let lo = 0, hi = knots.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (knots[m][0] <= d) lo = m
    else hi = m
  }
  const [d0, v0] = knots[lo], [d1, v1] = knots[hi]
  return d1 > d0 ? v0 + ((d - d0) / (d1 - d0)) * (v1 - v0) : v0
}

export interface CarryResult {
  /** 時刻・標高・ウェイポイントを移した中の点（両端を除く） */
  mid: TrackPoint[]
  /** 移したウェイポイントの数 */
  waypoints: number
  /** 時刻を元の点から移せたか（false なら、呼び出し側が両端の比で付ける） */
  timed: boolean
}

/**
 * 元の軌跡 orig（両端を含む。orig[0] と orig[末尾] は確定後もそのまま残る）の時刻・標高・ウェイポイントを、
 * 新しい中の点 mid（両端を除く。時刻・ウェイポイントは無い）へ移す。
 * - 時刻: 元の各点の時刻を、線の上の投影の位置に置き、間は道のりで補う（元の速度の変化を保つ）。時刻が減る点は使わない
 * - 標高: mid に標高が無い点だけ、元の標高を同じく補う（標高の自動取得をしたときは、その値を優先する）
 * - ウェイポイント: 元の中の点に付いたものを、投影の位置にいちばん近い mid の点へ移す（ふさがっていれば隣）
 * - 心拍などの拡張データ（_extensions）は移さない
 */
export function carryAlongMatch(orig: TrackPoint[], mid: TrackPoint[]): CarryResult {
  const a = orig[0], b = orig[orig.length - 1]
  const line: LL[] = [a, ...mid, b]
  const cum = cumulative(line)
  const pos = projectMonotone(line, orig, cum)

  const timeKnots: [number, number][] = []
  const eleKnots: [number, number][] = []
  for (let k = 0; k < orig.length; k++) {
    const t = orig[k].time?.getTime()
    if (t != null && !isNaN(t)) {
      const prev = timeKnots[timeKnots.length - 1]
      if (!prev || (t >= prev[1] && pos[k] >= prev[0])) {
        if (prev && pos[k] === prev[0]) prev[1] = t // 同じ位置に止まっていた: 後の時刻（動き出し）を使う
        else timeKnots.push([pos[k], t])
      }
    }
    const e = orig[k].ele
    if (e != null) {
      const prev = eleKnots[eleKnots.length - 1]
      if (!prev || pos[k] > prev[0]) eleKnots.push([pos[k], e])
    }
  }
  const timed = timeKnots.length >= 2
  const out: TrackPoint[] = mid.map((p, i) => {
    const q: TrackPoint = { ...p }
    const d = cum[i + 1]
    if (timed) q.time = new Date(Math.round(interp(timeKnots, d)!))
    if (q.ele == null) {
      const e = interp(eleKnots, d)
      if (e != null) q.ele = Math.round(e * 10) / 10
    }
    return q
  })

  let waypoints = 0
  if (out.length > 0) {
    for (let k = 1; k < orig.length - 1; k++) {
      const w = orig[k].waypoint
      if (!w) continue
      // pos[k] にいちばん近い mid の点（cum の番号は mid の番号 + 1）
      let lo = 0, hi = out.length - 1
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1
        if (cum[m + 1] <= pos[k]) lo = m
        else hi = m
      }
      let j = Math.abs(cum[lo + 1] - pos[k]) <= Math.abs(cum[hi + 1] - pos[k]) ? lo : hi
      for (let r = 0; r < out.length && out[j].waypoint; r++) {
        const cands = [j + r, j - r].filter((x) => x >= 0 && x < out.length && !out[x].waypoint)
        if (cands.length > 0) { j = cands[0]; break }
      }
      if (out[j].waypoint) continue // すべてふさがっている（mid より多い）
      out[j] = { ...out[j], waypoint: w }
      waypoints++
    }
  }
  return { mid: out, waypoints, timed }
}
