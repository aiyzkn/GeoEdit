// メインスレッド側の経路探索の窓口（designs/経路探索詳細設計書.md §7.2）。
// 最初に使ったときに Worker を作る。Worker を作れない環境では、同じスレッドで Router を直接呼ぶ。

import { Router } from '@/lib/routing'
import type { LatLng, MatchParams, RouteResult, RoutingOptions, TrackMatchResult } from '@/lib/routing'

export type RoutingWorkerRequest =
  | { type: 'snap'; id: number; lat: number; lng: number; options: RoutingOptions }
  | { type: 'route'; id: number; from: LatLng; to: LatLng; options: RoutingOptions }
  | { type: 'match'; id: number; points: LatLng[]; options: RoutingOptions; match?: MatchParams }
  | { type: 'cancel'; id: number }

export type RoutingWorkerResponse =
  | { type: 'snap'; id: number; point: LatLng | null }
  | { type: 'route'; id: number; result: RouteResult }
  | { type: 'match'; id: number; result: TrackMatchResult | null }
  | { type: 'progress'; id: number; done: number; total: number }

type Progress = (done: number, total: number) => void

interface Pending {
  resolve: (v: unknown) => void
  onProgress?: Progress
}

let worker: Worker | null = null
let workerFailed = false
let localRouter: Router | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    if (typeof Worker === 'undefined') throw new Error('no Worker')
    worker = new Worker(new URL('../workers/routing.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<RoutingWorkerResponse>) => {
      const msg = ev.data
      const p = pending.get(msg.id)
      if (!p) return
      if (msg.type === 'progress') { p.onProgress?.(msg.done, msg.total); return }
      pending.delete(msg.id)
      p.resolve(msg.type === 'snap' ? msg.point : msg.type === 'match' ? { value: msg.result } : msg.result)
    }
    worker.onerror = () => {
      // Worker が落ちたら、待っている要求を直線で返し、以後は同じスレッドで動かす
      workerFailed = true
      worker = null
      for (const [, p] of pending) p.resolve(null)
      pending.clear()
    }
  } catch {
    workerFailed = true
    worker = null
  }
  return worker
}

function local(): Router {
  if (!localRouter) localRouter = new Router()
  return localRouter
}

function send<T>(build: (id: number) => RoutingWorkerRequest, signal: AbortSignal | undefined, onProgress?: Progress): Promise<T | null> {
  const w = getWorker()
  if (!w) return Promise.resolve(null)
  const id = nextId++
  return new Promise<T | null>((resolve) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, onProgress })
    signal?.addEventListener('abort', () => w.postMessage({ type: 'cancel', id } satisfies RoutingWorkerRequest), { once: true })
    w.postMessage(build(id))
  })
}

/** 置いた位置を近くの道へ寄せる。道が無い・失敗したときは null */
export async function snapAnchor(at: LatLng, options: RoutingOptions, signal?: AbortSignal): Promise<LatLng | null> {
  if (getWorker()) {
    return send<LatLng>((id) => ({ type: 'snap', id, lat: at.lat, lng: at.lng, options }), signal)
  }
  return local().snap(at, options, signal)
}

/** 2 点の間を探索する。失敗しても直線（fallback）を返す */
export async function routeLeg(from: LatLng, to: LatLng, options: RoutingOptions, signal?: AbortSignal, onProgress?: Progress): Promise<RouteResult> {
  if (getWorker()) {
    const r = await send<RouteResult>((id) => ({ type: 'route', id, from, to, options }), signal, onProgress)
    if (r) return r
    if (signal?.aborted) return { status: 'fallback', points: [from, to], distance: 0, reason: 'aborted' }
    // Worker が落ちた: 同じスレッドでやり直す
  }
  return local().routeLeg(from, to, options, signal, onProgress)
}

/**
 * 既存の軌跡を道に合わせる（トラックのマップマッチング設計書）。道が見つからない区間は元の点を残す。
 * タイルを取れない・中止・軌跡が長すぎるときは null
 */
export async function matchTrack(points: LatLng[], options: RoutingOptions, signal?: AbortSignal, onProgress?: Progress, match?: MatchParams): Promise<TrackMatchResult | null> {
  if (getWorker()) {
    // Worker の結果は { value } で包む（null の結果と、Worker が落ちたときの null を区別するため）
    const r = await send<{ value: TrackMatchResult | null }>((id) => ({ type: 'match', id, points, options, match }), signal, onProgress)
    if (r) return r.value
    if (signal?.aborted) return null
    // Worker が落ちた: 同じスレッドでやり直す
  }
  return local().matchTrack(points, options, match, signal, onProgress)
}
