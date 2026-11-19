import { useEffect, useState } from 'react'
import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { clearSession, loadSession, type SavedSession } from '@/lib/persistence/sessionDb'
import { isAutosaveEnabled, resumeAutosave, startAutosave } from '@/lib/persistence/autosave'
import { makeUniqueRouteName } from '@/lib/editors/routeEditors'
import { resumeDraft } from '@/lib/draftController'

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 起動時に前回の自動保存の記録があれば、地図の上に帯を出す（designs/機能追加・UI改善設計書.md C1）。
 * 自動では復元しない。帯を出している間は、記録を上書きしないよう保存を止めておく
 */
export default function RestoreBanner() {
  const [saved, setSaved] = useState<SavedSession | null>(null)

  useEffect(() => {
    let alive = true
    if (!isAutosaveEnabled()) { startAutosave(false); return }
    loadSession()
      .then((s) => {
        if (!alive) return
        const has = !!s && (s.routes.length > 0 || !!s.draft)
        startAutosave(has)
        if (has) setSaved(s)
      })
      .catch(() => { if (alive) startAutosave(false) })
    return () => { alive = false }
  }, [])

  if (!saved) return null

  const restore = () => {
    const rs = useRouteStore.getState()
    let taken = [...rs.routes]
    const idMap = new Map<string, string>()
    for (const r of saved.routes) {
      // 開いているルートと名前・id が重なれば付け替える
      const name = makeUniqueRouteName(taken, r.name)
      const id = taken.some((t) => t.id === r.id) ? crypto.randomUUID() : r.id
      idMap.set(r.id, id)
      const route = { ...r, id, name }
      useRouteStore.getState().addRoute(route)
      taken = [...taken, route]
    }
    if (saved.selectedRouteId && idMap.has(saved.selectedRouteId)) {
      useRouteStore.getState().selectRoute(idMap.get(saved.selectedRouteId)!)
      useRouteStore.getState().selectTrack(saved.selectedTrackIndex)
    }
    if (saved.draft) {
      let target = saved.draft.target
      if (target.kind !== 'new') {
        const newId = idMap.get(target.routeId)
        target = newId ? { ...target, routeId: newId } : { kind: 'new' }
      }
      const mode = target.kind === 'replace' ? 'reroute' : 'create'
      useEditorStore.getState().setMode(mode)
      resumeDraft(saved.draft.draft, target)
    }
    useUiStore.getState().addToast('success', `前回の編集内容を復元しました（${saved.routes.length} ルート）`)
    setSaved(null)
    resumeAutosave()
  }

  const discard = () => {
    void clearSession().catch(() => {})
    setSaved(null)
    resumeAutosave()
  }

  return (
    <div role="status" className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-3 py-2 rounded shadow-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-xs">
      <span>
        前回の編集内容があります（{saved.routes.length} ルート{saved.draft ? '・作成中の下書きあり' : ''}・{fmt(new Date(saved.savedAt))} 保存）
      </span>
      <button onClick={restore} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500">復元</button>
      <button onClick={discard} className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80">破棄</button>
    </div>
  )
}
