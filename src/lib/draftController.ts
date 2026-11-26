// 作成モードの進行役（designs/経路探索詳細設計書.md §8.4）。
// 非同期の処理（道へ寄せる・区間を探索する・古い結果を捨てる）をここにまとめる。
// コンポーネントは、ここの関数を呼ぶだけにする。ストアは getState() で読む。

import L from 'leaflet'
import { useEditorStore } from '@/stores/editorStore'
import { useMapStore } from '@/stores/mapStore'
import { useUiStore } from '@/stores/uiStore'
import { matchPoint, isMatchModifierPressed } from '@/lib/mapMatch'
import { matchTrack, routeLeg, snapAnchor } from '@/lib/routingClient'
import { resolveRoutingOptions } from '@/lib/routing/settings'
import type { FallbackReason, LatLng, RasterNote, RoadClass } from '@/lib/routing'
import {
  addAnchor, bumpPending, draftFromMatch, emptyDraft, insertAnchor, moveAnchor, newId, pendingLegs, removeAnchor, resetAutoLegs, setLegResult,
} from '@/lib/editors/draft'
import type { Draft, DraftTarget, LegMode } from '@/types/editor'
import { useRouteStore } from '@/stores/routeStore'

const DRAG_THROTTLE_MS = 150

const FALLBACK_MESSAGES: Record<Exclude<FallbackReason, 'aborted'>, string> = {
  'no-road': '近くに道路が無いため、直線で結びました',
  'no-route': '経路が見つからないため、直線で結びました',
  'too-long': '区間が長すぎるため、直線で結びました。途中に通過点を置いてください（1 区間は直線距離で 100 km まで）',
  'tile-error': '道路データを取得できないため、直線で結びました',
}

/** 経路の元が地図画像を使う設定のときの知らせ（経路の元の選択設計書 §5） */
const RASTER_MESSAGES: Record<RasterNote, { level: 'info' | 'warning'; text: string }> = {
  used: { level: 'info', text: '地図画像の道を使って経路を引きました（ベクトルタイルに無い道を通ります）' },
  unavailable: { level: 'warning', text: 'この環境では地図画像を読めないため、ベクトルタイルだけで経路を引きました' },
  'too-large': { level: 'warning', text: '区間が長いため、地図画像を使わずにベクトルタイルだけで経路を引きました。途中に通過点を置くと使えます' },
  'tile-error': { level: 'warning', text: '地図画像を取得できないため、ベクトルタイルだけで経路を引きました' },
}

/** 経路の元が「地図画像のみ」で、地図画像を使えずに直線で結んだときの知らせ（ベクトルタイルには戻さない。設計書 §9.6） */
const RASTER_ONLY_FALLBACK: Record<Exclude<RasterNote, 'used'>, string> = {
  unavailable: 'この環境では地図画像を読めないため、直線で結びました',
  'too-large': '区間が長すぎて地図画像を使えないため、直線で結びました。途中に通過点を置いてください',
  'tile-error': '地図画像を取得できないため、直線で結びました。少し待ってから「引き直す」を試してください',
}

const store = () => useEditorStore.getState()

// ── 区間の探索 ────────────────────────────────────────────────────────
const inflight = new Map<string, AbortController>()
const progress = new Map<string, { done: number; total: number }>()
const toasted = new Set<string>()

function updateProgress() {
  let done = 0, total = 0
  for (const p of progress.values()) { done += p.done; total += p.total }
  store().setRoutingProgress(progress.size > 0 && total > 0 ? { done, total } : null)
}

function requestLeg(legId: string) {
  const d = store().draft
  const i = d.legs.findIndex((l) => l.id === legId)
  if (i < 0) return
  const leg = d.legs[i]
  if (leg.mode !== 'auto' || leg.status !== 'pending') return
  inflight.get(legId)?.abort()
  const ac = new AbortController()
  inflight.set(legId, ac)
  const gen = leg.gen
  const from: LatLng = { lat: d.anchors[i].lat, lng: d.anchors[i].lng }
  const to: LatLng = { lat: d.anchors[i + 1].lat, lng: d.anchors[i + 1].lng }
  const options = resolveRoutingOptions(store().routingSettings)
  void routeLeg(from, to, options, ac.signal, (done, total) => {
    if (inflight.get(legId) !== ac) return
    progress.set(legId, { done, total })
    updateProgress()
  }).then((result) => {
    if (inflight.get(legId) === ac) {
      inflight.delete(legId)
      progress.delete(legId)
      updateProgress()
    }
    if (result.reason === 'aborted' || ac.signal.aborted) return
    const cur = store().draft
    const next = setLegResult(cur, legId, gen, result)
    if (next === cur) return // 古い結果
    store().setDraft(next)
    const key = `${legId}:${gen}`
    if (result.status === 'fallback' && result.reason) {
      if (!toasted.has(key)) {
        toasted.add(key)
        const rasterOnly = options.source === 'raster' && result.raster && result.raster !== 'used'
        useUiStore.getState().addToast('warning', rasterOnly ? RASTER_ONLY_FALLBACK[result.raster as Exclude<RasterNote, 'used'>] : FALLBACK_MESSAGES[result.reason])
      }
    } else if (result.raster && !toasted.has(key)) {
      toasted.add(key)
      const m = RASTER_MESSAGES[result.raster]
      useUiStore.getState().addToast(m.level, m.text)
    }
  })
}

/** 引き直し待ちの区間を全部頼む */
function requestPending() {
  for (const leg of pendingLegs(store().draft)) requestLeg(leg.id)
}

/** 進行中の探索を全部止める */
export function cancelAll() {
  for (const ac of inflight.values()) ac.abort()
  inflight.clear()
  progress.clear()
  updateProgress()
  clickQueue = Promise.resolve()
  dragStart = null
  if (dragTimer) { clearTimeout(dragTimer); dragTimer = null }
}

/** 区間の両端の通過点の、どちらかの側に auto の区間があるか */
function touchesAuto(d: Draft, anchorIndex: number): boolean {
  return d.legs[anchorIndex - 1]?.mode === 'auto' || d.legs[anchorIndex]?.mode === 'auto'
}

/** 置いた位置の補正（§8.4 の表）。経路探索のときは道へ寄せる。そうでなければ画像のマップマッチング */
async function correctPosition(map: L.Map, at: LatLng, routing: boolean, skip: boolean): Promise<LatLng> {
  if (skip) return at
  const s = store()
  if (routing) {
    const p = await snapAnchor(at, resolveRoutingOptions(s.routingSettings))
    return p ?? at
  }
  if (!s.mapMatchEnabled) return at
  const r = await matchPoint({ map, latlng: L.latLng(at.lat, at.lng), baseLayerId: useMapStore.getState().baseLayerId })
  return { lat: r.lat, lng: r.lng }
}

// ── クリックで通過点を足す ─────────────────────────────────────────────
let clickQueue: Promise<void> = Promise.resolve()

/**
 * 地図のクリック。順序を保つため直列のキューに入れる。
 * straight: Ctrl（macOS は Cmd）押下。経路探索 ON ならその区間を直線に、OFF ならマップマッチングを飛ばす
 */
export function addAnchorAt(map: L.Map, at: LatLng, opts: { straight: boolean }) {
  const routing = store().routingSettings.enabled
  const mode: LegMode = routing && !opts.straight ? 'auto' : 'straight'
  clickQueue = clickQueue.then(async () => {
    const p = await correctPosition(map, at, routing, opts.straight)
    if (store().mode !== 'create') return
    // 追記の下書きは、端の点に固定の通過点が 1 つある状態で始まる（B2）
    const prev = store().draft
    store().commitDraft(prev)
    store().setDraft(addAnchor(prev, { id: newId('a-'), lat: p.lat, lng: p.lng }, mode))
    requestPending()
  }).catch(() => {})
}

// ── 追記・道なり補正の開始（B1・B2。経路探索詳細設計書 §10.1） ───────────
function trackPoints(routeId: string, trackIndex: number) {
  return useRouteStore.getState().routes.find((r) => r.id === routeId)?.tracks[trackIndex]?.points
}

/** 既存のトラックの端から続きを描く。端の点に固定の通過点を 1 つ置く。履歴は空にする */
export function startAppend(routeId: string, trackIndex: number, end: 'tail' | 'head'): boolean {
  const pts = trackPoints(routeId, trackIndex)
  if (!pts || pts.length === 0) return false
  cancelAll()
  const p = end === 'tail' ? pts[pts.length - 1] : pts[0]
  const d = addAnchor(emptyDraft(), { id: newId('a-'), lat: p.lat, lng: p.lng, locked: true }, 'auto')
  store().startDraft(d, { kind: 'append', routeId, trackIndex, end })
  return true
}

/** 自動保存から復元した下書きで再開する（C1）。探索中だった区間は頼み直す */
export function resumeDraft(d: Draft, target: DraftTarget) {
  cancelAll()
  store().startDraft(bumpPending(d), target)
  requestPending()
}

/** 新しいルートを作る（追記をやめる）。下書きは空にする */
export function startNew() {
  cancelAll()
  store().startDraft(emptyDraft(), { kind: 'new' })
}

/** 既存のトラックの 2 点の間を、道なりに引き直す。両端に固定の通過点を置き、間を 1 区間として頼む */
export function startReplace(routeId: string, trackIndex: number, startIndex: number, endIndex: number): boolean {
  const pts = trackPoints(routeId, trackIndex)
  if (!pts || startIndex === endIndex || !pts[startIndex] || !pts[endIndex]) return false
  cancelAll()
  const a = pts[startIndex], b = pts[endIndex]
  const mode: LegMode = store().routingSettings.enabled ? 'auto' : 'straight'
  let d = addAnchor(emptyDraft(), { id: newId('a-'), lat: a.lat, lng: a.lng, locked: true }, mode)
  d = addAnchor(d, { id: newId('a-'), lat: b.lat, lng: b.lng, locked: true }, mode)
  store().startDraft(d, { kind: 'replace', routeId, trackIndex, startIndex, endIndex })
  requestPending()
  return true
}

// ── 既存の軌跡を道に合わせる（トラックのマップマッチング設計書 §8 段階 2） ──
let matchAbort: AbortController | null = null

export type StartMatchResult =
  | { ok: true; observed: number; matched: number; keptSections: number; keptPoints: number }
  | { ok: false; error: 'bad-range' | 'failed' | 'aborted' | 'no-road' }

/**
 * トラックの startIndex〜endIndex を道に合わせ、道なり補正の下書きにする（確定は道なり補正と同じ）。
 * 道が見つからない区間は元の点を残す。startIndex > endIndex でもよい（並べ替える）
 */
export async function startMatch(routeId: string, trackIndex: number, startIndex: number, endIndex: number): Promise<StartMatchResult> {
  const pts = trackPoints(routeId, trackIndex)
  const s = Math.min(startIndex, endIndex), e = Math.max(startIndex, endIndex)
  if (!pts || s === e || !pts[s] || !pts[e]) return { ok: false, error: 'bad-range' }
  cancelAll()
  matchAbort?.abort()
  const ac = new AbortController()
  matchAbort = ac
  const slice = pts.slice(s, e + 1).map((p) => ({ lat: p.lat, lng: p.lng }))
  const base = resolveRoutingOptions(store().routingSettings)
  // 軌跡は実際に通った道を示すので、「高速・有料を避ける」の設定は使わない（階級の上限を外す）
  const options = { ...base, params: { ...base.params, maxClass: 6 as RoadClass } }
  const r = await matchTrack(slice, options, ac.signal, (done, total) => {
    if (matchAbort === ac) store().setRoutingProgress({ done, total })
  })
  if (matchAbort === ac) { matchAbort = null; store().setRoutingProgress(null) }
  if (ac.signal.aborted) return { ok: false, error: 'aborted' }
  if (!r) return { ok: false, error: 'failed' }
  if (r.matched === 0) return { ok: false, error: 'no-road' }
  const d = draftFromMatch(pts[s], pts[e], r.sections)
  if (!d) return { ok: false, error: 'failed' }
  store().startDraft(d, { kind: 'replace', routeId, trackIndex, startIndex: s, endIndex: e, match: true })
  const kept = r.sections.filter((x) => x.kind === 'kept')
  return { ok: true, observed: r.observed, matched: r.matched, keptSections: kept.length, keptPoints: kept.reduce((a, x) => a + x.input[1] - x.input[0] + 1, 0) }
}

/** 道に合わせる処理を中止する */
export function cancelMatch() {
  matchAbort?.abort()
}

// ── 通過点のドラッグ ──────────────────────────────────────────────────
let dragStart: Draft | null = null
let dragTimer: ReturnType<typeof setTimeout> | null = null
let lastDragSent = 0

export function beginAnchorDrag() {
  dragStart = store().draft
}

/**
 * 線の上のつまみのドラッグ開始（§8.5）。区間に通過点を差し込み、その id を返す。
 * 以後は通過点のドラッグと同じ（dragAnchorTo → endAnchorDrag）。区間が無ければ null
 */
export function insertAnchorOnLeg(legId: string, at: LatLng): string | null {
  const d = store().draft
  if (!d.legs.some((l) => l.id === legId)) return null
  dragStart = d
  const id = newId('a-')
  store().setDraft(insertAnchor(d, legId, { id, lat: at.lat, lng: at.lng }))
  return id
}

/** ドラッグ中。位置を反映し、150 ms に 1 回だけ前後の区間を頼む（最後の位置は必ず頼む） */
export function dragAnchorTo(anchorId: string, at: LatLng) {
  store().setDraft(moveAnchor(store().draft, anchorId, at.lat, at.lng))
  const now = Date.now()
  if (dragTimer) { clearTimeout(dragTimer); dragTimer = null }
  if (now - lastDragSent >= DRAG_THROTTLE_MS) {
    lastDragSent = now
    requestPending()
  } else {
    dragTimer = setTimeout(() => { dragTimer = null; lastDragSent = Date.now(); requestPending() }, DRAG_THROTTLE_MS - (now - lastDragSent))
  }
}

/** ドロップ。位置を補正して前後の区間を探索し、ドラッグ前の下書きを履歴に積む */
export async function endAnchorDrag(map: L.Map, anchorId: string, at: LatLng) {
  if (dragTimer) { clearTimeout(dragTimer); dragTimer = null }
  const before = dragStart ?? store().draft
  dragStart = null
  const i = store().draft.anchors.findIndex((a) => a.id === anchorId)
  if (i < 0) return
  const routing = store().routingSettings.enabled && touchesAuto(store().draft, i)
  // ドロップ位置をまず反映する（補正の待ちの間に、マーカーが元の位置へ戻って見えないように）
  store().setDraft(moveAnchor(store().draft, anchorId, at.lat, at.lng))
  const p = await correctPosition(map, at, routing, isMatchModifierPressed())
  const cur = store().draft
  const a = cur.anchors.find((x) => x.id === anchorId)
  if (!a) return
  if (a.lat !== p.lat || a.lng !== p.lng) store().setDraft(moveAnchor(cur, anchorId, p.lat, p.lng))
  const ba = before.anchors.find((x) => x.id === anchorId)
  if (!ba || ba.lat !== p.lat || ba.lng !== p.lng) store().commitDraft(before)
  requestPending()
}

// ── そのほかの操作 ────────────────────────────────────────────────────
export function removeAnchorById(anchorId: string) {
  const prev = store().draft
  const next = removeAnchor(prev, anchorId)
  if (next === prev) return
  store().commitDraft(prev)
  store().setDraft(next)
  requestPending()
}

export function removeLastAnchor() {
  const d = store().draft
  const last = d.anchors[d.anchors.length - 1]
  if (last) removeAnchorById(last.id)
}

/** auto の区間を、いまの設定で全部引き直す */
export function rerouteAll() {
  const prev = store().draft
  if (!prev.legs.some((l) => l.mode === 'auto')) return
  store().commitDraft(prev)
  store().setDraft(resetAutoLegs(prev))
  requestPending()
}

function afterHistoryMove() {
  store().setDraft(bumpPending(store().draft))
  requestPending()
}

export function undo(): boolean {
  if (store().draftPast.length === 0) return false
  for (const ac of inflight.values()) ac.abort()
  inflight.clear()
  progress.clear()
  updateProgress()
  store().undoDraft()
  afterHistoryMove()
  return true
}

export function redo(): boolean {
  if (store().draftFuture.length === 0) return false
  for (const ac of inflight.values()) ac.abort()
  inflight.clear()
  progress.clear()
  updateProgress()
  store().redoDraft()
  afterHistoryMove()
  return true
}
