// 結合テスト（ストア連携）: Zustand ストアのアクション・immer リデューサ・
// および複数ストアにまたがる実フロー（特に Undo/Redo のスナップショット往復）を検証する。
//
// これらは React コンポーネント外でも `useStore.getState()` で駆動できるため、
// ブラウザ無しで「アプリが実際に行う状態遷移」を結合レベルで確認できる。
// UI（ボタン押下→反映）は E2E がカバーするが、ここでは状態機械そのものの正しさを見る。
//
// 注意: Zustand ストアはモジュール単位のシングルトン。テスト間で状態が漏れないよう
//       beforeEach で初期状態へリセットする。uiStore は読み込み時に localStorage /
//       matchMedia を触るため node:test では扱わない（E2E でカバー）。
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useRouteStore } from '../../src/stores/routeStore.ts'
import { useEditorStore } from '../../src/stores/editorStore.ts'
import { useMapStore } from '../../src/stores/mapStore.ts'
import type { RouteData } from '../../src/types/route.ts'

let uid = 0
function makeRoute(name: string): RouteData {
  return {
    id: `id-${++uid}`,
    name,
    sourceFormat: 'gpx',
    sourceFileName: `${name}.gpx`,
    kind: 'track',
    tracks: [{ points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] }],
    standaloneWaypoints: [],
  }
}

beforeEach(() => {
  // 各ストアを初期状態へ戻す（シングルトン汚染防止）
  useRouteStore.setState({
    routes: [], selectedRouteId: null, selectedTrackIndex: 0,
    selectedPointIndex: null, hoveredPointIndex: null,
  })
  useEditorStore.setState({
    mode: 'none', undoStack: [], redoStack: [], selection: null, isBusy: false,
    createPoints: [], createRedoPoints: [], mergeTargetIds: [null, null], partialEdit: null,
  })
  useMapStore.setState({ baseLayerId: 'gsi-pale', activeOverlays: [], showElevation: true })
})

// ── routeStore の選択管理 ──────────────────────────────────────────────
test('routeStore: 最初のルート追加で自動選択、2本目では選択維持', () => {
  const rs = useRouteStore.getState()
  rs.addRoute(makeRoute('A'))
  assert.equal(useRouteStore.getState().selectedRouteId, useRouteStore.getState().routes[0].id)
  const firstId = useRouteStore.getState().selectedRouteId
  useRouteStore.getState().addRoute(makeRoute('B'))
  assert.equal(useRouteStore.getState().selectedRouteId, firstId, '2本目追加で選択は変わらない')
})

test('routeStore: 選択中ルート削除で先頭へ再選択、全削除で null', () => {
  const rs = useRouteStore.getState()
  rs.addRoute(makeRoute('A'))
  rs.addRoute(makeRoute('B'))
  const [a, b] = useRouteStore.getState().routes
  useRouteStore.getState().selectRoute(a.id)
  useRouteStore.getState().removeRoute(a.id)
  assert.equal(useRouteStore.getState().selectedRouteId, b.id, '削除後は残りの先頭へ')
  useRouteStore.getState().removeRoute(b.id)
  assert.equal(useRouteStore.getState().selectedRouteId, null, '全削除で null')
})

test('routeStore: updateRoute は immer ドラフトで対象ルートのみ変更', () => {
  const rs = useRouteStore.getState()
  rs.addRoute(makeRoute('A'))
  const id = useRouteStore.getState().routes[0].id
  useRouteStore.getState().updateRoute(id, (r) => { r.name = 'renamed' })
  assert.equal(useRouteStore.getState().routes[0].name, 'renamed')
})

test('routeStore: selectRoute でトラック・ポイント選択がリセットされる', () => {
  const rs = useRouteStore.getState()
  rs.addRoute(makeRoute('A'))
  const id = useRouteStore.getState().routes[0].id
  useRouteStore.getState().selectPoint(5)
  useRouteStore.getState().selectTrack(2)
  useRouteStore.getState().selectRoute(id)
  assert.equal(useRouteStore.getState().selectedPointIndex, null)
  assert.equal(useRouteStore.getState().selectedTrackIndex, 0)
})

// ── Undo/Redo 実フロー（editorStore × routeStore）─────────────────────
// アプリの handleUndo/handleRedo（AppHeader / useKeyboard）と同じ手順を再現する。
function doUndo() {
  const entry = useEditorStore.getState().undo(useRouteStore.getState().routes)
  if (entry) useRouteStore.getState().setRoutes(entry.snapshot)
  return entry
}
function doRedo() {
  const entry = useEditorStore.getState().redo(useRouteStore.getState().routes)
  if (entry) useRouteStore.getState().setRoutes(entry.snapshot)
  return entry
}

test('Undo/Redo: 編集前スナップショットへ戻り、Redoで編集後へ復帰する', () => {
  const rs = useRouteStore.getState()
  rs.addRoute(makeRoute('A')) // routes = [A(2点)]
  const ed = useEditorStore.getState()

  // 編集前スナップショットを積んでから編集（2点→1点）
  ed.pushUndo('区間削除', useRouteStore.getState().routes)
  const id = useRouteStore.getState().routes[0].id
  useRouteStore.getState().updateRoute(id, (r) => { r.tracks[0].points = [r.tracks[0].points[0]] })
  assert.equal(useRouteStore.getState().routes[0].tracks[0].points.length, 1)

  // Undo → 2点へ復元
  const undone = doUndo()
  assert.equal(undone?.description, '区間削除')
  assert.equal(useRouteStore.getState().routes[0].tracks[0].points.length, 2)

  // Redo → 1点へ復帰
  doRedo()
  assert.equal(useRouteStore.getState().routes[0].tracks[0].points.length, 1)
})

test('Undo/Redo: 新しい編集を積むと Redo スタックは破棄される', () => {
  const ed = useEditorStore.getState()
  useRouteStore.getState().addRoute(makeRoute('A'))

  ed.pushUndo('op1', useRouteStore.getState().routes)
  useRouteStore.getState().updateRoute(useRouteStore.getState().routes[0].id, (r) => { r.name = 'B' })
  doUndo()
  assert.equal(useEditorStore.getState().redoStack.length, 1, 'Undo後はRedo可能')

  // 新規編集を積む → redoStack がクリアされる
  useEditorStore.getState().pushUndo('op2', useRouteStore.getState().routes)
  assert.equal(useEditorStore.getState().redoStack.length, 0)
})

test('Undo/Redo: 空スタックでは null を返し状態は不変', () => {
  assert.equal(useEditorStore.getState().undo([]), null)
  assert.equal(useEditorStore.getState().redo([]), null)
})

test('Undo: スタックは MAX_UNDO=50 件で頭から捨てられる', () => {
  const ed = useEditorStore.getState()
  for (let i = 0; i < 55; i++) ed.pushUndo(`op${i}`, [])
  const stack = useEditorStore.getState().undoStack
  assert.equal(stack.length, 50)
  // 最古(op0..op4)が捨てられ、先頭が op5 になっている
  assert.equal(stack[0].description, 'op5')
  assert.equal(stack[stack.length - 1].description, 'op54')
})

test('Undo: スナップショットは structuredClone され、後続変更の影響を受けない', () => {
  const ed = useEditorStore.getState()
  useRouteStore.getState().addRoute(makeRoute('A'))
  ed.pushUndo('snap', useRouteStore.getState().routes)
  // 元 routes を破壊的に変更しても、スタック内スナップショットは無傷であるべき
  useRouteStore.getState().updateRoute(useRouteStore.getState().routes[0].id, (r) => { r.name = 'CHANGED' })
  assert.equal(useEditorStore.getState().undoStack[0].snapshot[0].name, 'A')
})

// ── 作成モードのポイント操作 ────────────────────────────────────────────
test('createPoints: 追加・末尾取り消し・やり直しが連動する', () => {
  const ed = useEditorStore.getState()
  ed.addCreatePoint(35, 139)
  ed.addCreatePoint(35.1, 139.1)
  ed.addCreatePoint(35.2, 139.2)
  assert.equal(useEditorStore.getState().createPoints.length, 3)

  ed.removeLastCreatePoint() // 末尾を redo バッファへ
  assert.equal(useEditorStore.getState().createPoints.length, 2)
  assert.equal(useEditorStore.getState().createRedoPoints.length, 1)

  ed.redoCreatePoint()
  assert.equal(useEditorStore.getState().createPoints.length, 3)
  assert.equal(useEditorStore.getState().createRedoPoints.length, 0)
})

test('createPoints: 新規追加で redo バッファがクリアされる', () => {
  const ed = useEditorStore.getState()
  ed.addCreatePoint(0, 0)
  ed.removeLastCreatePoint()
  assert.equal(useEditorStore.getState().createRedoPoints.length, 1)
  ed.addCreatePoint(1, 1)
  assert.equal(useEditorStore.getState().createRedoPoints.length, 0)
})

// ── setMode の副作用（一時状態のクリア）─────────────────────────────────
test('setMode: create 以外へ移ると createPoints がクリアされる', () => {
  const ed = useEditorStore.getState()
  ed.setMode('create')
  ed.addCreatePoint(0, 0)
  useEditorStore.getState().setMode('none')
  assert.equal(useEditorStore.getState().createPoints.length, 0)
})

test('setMode: merge 以外へ移ると mergeTargetIds がクリアされる', () => {
  const ed = useEditorStore.getState()
  ed.setMode('merge')
  ed.toggleMergeTarget('A')
  assert.deepEqual(useEditorStore.getState().mergeTargetIds, ['A', null])
  useEditorStore.getState().setMode('none')
  assert.deepEqual(useEditorStore.getState().mergeTargetIds, [null, null])
})

test('setMode: deleteRange 以外へ移ると selection がクリアされる', () => {
  const ed = useEditorStore.getState()
  ed.setSelection({ routeId: 'r', trackIndex: 0, startIndex: 1, endIndex: 3 })
  useEditorStore.getState().setMode('reverse')
  assert.equal(useEditorStore.getState().selection, null)
})

// ── 結合対象トグル（A/B 2枠）────────────────────────────────────────────
test('mergeTargetIds: A→B と埋め、再クリックで解除、3本目でA枠から選び直し', () => {
  const ed = useEditorStore.getState()
  ed.toggleMergeTarget('A')
  ed.toggleMergeTarget('B')
  assert.deepEqual(useEditorStore.getState().mergeTargetIds, ['A', 'B'])

  useEditorStore.getState().toggleMergeTarget('A') // A解除 → [B, null]
  assert.deepEqual(useEditorStore.getState().mergeTargetIds, ['B', null])

  useEditorStore.getState().toggleMergeTarget('C') // 空きB枠へ
  assert.deepEqual(useEditorStore.getState().mergeTargetIds, ['B', 'C'])

  useEditorStore.getState().toggleMergeTarget('D') // 満杯 → A枠から選び直し
  assert.deepEqual(useEditorStore.getState().mergeTargetIds, ['D', null])
})

// ── 区間削除マーカーのトグル ────────────────────────────────────────────
test('toggleDeleteRangeMarker: 交互クリックで start/end を設定、同一点再クリックで解除', () => {
  const ed = useEditorStore.getState()
  ed.toggleDeleteRangeMarker('r', 0, 2) // start=end=2
  assert.deepEqual(
    { s: useEditorStore.getState().selection?.startIndex, e: useEditorStore.getState().selection?.endIndex },
    { s: 2, e: 2 },
  )
  useEditorStore.getState().toggleDeleteRangeMarker('r', 0, 5) // end=5
  assert.equal(useEditorStore.getState().selection?.endIndex, 5)

  // start と end が確定した状態で別点 → 新しい始点として置き直し
  useEditorStore.getState().toggleDeleteRangeMarker('r', 0, 8)
  assert.deepEqual(
    { s: useEditorStore.getState().selection?.startIndex, e: useEditorStore.getState().selection?.endIndex },
    { s: 8, e: 8 },
  )
})

// ── mapStore（オーバーレイ管理）────────────────────────────────────────
test('mapStore: オーバーレイ追加は重複せず、透明度更新・削除ができる', () => {
  const ms = useMapStore.getState()
  ms.addOverlay('ov1', 0.4)
  ms.addOverlay('ov1', 0.9) // 重複追加は無視
  assert.equal(useMapStore.getState().activeOverlays.length, 1)

  useMapStore.getState().setOverlayOpacity('ov1', 0.7)
  assert.equal(useMapStore.getState().activeOverlays[0].opacity, 0.7)

  useMapStore.getState().removeOverlay('ov1')
  assert.equal(useMapStore.getState().activeOverlays.length, 0)
})
