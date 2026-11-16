// 作成モードの下書き（通過点と区間）の操作（designs/経路探索詳細設計書.md §8.2）。
// すべて純粋関数で、引数を書き換えない。単体テストから直接 import できるよう '@/' を使わない。

import type { CreateAnchor, CreateLeg, Draft, LegMode } from '../../types/editor.ts'
import type { RouteResult } from '../routing/types.ts'
import { distanceLL } from '../routing/geo.ts'

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

export function draftDistance(d: Draft): number {
  return d.legs.reduce((s, l) => s + l.distance, 0)
}
