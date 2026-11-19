// 自動保存と、離脱時の警告（designs/機能追加・UI改善設計書.md C1・C2）。
// routeStore.routes と下書きの変化を見て、最後の変化から 1 秒後に IndexedDB へ保存する。
// ページが隠れたとき・閉じるときは、待たずにすぐ保存する。

import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore, hasDraftWork } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { clearSession, saveSession, SESSION_SCHEMA, type SavedSession } from './sessionDb'
import { isRouteDirty } from './dirty'

export const AUTOSAVE_KEY = 'geoedit-autosave'
const DELAY_MS = 1000

/** 自動保存の設定（ブラウザごと。既定 ON） */
export function isAutosaveEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAutosaveEnabled(on: boolean) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, on ? 'on' : 'off')
  } catch {
    // 保存できなくても、このページの中では効く
  }
  if (!on) void clearSession().catch(() => {})
  else schedule()
}

let started = false
/** 起動時に前回の記録があり、利用者が「復元」か「破棄」を選ぶまでは保存しない（記録を上書きしないため） */
let paused = false
let failed = false
let timer: ReturnType<typeof setTimeout> | null = null

function snapshot(): SavedSession | null {
  const { routes, selectedRouteId, selectedTrackIndex } = useRouteStore.getState()
  const ed = useEditorStore.getState()
  const draft = (ed.mode === 'create' || ed.mode === 'reroute') && (ed.draft.anchors.length > 0)
    ? { draft: ed.draft, target: ed.draftTarget, mode: ed.mode }
    : null
  if (routes.length === 0 && !draft) return null
  return { schema: SESSION_SCHEMA, savedAt: new Date(), routes, selectedRouteId, selectedTrackIndex, draft }
}

async function saveNow() {
  if (timer) { clearTimeout(timer); timer = null }
  if (paused || failed || !isAutosaveEnabled()) return
  const s = snapshot()
  try {
    if (s) await saveSession(s)
    else await clearSession()
  } catch {
    // IndexedDB を使えない・容量を超えた: 1 回だけ知らせて、以後は保存しない
    failed = true
    useUiStore.getState().addToast('warning', '編集内容をこのブラウザに自動保存できません（以後、自動保存を止めます）')
  }
}

function schedule() {
  if (paused || failed || !isAutosaveEnabled()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void saveNow() }, DELAY_MS)
}

/** 保存していない変更があるか（離脱時の警告。C2） */
export function hasUnsavedChanges(): boolean {
  if (hasDraftWork()) return true
  return useRouteStore.getState().routes.some((r) => isRouteDirty(r))
}

/** アプリの起動時に 1 回呼ぶ。pausedAtStart = 前回の記録があり、復元を尋ねている */
export function startAutosave(pausedAtStart: boolean) {
  paused = pausedAtStart
  if (started) return
  started = true
  useRouteStore.subscribe((s, prev) => { if (s.routes !== prev.routes || s.selectedRouteId !== prev.selectedRouteId) schedule() })
  useEditorStore.subscribe((s, prev) => { if (s.draft !== prev.draft || s.mode !== prev.mode || s.draftTarget !== prev.draftTarget) schedule() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void saveNow() })
  window.addEventListener('pagehide', () => { void saveNow() })
  window.addEventListener('beforeunload', (e) => {
    void saveNow()
    if (hasUnsavedChanges()) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}

/** 復元を尋ねる帯で、利用者が選んだあと（復元・破棄）に呼ぶ。保存を再開する */
export function resumeAutosave() {
  paused = false
  schedule()
}
