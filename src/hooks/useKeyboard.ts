import { useEffect } from 'react'
import { useEditorStore, confirmLeaveDraft, requestDraftCommit } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { useRouteStore } from '@/stores/routeStore'
import { undo as draftUndo, redo as draftRedo } from '@/lib/draftController'

export function useKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
      // モーダル（確認ダイアログ・エクスポートなど）が開いている間は、全体のショートカットを効かせない（D4・D6）
      const modalOpen = !!document.querySelector('[role=dialog]')

      // Enter: いまのモードの「主な確定」（designs/機能追加・UI改善設計書.md D4）
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing) {
        if (modalOpen) return
        // 入力欄・ボタン・リンクの上では、その部品の Enter を優先する（入力欄の値の確定、名前変更の欄の確定など。
        // ここでも動かすと、値が入る前に実行したり、二重に実行したりする）
        if (inField || tag === 'BUTTON' || tag === 'A') return
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('mode-confirm'))
        return
      }

      if (inField) return

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
        if ((editor.mode === 'create' || editor.mode === 'reroute') && draftUndo()) return
        const entry = editor.undo(useRouteStore.getState().routes)
        if (entry) {
          useRouteStore.getState().setRoutes(entry.snapshot)
        }
      } else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault()
        const editor = useEditorStore.getState()
        if ((editor.mode === 'create' || editor.mode === 'reroute') && draftRedo()) return
        const entry = editor.redo(useRouteStore.getState().routes)
        if (entry) {
          useRouteStore.getState().setRoutes(entry.snapshot)
        }
      } else if (e.key === 'Escape') {
        if (modalOpen) return // モーダルの側で閉じる
        e.preventDefault()
        if (useUiStore.getState().confirmRequest) return // 確認ダイアログが閉じる（ダイアログの側で扱う）
        // 作成モードの未確定ポイントを暗黙に破棄しない（確認してキャンセル可能にする）
        void confirmLeaveDraft().then((answer) => {
          if (answer === 'keep') return
          if (answer === 'commit') { requestDraftCommit('none'); return }
          useEditorStore.getState().setMode('none')
        })
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
