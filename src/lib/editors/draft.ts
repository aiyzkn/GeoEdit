// 作成モードの下書き（通過点と区間）の操作（designs/経路探索詳細設計書.md §8.2）。
// すべて純粋関数で、引数を書き換えない。単体テストから直接 import できるよう '@/' を使わない。

import type { CreateAnchor, CreateLeg, Draft, LegMode } from '../../types/editor.ts'
import type { RouteResult } from '../routing/types.ts'
import { distanceLL } from '../routing/geo.ts'
import { simplifyByTolerance } from './routeEditors.ts'

type LL = { lat: number; lng: number }

let seq = 0
/** 区間・通過点の id（ページ内で一意であればよい） */
export function newId(prefix: string): string {
  seq++
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

export function emptyDraft(): Draft {
  return { anchors: [], legs: [] }
}

function ll(a: LL): LL {
  return { lat: a.lat, lng: a.lng }
}

function makeLeg(from: LL, to: LL, mode: LegMode, gen = 0): CreateLeg {
  return {
    id: newId('leg-'),
    mode,
    status: mode === 'straight' ? 'ok' : 'pending',
    points: [ll(from), ll(to)],
    distance: distanceLL(from, to),
    gen,
  }
}

/** 区間を、両端の位置で作り直す（straight は ok、auto は pending。gen を 1 増やす） */
function resetLeg(leg: CreateLeg, from: LL, to: LL): CreateLeg {
  return {
    ...leg,
    status: leg.mode === 'straight' ? 'ok' : 'pending',
    reason: undefined,
    points: [ll(from), ll(to)],
    distance: distanceLL(from, to),
    gen: leg.gen + 1,
  }
}

/** 末尾に通過点を足す */
export function addAnchor(d: Draft, a: CreateAnchor, mode: LegMode): Draft {
  const anchors = [...d.anchors, { ...a }]
  if (d.anchors.length === 0) return { anchors, legs: [] }
  const prev = d.anchors[d.anchors.length - 1]
  return { anchors, legs: [...d.legs, makeLeg(prev, a, mode)] }
}

/** 区間の途中に通過点を差し込み、区間を 2 つに分ける */
export function insertAnchor(d: Draft, legId: string, a: CreateAnchor): Draft {
  const i = d.legs.findIndex((l) => l.id === legId)
  if (i < 0) return d
  const leg = d.legs[i]
  const anchors = [...d.anchors.slice(0, i + 1), { ...a }, ...d.anchors.slice(i + 1)]
  const legs = [...d.legs.slice(0, i), makeLeg(d.anchors[i], a, leg.mode), makeLeg(a, d.anchors[i + 1], leg.mode), ...d.legs.slice(i + 1)]
  return { anchors, legs }
}

/** 通過点を動かす。前後の区間は引き直し待ちになる */
export function moveAnchor(d: Draft, anchorId: string, lat: number, lng: number): Draft {
  const i = d.anchors.findIndex((a) => a.id === anchorId)
  if (i < 0 || d.anchors[i].locked) return d
  const anchors = d.anchors.map((a, k) => (k === i ? { ...a, lat, lng } : a))
  const legs = d.legs.map((l, k) => {
    if (k === i - 1 || k === i) return resetLeg(l, anchors[k], anchors[k + 1])
    return l
  })
  return { anchors, legs }
}

/** 通過点を消す。途中なら前後の区間を 1 つにまとめる */
export function removeAnchor(d: Draft, anchorId: string): Draft {
  const i = d.anchors.findIndex((a) => a.id === anchorId)
  if (i < 0 || d.anchors[i].locked) return d
  const anchors = d.anchors.filter((_, k) => k !== i)
  if (d.legs.length === 0) return { anchors, legs: [] }
  if (i === 0) return { anchors, legs: d.legs.slice(1) }
  if (i === d.anchors.length - 1) return { anchors, legs: d.legs.slice(0, -1) }
  const before = d.legs[i - 1], after = d.legs[i]
  const mode: LegMode = before.mode === 'straight' && after.mode === 'straight' ? 'straight' : 'auto'
  const merged = makeLeg(d.anchors[i - 1], d.anchors[i + 1], mode)
  return { anchors, legs: [...d.legs.slice(0, i - 1), merged, ...d.legs.slice(i + 1)] }
}

/** 探索の結果を入れる。id と gen が合う区間だけ。合わなければ d をそのまま返す */
export function setLegResult(d: Draft, legId: string, gen: number, r: RouteResult): Draft {
  const i = d.legs.findIndex((l) => l.id === legId)
  if (i < 0) return d
  const leg = d.legs[i]
  if (leg.gen !== gen || leg.mode !== 'auto') return d
  const from = d.anchors[i], to = d.anchors[i + 1]
  const points = r.points.length >= 2 ? r.points.map(ll) : [ll(from), ll(to)]
  // 先頭と末尾は通過点の位置そのものにする（探索の入力と同じはずだが、念のため）
  points[0] = ll(from)
  points[points.length - 1] = ll(to)
  const legs = [...d.legs]
  legs[i] = { ...leg, status: r.status, reason: r.reason, points, distance: r.distance }
  return { anchors: d.anchors, legs }
}

/** 引き直し待ちの区間の gen を 1 増やす（取り消し・やり直しの後に頼み直すため） */
export function bumpPending(d: Draft): Draft {
  if (!d.legs.some((l) => l.status === 'pending')) return d
  return { anchors: d.anchors, legs: d.legs.map((l) => (l.status === 'pending' ? { ...l, gen: l.gen + 1 } : l)) }
}

/** auto の区間を全部、引き直し待ちにする（「引き直す」） */
export function resetAutoLegs(d: Draft): Draft {
  return {
    anchors: d.anchors,
    legs: d.legs.map((l, k) => (l.mode === 'auto' ? resetLeg(l, d.anchors[k], d.anchors[k + 1]) : l)),
  }
}

export function pendingLegs(d: Draft): CreateLeg[] {
  return d.legs.filter((l) => l.status === 'pending')
}

/** 全区間の点列の連結（つなぎ目の同じ点は 1 つに）。通過点が 1 つなら、その 1 点 */
export function draftPoints(d: Draft): LL[] {
  if (d.legs.length === 0) return d.anchors.map(ll)
  const out: LL[] = []
  for (const leg of d.legs) {
    for (const p of leg.points) {
      const last = out[out.length - 1]
      if (last && last.lat === p.lat && last.lng === p.lng) continue
      out.push(ll(p))
    }
  }
  return out
}

/** 形を保つ間引きの許容（m）。経路探索で結んだ区間にだけ使う（B4） */
export const DRAFT_SIMPLIFY_M = 2

/** 区間 leg の点列。simplify なら、経路探索で結べた区間（auto・ok）を形を保って間引く。両端は必ず残る */
export function legPoints(leg: CreateLeg, simplify: boolean): LL[] {
  if (simplify && leg.mode === 'auto' && leg.status === 'ok') return simplifyByTolerance(leg.points, DRAFT_SIMPLIFY_M)
  return leg.points
}

/** draftPoints と同じ。simplify なら区間ごとに間引く */
export function draftPointsSimplified(d: Draft, simplify: boolean): LL[] {
  if (!simplify) return draftPoints(d)
  return draftPoints({ anchors: d.anchors, legs: d.legs.map((l) => ({ ...l, points: legPoints(l, true) })) })
}

export function draftDistance(d: Draft): number {
  return d.legs.reduce((s, l) => s + l.distance, 0)
}

/** 道に合わせた区間に、通過点を置く間隔の目安（m）。区間を短くして、手直し・引き直しを近くだけに効かせる */
export const MATCH_ANCHOR_EVERY_M = 1000

/** トラックのマップマッチングの結果の区間（routing の TrackMatchSection と同じ形。'@/' を使わないため、ここで受ける形だけを書く） */
export interface MatchedSectionLike {
  kind: 'matched' | 'kept'
  points: LL[]
}

/**
 * トラックのマップマッチングの結果を、道なり補正の下書きにする（トラックのマップマッチング設計書 §8 段階 2）。
 * - 両端（start・end。元のトラックの点）は固定の通過点
 * - 道に合わせた区間（matched）は auto・ok の区間。everyM ごとに通過点を置いて分ける
 * - 元の点を残した区間（kept）は straight の区間で、元の点の列をそのまま持つ
 * - 区間の境目に通過点を置く（動かせる）
 * 区間が無ければ null
 */
export function draftFromMatch(start: LL, end: LL, sections: MatchedSectionLike[], everyM: number = MATCH_ANCHOR_EVERY_M): Draft | null {
  if (sections.length === 0) return null
  const anchors: CreateAnchor[] = [{ id: newId('a-'), lat: start.lat, lng: start.lng, locked: true }]
  const legs: CreateLeg[] = []
  const push = (mode: LegMode, pts: LL[]) => {
    const from = anchors[anchors.length - 1]
    const points: LL[] = [ll(from)]
    for (const p of pts) {
      const last = points[points.length - 1]
      if (last.lat !== p.lat || last.lng !== p.lng) points.push(ll(p))
    }
    if (points.length < 2) return
    const to = points[points.length - 1]
    let distance = 0
    for (let i = 1; i < points.length; i++) distance += distanceLL(points[i - 1], points[i])
    anchors.push({ id: newId('a-'), lat: to.lat, lng: to.lng })
    legs.push({ id: newId('leg-'), mode, status: 'ok', points, distance, gen: 0 })
  }
  for (const sec of sections) {
    if (sec.kind === 'kept') { push('straight', sec.points); continue }
    // everyM ごとに切る（切る点は、前の区間の末尾と次の区間の先頭で共有する）
    let piece: LL[] = []
    let acc = 0
    for (let i = 0; i < sec.points.length; i++) {
      const p = sec.points[i]
      if (piece.length > 0) acc += distanceLL(piece[piece.length - 1], p)
      piece.push(p)
      if (acc >= everyM && i < sec.points.length - 1) {
        push('auto', piece)
        piece = [p]
        acc = 0
      }
    }
    push('auto', piece)
  }
  if (legs.length === 0) return null
  // 最後の通過点は、元のトラックの終点に固定する
  const lastLeg = legs[legs.length - 1]
  const lastPts = [...lastLeg.points]
  const tail = lastPts[lastPts.length - 1]
  if (tail.lat !== end.lat || tail.lng !== end.lng) {
    if (lastPts.length > 2 || lastLeg.mode === 'straight') lastPts[lastPts.length - 1] = ll(end)
    else lastPts.push(ll(end))
  }
  let distance = 0
  for (let i = 1; i < lastPts.length; i++) distance += distanceLL(lastPts[i - 1], lastPts[i])
  legs[legs.length - 1] = { ...lastLeg, points: lastPts, distance }
  anchors[anchors.length - 1] = { ...anchors[anchors.length - 1], lat: end.lat, lng: end.lng, locked: true }
  return { anchors, legs }
}
