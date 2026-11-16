import { useEffect } from 'react'
import { useEditorStore, confirmDiscardCreatePoints } from '@/stores/editorStore'
import { useRouteStore } from '@/stores/routeStore'
import { undo as draftUndo, redo as draftRedo } from '@/lib/draftController'

export function useKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Windows/Linux は Ctrl、Mac は Cmd（metaKey）を修飾キーとして扱う（要件定義書8章）。
      // Shift 押下時 e.key は大文字 'Z' になるため、比較は toLowerCase() で正規化する。
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 'o') {
        e.preventDefault()
        // Trigger file open via a custom event (AppHeader listens)
        document.dispatchEvent(new CustomEvent('open-files'))
      } else if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const editor = useEditorStore.getState()
        // ルート作成モード中は、下書きの操作（追加・移動・削除）の取り消しを優先する
        // （routeStore の Undo スタックは確定済みルートの操作しか記録していないため）
        if (editor.mode === 'create' && draftUndo()) return
        const entry = editor.undo(useRouteStore.getState().routes)
        if (entry) {
          useRouteStore.getState().setRoutes(entry.snapshot)
        }
      } else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault()
        const editor = useEditorStore.getState()
        if (editor.mode === 'create' && draftRedo()) return
        const entry = editor.redo(useRouteStore.getState().routes)
        if (entry) {
          useRouteStore.getState().setRoutes(entry.snapshot)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // 作成モードの未確定ポイントを暗黙に破棄しない（確認してキャンセル可能にする）
        if (!confirmDiscardCreatePoints()) return
        useEditorStore.getState().setMode('none')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
