// 既存の軌跡（トラックログ）を、道路グラフの道に合わせる（マップマッチング。トラックのマップマッチング設計書）。
//
// 隠れマルコフモデル（Newson & Krumm 2009 の形）で、軌跡の点ごとの「どの道のどこにいたか」の候補から、
// 全体で最もつじつまの合う並びを選ぶ（ビタビ）。
//   出現の確からしさ = 点と候補の距離 d:              −½ (d / σ)²
//   遷移の確からしさ = 道の上の道のり r と直線の距離 s: −|r − s| / β
// 道の候補が無い点（グラフに無い道・駐車場など）と、道の上でつながらない所は「元の点を残す」区間にする（利用者の決定 2026-11-19）。
// 結果の道は、経路探索と同じ「辺の上の範囲」の並び（SearchStep）で返す。線にするのは Router（車線合わせを含め、手入力と同じ仕上げ）。
// 純粋関数。単体テストから直接 import できるよう、'@/' エイリアスを使わない。

import { distanceLL, latLngToWorld, metersPerUnit } from './geo.ts'
import type { RoadGraph } from './graph.ts'
import type { LatLng, SearchStep } from './types.ts'

export interface MatchParams {
  /** 位置の誤差の大きさ（m）。出現の確からしさの σ */
  sigmaM: number
  /** 遷移の確からしさの β（m）。大きいほど、道のりと直線の差を許す */
  betaM: number
  /** 道の候補を探す半径（m） */
  radiusM: number
  /** 1 点あたりの候補の数の上限 */
  maxCandidates: number
  /** 観測に使う点の間隔（m）。これより近い点は飛ばす（停車中のふらつきと、細かすぎる点で誤差を追うのを防ぐ） */
  stepM: number
  /** 道のりを探す上限 = 直線の距離 × detourRatio + detourExtraM */
  detourRatio: number
  detourExtraM: number
  /** 使う道の階級の上限（RoadClass。6 = 高速まで） */
  maxClass: number
}

export const DEFAULT_MATCH_PARAMS: MatchParams = {
  sigmaM: 10,
  betaM: 10,
  radiusM: 30,
  maxCandidates: 8,
  stepM: 40,
  detourRatio: 3,
  detourExtraM: 200,
  maxClass: 6,
}

/** 道の上の候補 */
export interface MatchCandidate {
  edge: number
  /** 辺の a 端からの道のりの割合（0〜1） */
  t: number
  /** 観測の点からの距離（m） */
  d: number
  lat: number
  lng: number
}

/** 結果の区間。input は入力の点の番号の範囲（両端を含む） */
export type MatchSection =
  | { kind: 'matched'; input: [number, number]; steps: SearchStep[]; start: LatLng; end: LatLng; anchors: { input: number; at: LatLng }[] }
  | { kind: 'kept'; input: [number, number] }

export interface TrackMatch {
  sections: MatchSection[]
  /** 観測に使った点の数と、そのうち道に合わせられた数 */
  observed: number
  matched: number
}

// ---- 候補 ----

export function candidatesAt(g: RoadGraph, p: LatLng, radiusM: number, maxCandidates: number, maxClass: number): MatchCandidate[] {
  const [px, py] = latLngToWorld(p.lat, p.lng)
  const mpu = metersPerUnit(p.lat)
  const reach = radiusM / mpu
  const near = g.segmentsNear(px - reach, py - reach, px + reach, py + reach)
  const best = new Map<number, { k: number; f: number; d: number }>()
  for (let i = 0; i < near.length; i += 2) {
    const e = near[i], k = near[i + 1]
    if (g.edgeCls[e] > maxClass) continue
    const [ax, ay] = g.shapePoint(e, k - 1)
    const [bx, by] = g.shapePoint(e, k)
    const dx = bx - ax, dy = by - ay
    const L2 = dx * dx + dy * dy
    let f = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
    f = Math.max(0, Math.min(1, f))
    const d = Math.hypot(px - ax - f * dx, py - ay - f * dy) * mpu
    if (d > radiusM) continue
    const cur = best.get(e)
    if (!cur || d < cur.d - 1e-9 || (Math.abs(d - cur.d) <= 1e-9 && k < cur.k)) best.set(e, { k, f, d })
  }
  const out: MatchCandidate[] = []
  for (const [e, { k, f, d }] of best) {
    const cum = g.cumulative(e)
    const total = cum[cum.length - 1]
    const along = cum[k - 1] + (cum[k] - cum[k - 1]) * f
    const t = total > 0 ? along / total : 0
    const ll = g.pointAt(e, t)
    out.push({ edge: e, t, d, lat: ll.lat, lng: ll.lng })
  }
  // 近い順。同じ距離なら辺の番号の小さいほう（結果を決定的にする）
  out.sort((a, b) => a.d - b.d || a.edge - b.edge)
  return out.slice(0, maxCandidates)
}

// ---- 道のり（上限つきのダイクストラ） ----

class MinHeap {
  private k: number[] = []
  private v: number[] = []
  get size() { return this.k.length }
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): [number, number] {
    const k = this.k, v = this.v
    const top: [number, number] = [k[0], v[0]]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length > 0) {
      let i = 0
      const n = k.length
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i, mk = lk
        if (l < n && k[l] < mk) { m = l; mk = k[l] }
        if (r < n && k[r] < mk) { m = r }
        if (m === i) break
        k[i] = k[m]; v[i] = v[m]; i = m
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

/** ノード src から bound m 以内のノードへの道のり。値は [道のり, 最後にたどった辺] */
export function boundedDistances(g: RoadGraph, src: number, bound: number, maxClass: number): Map<number, [number, number]> {
  const dist = new Map<number, [number, number]>([[src, [0, -1]]])
  const heap = new MinHeap()
  heap.push(0, src)
  while (heap.size > 0) {
    const [d, n] = heap.pop()
    const cur = dist.get(n)
    if (!cur || d > cur[0]) continue
    for (const e of g.adj[n]) {
      if (g.edgeCls[e] > maxClass) continue
      const m = g.edgeA[e] === n ? g.edgeB[e] : g.edgeA[e]
      const nd = d + g.edgeLen[e]
      if (nd > bound) continue
      const old = dist.get(m)
      if (!old || nd < old[0]) { dist.set(m, [nd, e]); heap.push(nd, m) }
    }
  }
  return dist
}

type DistCache = Map<number, Map<number, [number, number]>>

/** 候補 a から候補 b への道のりと、そのときの経路（a の端 → b の端のノードの組）。つながらなければ len = Infinity */
function transition(g: RoadGraph, a: MatchCandidate, b: MatchCandidate, bound: number, maxClass: number, cache: DistCache) {
  let best = { len: Infinity, na: -1, ta: 0, nb: -1, tb: 0 }
  if (a.edge === b.edge) best = { len: Math.abs(b.t - a.t) * g.edgeLen[a.edge], na: -1, ta: 0, nb: -1, tb: 0 }
  const ends = (c: MatchCandidate) => [[g.edgeA[c.edge], 0], [g.edgeB[c.edge], 1]] as const
  for (const [na, ta] of ends(a)) {
    const toEnd = Math.abs(a.t - ta) * g.edgeLen[a.edge]
    if (toEnd > bound) continue
    let dm = cache.get(na)
    if (!dm) { dm = boundedDistances(g, na, bound, maxClass); cache.set(na, dm) }
    for (const [nb, tb] of ends(b)) {
      const r = dm.get(nb)
      if (!r) continue
      const len = toEnd + r[0] + Math.abs(tb - b.t) * g.edgeLen[b.edge]
      if (len < best.len) best = { len, na, ta, nb, tb }
    }
  }
  return best
}

/** 選んだ 2 つの候補の間の、辺の上の範囲の並び */
function stepsBetween(g: RoadGraph, a: MatchCandidate, b: MatchCandidate, bound: number, maxClass: number, cache: DistCache): SearchStep[] {
  const tr = transition(g, a, b, bound, maxClass, cache)
  if (tr.na < 0) return a.t === b.t ? [] : [{ edge: a.edge, from: a.t, to: b.t }]
  const dm = cache.get(tr.na)!
  const edges: number[] = []
  let n = tr.nb
  while (n !== tr.na) {
    const [, e] = dm.get(n)!
    edges.push(e)
    n = g.edgeA[e] === n ? g.edgeB[e] : g.edgeA[e]
  }
  edges.reverse()
  const steps: SearchStep[] = []
  if (a.t !== tr.ta) steps.push({ edge: a.edge, from: a.t, to: tr.ta })
  let cur = tr.na
  for (const e of edges) {
    const fwd = g.edgeA[e] === cur
    steps.push({ edge: e, from: fwd ? 0 : 1, to: fwd ? 1 : 0 })
    cur = fwd ? g.edgeB[e] : g.edgeA[e]
  }
  if (tr.tb !== b.t) steps.push({ edge: b.edge, from: tr.tb, to: b.t })
  return steps
}

// ---- 観測の点 ----

/** 観測に使う点の番号。先頭・末尾と、直前に使った点から stepM 以上離れた点 */
export function pickObservations(points: LatLng[], stepM: number): number[] {
  if (points.length === 0) return []
  const out = [0]
  for (let i = 1; i < points.length - 1; i++) {
    if (distanceLL(points[out[out.length - 1]], points[i]) >= stepM) out.push(i)
  }
  if (points.length > 1) out.push(points.length - 1)
  return out
}

// ---- 本体 ----

/**
 * 軌跡を道に合わせる。道に合わせた区間（matched）と、元の点を残す区間（kept）を、入力の順に返す。
 * 区間どうしは端の点を共有しない（kept の両端は、前後の matched の最後・最初の観測の点の隣から）。
 */
export function matchTrack(g: RoadGraph, points: LatLng[], params: MatchParams = DEFAULT_MATCH_PARAMS, shouldStop?: () => boolean): TrackMatch | null {
  const obs = pickObservations(points, params.stepM)
  const cands = obs.map((i) => candidatesAt(g, points[i], params.radiusM, params.maxCandidates, params.maxClass))

  // つながった観測の並び（chain）ごとにビタビ。候補が無い点と、どの候補どうしもつながらない所で切る
  const chains: { obs: number[]; chosen: MatchCandidate[] }[] = []
  let cur: { obs: number[]; score: number[]; back: number[][] } | null = null
  const finish = () => {
    if (!cur) return
    let j = cur.score.indexOf(Math.max(...cur.score))
    const chosen: MatchCandidate[] = new Array(cur.obs.length)
    for (let i = cur.obs.length - 1; i >= 0; i--) {
      chosen[i] = cands[cur.obs[i]][j]
      if (i > 0) j = cur.back[i - 1][j]
    }
    chains.push({ obs: cur.obs, chosen })
    cur = null
  }
  const emit = (c: MatchCandidate) => -0.5 * (c.d / params.sigmaM) ** 2
  for (let oi = 0; oi < obs.length; oi++) {
    if (shouldStop?.()) return null
    const cs = cands[oi]
    if (cs.length === 0) { finish(); continue }
    if (!cur) { cur = { obs: [oi], score: cs.map(emit), back: [] }; continue }
    const prevOi = cur.obs[cur.obs.length - 1]
    const pa = points[obs[prevOi]], pb = points[obs[oi]]
    const straight = distanceLL(pa, pb)
    const bound = straight * params.detourRatio + params.detourExtraM
    const cache: DistCache = new Map()
    const prev = cands[prevOi]
    const score: number[] = [], back: number[] = []
    for (const cb of cs) {
      let bs = -Infinity, bj = -1
      for (let j = 0; j < prev.length; j++) {
        if (cur.score[j] === -Infinity) continue
        const tr = transition(g, prev[j], cb, bound, params.maxClass, cache)
        if (!Number.isFinite(tr.len)) continue
        const s = cur.score[j] - Math.abs(tr.len - straight) / params.betaM
        if (s > bs) { bs = s; bj = j }
      }
      score.push(bj < 0 ? -Infinity : bs + emit(cb))
      back.push(Math.max(bj, 0))
    }
    if (score.every((s) => s === -Infinity)) {
      // 道の上でつながらない（グラフに無い道を通った・記録の飛び）: ここで切って、新しく始める
      finish()
      cur = { obs: [oi], score: cs.map(emit), back: [] }
      continue
    }
    cur.obs.push(oi); cur.score = score; cur.back.push(back)
  }
  finish()

  // 区間にする。観測 1 つだけの並びは、道に合わせる根拠が弱いので元の点を残す
  const sections: MatchSection[] = []
  let next = 0 // まだ区間に入れていない入力の点の番号
  let matched = 0
  const keep = (to: number) => { if (to >= next) { sections.push({ kind: 'kept', input: [next, to] }); next = to + 1 } }
  for (const ch of chains) {
    if (ch.obs.length < 2) continue
    const first = obs[ch.obs[0]], last = obs[ch.obs[ch.obs.length - 1]]
    keep(first - 1)
    const steps: SearchStep[] = []
    for (let i = 1; i < ch.obs.length; i++) {
      const pa = points[obs[ch.obs[i - 1]]], pb = points[obs[ch.obs[i]]]
      const bound = distanceLL(pa, pb) * params.detourRatio + params.detourExtraM
      for (const st of stepsBetween(g, ch.chosen[i - 1], ch.chosen[i], bound, params.maxClass, new Map())) {
        // 同じ辺の続きは 1 つにまとめる
        const lastSt = steps[steps.length - 1]
        if (lastSt && lastSt.edge === st.edge && lastSt.to === st.from && Math.sign(lastSt.to - lastSt.from) === Math.sign(st.to - st.from)) lastSt.to = st.to
        else steps.push({ ...st })
      }
    }
    const c0 = ch.chosen[0], c1 = ch.chosen[ch.chosen.length - 1]
    sections.push({
      kind: 'matched',
      input: [first, last],
      steps,
      start: { lat: c0.lat, lng: c0.lng },
      end: { lat: c1.lat, lng: c1.lng },
      anchors: ch.obs.map((o, i) => ({ input: obs[o], at: { lat: ch.chosen[i].lat, lng: ch.chosen[i].lng } })),
    })
    matched += ch.obs.length
    next = last + 1
  }
  keep(points.length - 1)
  return { sections, observed: obs.length, matched }
}
