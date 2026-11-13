import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { EditMode, UndoEntry, SelectionRange } from '@/types/editor'
import type { RouteData, TrackPoint } from '@/types/route'

const MAX_UNDO = 50

export interface PartialEditState {
  routeId: string
  trackIndex: number
  startIndex: number
  originalLength: number
  points: TrackPoint[]
}

interface EditorState {
  mode: EditMode
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  selection: SelectionRange | null
  isBusy: boolean
  createPoints: { lat: number; lng: number }[]
  createRedoPoints: { lat: number; lng: number }[]
  // 作成モードのマップマッチング（designs/マップマッチング設計書.md）。セッション内のみ保持
  mapMatchEnabled: boolean
  mergeTargetIds: [string | null, string | null]
  partialEdit: PartialEditState | null
}

interface EditorActions {
  setMode: (mode: EditMode) => void
  pushUndo: (description: string, snapshot: RouteData[]) => void
  undo: (currentRoutes: RouteData[]) => UndoEntry | null
  redo: (currentRoutes: RouteData[]) => UndoEntry | null
  setSelection: (sel: SelectionRange | null) => void
  toggleDeleteRangeMarker: (routeId: string, trackIndex: number, index: number) => void
  setBusy: (busy: boolean) => void
  addCreatePoint: (lat: number, lng: number) => void
  removeCreatePointAt: (index: number) => void
  removeLastCreatePoint: () => void
  redoCreatePoint: () => void
  clearCreatePoints: () => void
  moveCreatePointAt: (index: number, lat: number, lng: number) => void
  setMapMatchEnabled: (enabled: boolean) => void
  toggleMergeTarget: (routeId: string) => void
  startPartialEdit: (state: PartialEditState) => void
  movePartialEditPoint: (index: number, lat: number, lng: number) => void
  removePartialEditPointAt: (index: number) => void
  insertPartialEditPointAt: (index: number, point: TrackPoint) => void
  setPartialEditPointEle: (index: number, ele: number) => void
  clearPartialEdit: () => void
}

/**
 * 作成モードに未確定ポイントがある状態でモードを離れると setMode() が createPoints を
 * 破棄するため、離脱前にユーザーへ確認する共通ガード。破棄してよい（または確認不要）なら
 * true を返す。モード切替の入口（ツールバー・Escapeキー）で setMode の前に呼ぶこと。
 * 確定ボタンは clearCreatePoints() 後に setMode するためこのガードを通らない。
 */
export function confirmDiscardCreatePoints(): boolean {
  const { mode, createPoints } = useEditorStore.getState()
  if (mode !== 'create' || createPoints.length === 0) return true
  return window.confirm(
    `作成中のルートには未確定のポイントが ${createPoints.length} 点あります。\n` +
      '確定せずに移動するとポイントは破棄されます。破棄してよろしいですか？'
  )
}

export const useEditorStore = create<EditorState & EditorActions>()(
  immer((set, get) => ({
    mode: 'none',
    undoStack: [],
    redoStack: [],
    selection: null,
    isBusy: false,
    createPoints: [],
    createRedoPoints: [],
    mapMatchEnabled: true,
    mergeTargetIds: [null, null],
    partialEdit: null,

    setMode: (mode) =>
      set((state) => {
        state.mode = mode
        if (mode !== 'deleteRange') {
          state.selection = null
        }
        if (mode !== 'create') {
          state.createPoints = []
          state.createRedoPoints = []
        }
        if (mode !== 'merge') {
          state.mergeTargetIds = [null, null]
        }
        if (mode !== 'partialEdit') {
          state.partialEdit = null
        }
      }),

    pushUndo: (description, snapshot) =>
      set((state) => {
        state.undoStack.push({ description, snapshot: structuredClone(snapshot) })
        if (state.undoStack.length > MAX_UNDO) {
          state.undoStack.shift()
        }
        state.redoStack = []
      }),

    // 標準的な2スタック方式。undo は「編集前スナップショット」を undoStack から取り出して
    // 呼び出し側に返す（＝これを復元すると編集前に戻る）と同時に、Undo実行直前の現在状態
    // （＝編集後）を redoStack へ退避する。これにより Redo で編集後状態へやり直せる。
    // description は「その操作をやり直す／元に戻す対象」を表すため両スタック間で引き継ぐ。
    undo: (currentRoutes) => {
      const { undoStack } = get()
      if (undoStack.length === 0) return null
      const entry = undoStack[undoStack.length - 1]
      set((state) => {
        state.undoStack.pop()
        state.redoStack.push({ description: entry.description, snapshot: structuredClone(currentRoutes) })
      })
      return entry
    },

    redo: (currentRoutes) => {
      const { redoStack } = get()
      if (redoStack.length === 0) return null
      const entry = redoStack[redoStack.length - 1]
      set((state) => {
        state.redoStack.pop()
        state.undoStack.push({ description: entry.description, snapshot: structuredClone(currentRoutes) })
      })
      return entry
    },

    setSelection: (sel) =>
      set((state) => {
        state.selection = sel
      }),

    // 部分削除モード用: クリックした点を開始/終了マーカーとして交互に設置する。
    // 設置順序は問わない（deleteRange() 側で min/max 判定する）。同じ1点を再クリックしたらキャンセル。
    toggleDeleteRangeMarker: (routeId, trackIndex, index) =>
      set((state) => {
        const sel = state.selection
        if (!sel || sel.routeId !== routeId || sel.trackIndex !== trackIndex) {
          state.selection = { routeId, trackIndex, startIndex: index, endIndex: index }
          return
        }
        if (sel.startIndex === sel.endIndex) {
          if (sel.startIndex === index) {
            state.selection = null
          } else {
            sel.endIndex = index
          }
          return
        }
        state.selection = { routeId, trackIndex, startIndex: index, endIndex: index }
      }),

    setBusy: (busy) =>
      set((state) => {
        state.isBusy = busy
      }),

    addCreatePoint: (lat, lng) =>
      set((state) => {
        state.createPoints.push({ lat, lng })
        state.createRedoPoints = []
      }),

    removeCreatePointAt: (index) =>
      set((state) => {
        state.createPoints.splice(index, 1)
      }),

    // Ctrl+Z（createモード時）・「1点削除」ボタン共通。末尾の1点を取り消し、
    // Ctrl+Y で再度追加できるよう createRedoPoints に退避する
    removeLastCreatePoint: () =>
      set((state) => {
        const removed = state.createPoints.pop()
        if (removed) state.createRedoPoints.push(removed)
      }),

    redoCreatePoint: () =>
      set((state) => {
        const restored = state.createRedoPoints.pop()
        if (restored) state.createPoints.push(restored)
      }),

    clearCreatePoints: () =>
      set((state) => {
        state.createPoints = []
        state.createRedoPoints = []
      }),

    moveCreatePointAt: (index, lat, lng) =>
      set((state) => {
        const p = state.createPoints[index]
        if (p) { p.lat = lat; p.lng = lng }
      }),

    setMapMatchEnabled: (enabled) =>
      set((state) => {
        state.mapMatchEnabled = enabled
      }),

    // 結合モード用: クリックしたルートをA/B枠に交互に設置する（要件定義書6.5「ルートを2つクリックして選択」）。
    // 同じルートを再クリックすると選択解除。すでに2枠埋まっている場合は新たにA枠から選び直す。
    toggleMergeTarget: (routeId) =>
      set((state) => {
        const [a, b] = state.mergeTargetIds
        if (a === routeId) { state.mergeTargetIds = [b, null]; return }
        if (b === routeId) { state.mergeTargetIds = [a, null]; return }
        if (a == null) { state.mergeTargetIds = [routeId, b]; return }
        if (b == null) { state.mergeTargetIds = [a, routeId]; return }
        state.mergeTargetIds = [routeId, null]
      }),

    // 部分編集モード用（要件定義書6.2）: クリック地点周辺の前後300点（最大601点）を
    // 編集用の作業コピーとして保持する。確定まで元のトラックには反映しない。
    startPartialEdit: (partialEditState) =>
      set((state) => {
        state.partialEdit = partialEditState
      }),

    movePartialEditPoint: (index, lat, lng) =>
      set((state) => {
        const p = state.partialEdit?.points[index]
        if (p) { p.lat = lat; p.lng = lng }
      }),

    removePartialEditPointAt: (index) =>
      set((state) => {
        if (!state.partialEdit) return
        // 始点・終点は削除不可（要件定義書6.2）
        if (index === 0 || index === state.partialEdit.points.length - 1) return
        state.partialEdit.points.splice(index, 1)
      }),

    insertPartialEditPointAt: (index, point) =>
      set((state) => {
        if (!state.partialEdit) return
        state.partialEdit.points.splice(index, 0, point)
      }),

    setPartialEditPointEle: (index, ele) =>
      set((state) => {
        const p = state.partialEdit?.points[index]
        if (p) p.ele = ele
      }),

    clearPartialEdit: () =>
      set((state) => {
        state.partialEdit = null
      }),
  }))
)
