import { useEffect } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { fetchElevations } from '@/lib/elevationApi'
import { draftPointsSimplified, legPoints } from '@/lib/editors/draft'
import type { Draft } from '@/types/editor'

/** 変化してから標高を取りにいくまでの待ち（ドラッグ中に取り続けない。B5） */
const DEBOUNCE_MS = 300
/** 区間ごとの標高のキャッシュの上限 */
const CACHE_MAX = 500

/** 区間の id・世代・間引きの有無 → その区間の点ごとの標高 */
const cache = new Map<string, (number | null)[]>()

function legKey(id: string, gen: number, simplify: boolean, status: string): string {
  return `${id}:${gen}:${simplify ? 1 : 0}:${status}`
}

function remember(key: string, v: (number | null)[]) {
  cache.set(key, v)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** 下書きの点列に、キャッシュにある標高を付ける。足りない区間があれば complete = false */
function assemble(d: Draft, simplify: boolean, withEle: boolean) {
  const pts = draftPointsSimplified(d, simplify)
  if (!withEle) return { points: pts.map((p) => ({ lat: p.lat, lng: p.lng })), complete: false }
  if (d.legs.length === 0) return { points: pts.map((p) => ({ lat: p.lat, lng: p.lng })), complete: false }
  // draftPointsSimplified と同じ順で、区間ごとの標高をつなぐ（つなぎ目の同じ点は 1 つ）
  const out: { lat: number; lng: number; ele?: number }[] = []
  let complete = true
  for (const leg of d.legs) {
    const lp = legPoints(leg, simplify)
    const eles = cache.get(legKey(leg.id, leg.gen, simplify, leg.status))
    if (!eles || leg.status === 'pending') complete = false
    lp.forEach((p, k) => {
      const last = out[out.length - 1]
      if (last && last.lat === p.lat && last.lng === p.lng) return
      const e = eles?.[k]
      out.push(e == null ? { lat: p.lat, lng: p.lng } : { lat: p.lat, lng: p.lng, ele: e })
    })
  }
  return { points: out, complete }
}

/**
 * 作成モードの下書きの断面（点列と標高）を、editorStore.draftProfile に保つ（B5）。
 * 区間ごとに標高をキャッシュし、変わった区間だけ取り直す。アプリ全体で 1 か所だけ呼ぶ（EditModePanel）
 */
export function useDraftProfileSync() {
  const mode = useEditorStore((s) => s.mode)
  const draft = useEditorStore((s) => s.draft)
  const autoEle = useEditorStore((s) => s.createAutoElevation)
  const simplify = useEditorStore((s) => s.createSimplify)

  useEffect(() => {
    const store = useEditorStore.getState()
    if (mode !== 'create') { if (store.draftProfile) store.setDraftProfile(null); return }
    // まずキャッシュにあるもので組み立てる（線の形と道のりはすぐ出す）
    store.setDraftProfile(assemble(draft, simplify, autoEle))
    if (!autoEle) return
    const missing = draft.legs.filter((l) => l.status !== 'pending' && !cache.has(legKey(l.id, l.gen, simplify, l.status)))
    if (missing.length === 0) return
    const ac = new AbortController()
    const timer = setTimeout(async () => {
      for (const leg of missing) {
        if (ac.signal.aborted) return
        const pts = legPoints(leg, simplify)
        const eles = await fetchElevations(pts, ac.signal)
        if (ac.signal.aborted) return
        remember(legKey(leg.id, leg.gen, simplify, leg.status), eles)
      }
      const cur = useEditorStore.getState()
      if (cur.mode === 'create') cur.setDraftProfile(assemble(cur.draft, cur.createSimplify, cur.createAutoElevation))
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); ac.abort() }
  }, [mode, draft, autoEle, simplify])
}
