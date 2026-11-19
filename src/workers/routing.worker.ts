// 経路探索を動かす Worker（designs/経路探索詳細設計書.md §7.2）。
// タイルのキャッシュとグラフは、この Worker の中だけに持つ。要求は 1 つずつ順に処理する。

import { Router } from '@/lib/routing'
import type { RoutingWorkerRequest, RoutingWorkerResponse } from '@/lib/routingClient'

const router = new Router()
const queue: RoutingWorkerRequest[] = []
const cancelled = new Set<number>()
const controllers = new Map<number, AbortController>()
let running = false

function post(msg: RoutingWorkerResponse) {
  ;(self as unknown as { postMessage(m: RoutingWorkerResponse): void }).postMessage(msg)
}

async function handle(req: RoutingWorkerRequest) {
  if (req.type === 'cancel') return
  const ac = new AbortController()
  controllers.set(req.id, ac)
  try {
    if (req.type === 'snap') {
      const point = cancelled.has(req.id) ? null : await router.snap({ lat: req.lat, lng: req.lng }, req.options, ac.signal)
      post({ type: 'snap', id: req.id, point })
    } else if (req.type === 'match') {
      const result = cancelled.has(req.id)
        ? null
        : await router.matchTrack(req.points, req.options, req.match, ac.signal, (done, total) =>
            post({ type: 'progress', id: req.id, done, total }))
      post({ type: 'match', id: req.id, result })
    } else {
      const result = cancelled.has(req.id)
        ? { status: 'fallback' as const, points: [req.from, req.to], distance: 0, reason: 'aborted' as const }
        : await router.routeLeg(req.from, req.to, req.options, ac.signal, (done, total) =>
            post({ type: 'progress', id: req.id, done, total }))
      post({ type: 'route', id: req.id, result })
    }
  } finally {
    controllers.delete(req.id)
    cancelled.delete(req.id)
  }
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const req = queue.shift()!
      await handle(req)
    }
  } finally {
    running = false
  }
}

self.onmessage = (ev: MessageEvent<RoutingWorkerRequest>) => {
  const req = ev.data
  if (req.type === 'cancel') {
    cancelled.add(req.id)
    controllers.get(req.id)?.abort()
    return
  }
  queue.push(req)
  void pump()
}
