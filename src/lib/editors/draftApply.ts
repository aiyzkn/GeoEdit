// 下書きの確定（designs/経路探索詳細設計書.md §10.2、機能追加・UI改善設計書 B0〜B2）。純粋関数。
// 元の routes・点のオブジェクトを書き換えない（変わったルートとトラックだけを新しく作る）。

import type { DraftTarget } from '../../types/editor.ts'
import type { RouteData, TrackPoint } from '../../types/route.ts'
import { redistributeTime, redistributeTimeWithRange, estimateDurationMs, type SpeedProfile } from './routeEditors.ts'
import { haversineM } from '../geometry.ts'

export interface DraftApplyInput {
  target: DraftTarget
  /** 下書きの点列（標高を付けたもの。時刻は付けない）。append の head は「描いた向き」のまま */
  points: TrackPoint[]
  /** target が new のとき */
  newRoute?: { id: string; name: string; trackName?: string; startTime?: Date; endTime?: Date }
  speed: SpeedProfile
}

export type DraftApplyResult =
  | { ok: true; routes: RouteData[]; undoLabel: string; addedPoints: number }
  | { ok: false; error: 'target-missing' | 'too-few-points' }

/** startIndex〜endIndex の間（両端を除く）の、ウェイポイント付きの点の数（確認ダイアログ用） */
export function countWaypointsInRange(points: TrackPoint[], startIndex: number, endIndex: number): number {
  const lo = Math.min(startIndex, endIndex), hi = Math.max(startIndex, endIndex)
  let n = 0
  for (let i = lo + 1; i < hi; i++) if (points[i]?.waypoint) n++
  return n
}

function strip(p: TrackPoint): TrackPoint {
  const q: TrackPoint = { lat: p.lat, lng: p.lng }
  if (p.ele != null) q.ele = p.ele
  return q
}

function replaceTrack(routes: RouteData[], routeId: string, trackIndex: number, points: TrackPoint[]): RouteData[] {
  return routes.map((r) => {
    if (r.id !== routeId) return r
    const tracks = r.tracks.map((t, i) => (i === trackIndex ? { ...t, points } : t))
    return { ...r, tracks }
  })
}

export function applyDraft(routes: RouteData[], input: DraftApplyInput): DraftApplyResult {
  const { target, speed } = input
  const pts = input.points.map(strip)

  if (target.kind === 'new') {
    if (pts.length < 2 || !input.newRoute) return { ok: false, error: 'too-few-points' }
    const { id, name, trackName, startTime, endTime } = input.newRoute
    let points = pts
    if (startTime) points = endTime ? redistributeTimeWithRange(points, startTime, endTime, speed) : redistributeTime(points, startTime, speed)
    const route: RouteData = {
      id, name, sourceFormat: 'gpx', sourceFileName: `${name}.gpx`, kind: 'track',
      tracks: [{ name: trackName || undefined, points }], standaloneWaypoints: [],
    }
    return { ok: true, routes: [...routes, route], undoLabel: 'ルート作成', addedPoints: points.length }
  }

  const route = routes.find((r) => r.id === target.routeId)
  const track = route?.tracks[target.trackIndex]
  if (!route || !track || track.points.length === 0) return { ok: false, error: 'target-missing' }
  const old = track.points

  if (target.kind === 'append') {
    if (pts.length < 2) return { ok: false, error: 'too-few-points' }
    if (target.end === 'tail') {
      let add = pts.slice(1)
      const last = old[old.length - 1]
      if (last.time) {
        const timed = redistributeTime([{ ...last }, ...add], last.time, speed)
        add = timed.slice(1)
      }
      return { ok: true, routes: replaceTrack(routes, route.id, target.trackIndex, [...old, ...add]), undoLabel: 'ルートに追記', addedPoints: add.length }
    }
    // head: 外へ向かって描いた線を、ルートの向き（外 → 先頭）にする
    let add = pts.slice(1).reverse()
    const first = old[0]
    if (first.time) {
      const seq = [...add, { lat: first.lat, lng: first.lng, ele: first.ele }]
      const dur = estimateDurationMs(seq, speed)
      const timed = redistributeTime(seq, new Date(first.time.getTime() - dur), speed)
      // 丸めで先頭の時刻とずれる分を、最後の点（= 既存の先頭）に合わせて詰める
      const shift = first.time.getTime() - timed[timed.length - 1].time!.getTime()
      add = timed.slice(0, -1).map((p) => ({ ...p, time: new Date(p.time!.getTime() + shift) }))
    }
    return { ok: true, routes: replaceTrack(routes, route.id, target.trackIndex, [...add, ...old]), undoLabel: 'ルートに追記', addedPoints: add.length }
  }

  // replace
  const s = Math.min(target.startIndex, target.endIndex), e = Math.max(target.startIndex, target.endIndex)
  if (s < 0 || e >= old.length || s === e) return { ok: false, error: 'target-missing' }
  if (pts.length < 2) return { ok: false, error: 'too-few-points' }
  // 下書きは startIndex → endIndex の向きに描かれている。並べ替えたときは逆にする
  const drawn = target.startIndex <= target.endIndex ? pts : [...pts].reverse()
  let mid = drawn.slice(1, -1)
  const a = old[s], b = old[e]
  if (a.time && b.time && mid.length > 0) {
    const seq = [a, ...mid, b]
    const cum = [0]
    for (let i = 1; i < seq.length; i++) cum.push(cum[i - 1] + haversineM(seq[i - 1].lat, seq[i - 1].lng, seq[i].lat, seq[i].lng))
    const total = cum[cum.length - 1]
    const t0 = a.time.getTime(), t1 = b.time.getTime()
    mid = mid.map((p, i) => ({ ...p, time: new Date(Math.round(t0 + (total > 0 ? (cum[i + 1] / total) : (i + 1) / (mid.length + 1)) * (t1 - t0))) }))
  }
  const next = [...old.slice(0, s + 1), ...mid, ...old.slice(e)]
  return { ok: true, routes: replaceTrack(routes, route.id, target.trackIndex, next), undoLabel: '道なり補正', addedPoints: mid.length }
}
