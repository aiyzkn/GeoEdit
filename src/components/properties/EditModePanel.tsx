import { useState, useEffect } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useRouteStore } from '@/stores/routeStore'
import { useUiStore } from '@/stores/uiStore'
import {
  splitTrack, deleteRange, reverseTrack, thinOutByDistance,
  redistributeTime, redistributeTimeWithRange, shiftTime, isRouteNameTaken,
  trackToNameLine, parseTrackNameLine,
  mergeRoutesUnified, mergeRoutesChronological, mergeRoutesSimple,
} from '@/lib/editors/routeEditors'
import { fetchElevations } from '@/lib/elevationApi'
import { useElevReplace } from '@/hooks/useElevReplace'
import ExportDialog from '@/components/common/ExportDialog'
import RoutingSettingsDialog from '@/components/properties/RoutingSettingsDialog'
import { draftPoints, draftDistance } from '@/lib/editors/draft'
import { removeLastAnchor, rerouteAll } from '@/lib/draftController'
import { Settings2 } from 'lucide-react'
import type { RouteData, TrackPoint } from '@/types/route'

/** <input type="datetime-local"> 用に、ローカルタイムゾーンでの日時文字列を組み立てる（toISOString はUTC基準のためズレる） */
function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EditModePanel() {
  const { mode, setMode, selection, setSelection, pushUndo, draft, clearDraft, routingSettings, setRoutingSettings, routingProgress, setBusy, mergeTargetIds, partialEdit, clearPartialEdit, mapMatchEnabled, setMapMatchEnabled } = useEditorStore()
  const { routes, selectedRouteId, selectedTrackIndex, selectedPointIndex, updateRoute, addRoute, removeRoute } = useRouteStore()
  const { addToast } = useUiStore()
  const { replaceElevations } = useElevReplace()


  const route = routes.find((r) => r.id === selectedRouteId)
  const track = route?.tracks[selectedTrackIndex]
  const [thinDistM, setThinDistM] = useState(10)
  const [timeStartStr, setTimeStartStr] = useState(() => toLocalDatetimeInputValue(new Date()))
  const [timeEndStr, setTimeEndStr] = useState('')
  const [timeEditSubMode, setTimeEditSubMode] = useState<'recalc' | 'shift'>('recalc')
  const [shiftDateStr, setShiftDateStr] = useState('')
  const [shiftTimeStr, setShiftTimeStr] = useState('')
  const [newName, setNewName] = useState(route?.name ?? '')
  const [trackNamesText, setTrackNamesText] = useState(() => (route?.tracks ?? []).map(trackToNameLine).join('\n'))
  const [showExport, setShowExport] = useState(false)
  const [createRouteName, setCreateRouteName] = useState('')
  const [createTrackName, setCreateTrackName] = useState('')
  // ページロード時点の日時を既定値にする（リアルタイム更新はしない。EditModePanel はアプリ全体で1度だけマウントされるため useState の初期化関数のみで足りる）
  const [createStartStr, setCreateStartStr] = useState(() => toLocalDatetimeInputValue(new Date()))
  const [createEndStr, setCreateEndStr] = useState('')
  const [autoElevation, setAutoElevation] = useState(true)
  const [creating, setCreating] = useState(false)
  const [mergeMethod, setMergeMethod] = useState<'unified' | 'chronological' | 'simple'>('unified')
  const [splitName1, setSplitName1] = useState('')
  const [splitName2, setSplitName2] = useState('')
  const [useFallbackEle, setUseFallbackEle] = useState(true)
  const [replacing, setReplacing] = useState(false)
  const [showRoutingSettings, setShowRoutingSettings] = useState(false)

  // EditModePanel はアプリ全体で1度だけマウントされ、モード切替時に再マウントされない。
  // そのため route 依存の初期値を useState の初期化関数だけに任せると、
  // ルート読込み前（マウント時点）の空値のまま固定されてしまう。
  // rename モードに切り替わるたびに最新の route 情報で再同期する。
  useEffect(() => {
    if (mode === 'rename' && route) {
      setNewName(route.name)
      setTrackNamesText(route.tracks.map(trackToNameLine).join('\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, route?.id])

  // create モードに入るたびに、ルート名・トラック名の入力欄へ既定値を設定する。
  // `route?.id` は依存に含めない（作成中に他ルートを選択しても入力中の値を消さないため）
  useEffect(() => {
    if (mode === 'create') {
      setCreateRouteName(`新規ルート ${routes.length + 1}`)
      setCreateTrackName('新規トラック 1')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  if (mode === 'none') return null
  if (mode !== 'create' && !route) return null

  const snapshot = () => routes

  const handleSplit = () => {
    if (!track || !route) {
      addToast('info', 'ポイントを選択してください')
      return
    }
    const idx = useRouteStore.getState().selectedPointIndex
    if (idx == null) { addToast('info', 'ポイントを選択してください'); return }

    const name1 = splitName1.trim() || route.name
    const name2 = splitName2.trim() || `${route.name} (2)`
    if (name1 === name2) { addToast('error', '2つのルート名は異なる名前にしてください'); return }
    if (isRouteNameTaken(routes, name1, route.id)) { addToast('error', `同名のルートが既に存在します: ${name1}`); return }
    if (isRouteNameTaken(routes, name2, route.id)) { addToast('error', `同名のルートが既に存在します: ${name2}`); return }

    pushUndo('トラック分割', snapshot())
    const [before, after] = splitTrack(track.points, idx)
    updateRoute(route.id, (r) => {
      r.name = name1
      r.tracks[selectedTrackIndex] = { ...track, points: before }
    })
    addRoute({
      id: crypto.randomUUID(),
      name: name2,
      sourceFormat: route.sourceFormat,
      sourceFileName: route.sourceFileName,
      kind: route.kind,
      tracks: [{ ...track, points: after }],
      standaloneWaypoints: [],
    })
    addToast('success', 'ルートを2つに分割しました')
    setMode('none')
  }

  const handleDeleteRange = (kind: 'range' | 'toStart' | 'toEnd') => {
    if (!track) return
    const sel = useEditorStore.getState().selection
    if (!sel) { addToast('info', '開始・終了ポイントを選択してください'); return }
    let start = sel.startIndex
    let end = sel.endIndex
    if (kind === 'toStart') { start = 0; end = sel.startIndex }
    if (kind === 'toEnd') { start = sel.startIndex; end = track.points.length - 1 }
    pushUndo('区間削除', snapshot())
    const pts = deleteRange(track.points, start, end)
    updateRoute(route.id, (r) => { r.tracks[selectedTrackIndex].points = pts })
    addToast('success', `区間削除: ${Math.abs(end - start) + 1} ポイント削除`)
    setSelection(null)
    setMode('none')
  }

  const handleReverse = () => {
    if (!track) return
    pushUndo('逆順', snapshot())
    const pts = reverseTrack(track.points)
    updateRoute(route.id, (r) => { r.tracks[selectedTrackIndex].points = pts })
    addToast('success', 'トラックを逆順にしました')
    setMode('none')
  }

  const handleWaypointFieldCommit = (field: 'name' | 'cmt' | 'desc', value: string) => {
    if (!route || !track || selectedPointIndex == null) return
    const pt = track.points[selectedPointIndex]
    if (!pt?.waypoint) return
    pushUndo('ウェイポイント編集', snapshot())
    updateRoute(route.id, (r) => {
      const p = r.tracks[selectedTrackIndex].points[selectedPointIndex]
      if (!p?.waypoint) return
      p.waypoint[field] = value.trim() || undefined
    })
  }

  const handleElevReplace = async () => {
    setReplacing(true)
    await replaceElevations(useFallbackEle)
    setReplacing(false)
    setMode('none')
  }

  const handleThinOut = () => {
    if (!track) return
    pushUndo('間引き', snapshot())
    const pts = thinOutByDistance(track.points, thinDistM)
    const removed = track.points.length - pts.length
    updateRoute(route.id, (r) => { r.tracks[selectedTrackIndex].points = pts })
    addToast('success', `間引き完了: ${removed} ポイント削除`)
    setMode('none')
  }

  const handleTimeEdit = () => {
    if (!track) return
    const start = new Date(timeStartStr)
    if (isNaN(start.getTime())) { addToast('error', '日時の形式が正しくありません'); return }

    let pts: TrackPoint[]
    if (timeEndStr) {
      const end = new Date(timeEndStr)
      if (isNaN(end.getTime())) { addToast('error', '終了日時の形式が正しくありません'); return }
      if (start.toDateString() !== end.toDateString()) {
        addToast('error', '開始・終了は同じ日付にしてください（日付をまたぐ設定は不可）')
        return
      }
      if (end.getTime() <= start.getTime()) { addToast('error', '終了日時は開始日時より後にしてください'); return }
      pushUndo('時刻再計算', snapshot())
      pts = redistributeTimeWithRange(track.points, start, end)
    } else {
      pushUndo('時刻再計算', snapshot())
      pts = redistributeTime(track.points, start)
    }
    updateRoute(route.id, (r) => { r.tracks[selectedTrackIndex].points = pts })
    addToast('success', '時刻を再計算しました')
    setMode('none')
  }

  const handleTimeShift = () => {
    if (!track) return
    if (!shiftDateStr && !shiftTimeStr) {
      addToast('info', '日付または開始時刻を指定してください')
      return
    }
    pushUndo('時刻シフト', snapshot())
    const pts = shiftTime(track.points, shiftDateStr || undefined, shiftTimeStr || undefined)
    updateRoute(route.id, (r) => { r.tracks[selectedTrackIndex].points = pts })
    addToast('success', '時刻をシフトしました')
    setMode('none')
  }

  const handleRename = () => {
    const trimmed = newName.trim()
    if (!trimmed || !route) return
    if (isRouteNameTaken(routes, trimmed, route.id)) {
      addToast('error', `同名のルートが既に存在します: ${trimmed}`)
      return
    }
    const lines = trackNamesText.split('\n')
    pushUndo('名前変更', snapshot())
    updateRoute(route.id, (r) => {
      r.name = trimmed
      lines.forEach((line, i) => {
        if (!r.tracks[i]) return
        const { name, number } = parseTrackNameLine(line)
        r.tracks[i].name = name
        r.tracks[i].number = number
      })
    })
    addToast('success', '名前を変更しました')
    setMode('none')
  }

  const handleMerge = () => {
    const [idA, idB] = mergeTargetIds
    if (!idA) { addToast('info', '結合するルートを選択してください'); return }
    const routeA = routes.find((r) => r.id === idA)
    if (!routeA) return

    // 「トラックを統合(unified)」「時系列(chronological)」は全ポイントに時刻データが必要（要件定義書6.5）。
    // 「単純接続(simple)」は時刻不要。
    const allPointsHaveTime = (rts: RouteData[]) => rts.every((rt) => rt.tracks.every((t) => t.points.every((p) => p.time != null)))

    // ルートを1つだけ選択: そのルート内の複数トラックを1本に統合する（要件定義書6.5）
    if (!idB) {
      if (routeA.tracks.length < 2) { addToast('info', '統合できる複数トラックがありません'); return }
      if (mergeMethod !== 'unified') { addToast('info', '1ルートのみ選択時は「トラックを統合して結合」のみ使用できます'); return }
      if (!allPointsHaveTime([routeA])) { addToast('error', 'トラックを統合して結合するには全ポイントに時刻データが必要です'); return }
      pushUndo('トラック結合', snapshot())
      const merged = mergeRoutesUnified(routeA.tracks, [])
      updateRoute(routeA.id, (r) => { r.tracks = merged })
      addToast('success', `ルート内の${routeA.tracks.length}トラックを統合しました`)
      setMode('none')
      return
    }

    const routeB = routes.find((r) => r.id === idB)
    if (!routeB) return

    if ((mergeMethod === 'unified' || mergeMethod === 'chronological') && !allPointsHaveTime([routeA, routeB])) {
      addToast('error', `「${mergeMethod === 'unified' ? 'トラックを統合' : '時系列'}で結合」には両ルートの全ポイントに時刻データが必要です。時刻が無い場合は「単純接続」を使用してください`)
      return
    }

    pushUndo('ルート結合', snapshot())
    const merged = mergeMethod === 'unified'
      ? mergeRoutesUnified(routeA.tracks, routeB.tracks)
      : mergeMethod === 'chronological'
      ? mergeRoutesChronological(routeA.tracks, routeB.tracks)
      : mergeRoutesSimple(routeA.tracks, routeB.tracks)
    updateRoute(routeA.id, (r) => { r.tracks = merged })
    removeRoute(routeB.id)
    addToast('success', `${routeA.name} と ${routeB.name} を結合しました`)
    setMode('none')
  }

  const handlePartialEditConfirm = () => {
    if (!partialEdit) return
    const targetRoute = routes.find((r) => r.id === partialEdit.routeId)
    if (!targetRoute) return
    pushUndo('部分編集', snapshot())
    updateRoute(partialEdit.routeId, (r) => {
      r.tracks[partialEdit.trackIndex].points.splice(partialEdit.startIndex, partialEdit.originalLength, ...partialEdit.points)
    })
    clearPartialEdit()
    addToast('success', `部分編集を確定しました（${partialEdit.points.length} ポイント）`)
    setMode('none')
  }

  const handleCreateConfirm = async () => {
    if (draft.anchors.length < 2) {
      addToast('info', '地図をクリックして2点以上追加してください')
      return
    }
    if (draft.legs.some((l) => l.status === 'pending')) {
      addToast('info', '経路の探索が終わってから確定してください')
      return
    }
    const name = createRouteName.trim() || `新規ルート ${routes.length + 1}`
    if (isRouteNameTaken(routes, name)) {
      addToast('error', `同名のルートが既に存在します: ${name}`)
      return
    }
    let startTime: Date | undefined
    let endTime: Date | undefined
    if (createStartStr) {
      startTime = new Date(createStartStr)
      if (isNaN(startTime.getTime())) { addToast('error', '開始日時の形式が正しくありません'); return }
    }
    if (createEndStr) {
      if (!startTime) { addToast('error', '終了日時を指定する場合は開始日時も指定してください'); return }
      endTime = new Date(createEndStr)
      if (isNaN(endTime.getTime())) { addToast('error', '終了日時の形式が正しくありません'); return }
      if (startTime.toDateString() !== endTime.toDateString()) {
        addToast('error', '開始・終了は同じ日付にしてください（日付をまたぐ設定は不可）')
        return
      }
      if (endTime.getTime() <= startTime.getTime()) { addToast('error', '終了日時は開始日時より後にしてください'); return }
    }

    const pts = draftPoints(draft)
    setCreating(true)
    setBusy(true)
    let elevs: (number | null)[] = []
    if (autoElevation) {
      addToast('info', `標高取得中: ${pts.length} ポイント`)
      elevs = await fetchElevations(pts)
    }
    let points: TrackPoint[] = pts.map((p, i) => ({
      lat: p.lat,
      lng: p.lng,
      ele: elevs[i] ?? undefined,
    }))
    if (startTime) {
      points = endTime ? redistributeTimeWithRange(points, startTime, endTime) : redistributeTime(points, startTime)
    }
    const newRoute: RouteData = {
      id: crypto.randomUUID(),
      name,
      sourceFormat: 'gpx',
      sourceFileName: `${name}.gpx`,
      kind: 'track',
      tracks: [{ name: createTrackName.trim() || undefined, points }],
      standaloneWaypoints: [],
    }
    pushUndo('ルート作成', routes)
    addRoute(newRoute)
    clearDraft()
    setBusy(false)
    setCreating(false)
    addToast('success', `ルートを作成しました（${points.length} ポイント）`)
    setMode('none')
  }

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs space-y-2">
      {mode === 'create' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">新規ルート作成:</span>
          <span>地図をクリックしてポイントを追加（{draft.anchors.length} 点）</span>
          {draft.legs.length > 0 && <span className="text-[var(--color-muted)]">{(draftDistance(draft) / 1000).toFixed(2)} km</span>}
          <input
            type="text"
            placeholder="ルート名"
            value={createRouteName}
            onChange={(e) => setCreateRouteName(e.target.value)}
            className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-32"
          />
          <input
            type="text"
            placeholder="トラック名"
            value={createTrackName}
            onChange={(e) => setCreateTrackName(e.target.value)}
            className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-32"
          />
          <input
            type="datetime-local"
            value={createStartStr}
            onChange={(e) => setCreateStartStr(e.target.value)}
            title="開始日時（任意）"
            className="px-1 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
          />
          <input
            type="datetime-local"
            value={createEndStr}
            onChange={(e) => setCreateEndStr(e.target.value)}
            title="終了日時（任意・同一日付内のみ）"
            className="px-1 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
          />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={autoElevation} onChange={(e) => setAutoElevation(e.target.checked)} />
            標高を自動取得
          </label>
          <label
            className="flex items-center gap-1"
            title="通過点の間を、道路に沿って自動で結びます。Ctrl（macOSは⌘）を押しながらクリックすると、その区間だけ直線で結びます"
          >
            <input type="checkbox" checked={routingSettings.enabled} onChange={(e) => setRoutingSettings({ enabled: e.target.checked })} />
            経路探索
          </label>
          <button
            onClick={() => setShowRoutingSettings(true)}
            aria-label="経路探索の設定"
            title="経路探索の設定"
            className="p-1 rounded hover:bg-[var(--color-border)]"
          >
            <Settings2 size={14} />
          </button>
          {routingSettings.enabled && (
            <>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={routingSettings.avoidMotorway || routingSettings.avoidToll} disabled={routingSettings.avoidToll}
                  onChange={(e) => setRoutingSettings({ avoidMotorway: e.target.checked })} />
                高速を使わない
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={routingSettings.avoidToll} onChange={(e) => setRoutingSettings({ avoidToll: e.target.checked })} />
                有料道路を使わない
              </label>
              <button
                onClick={rerouteAll}
                disabled={!draft.legs.some((l) => l.mode === 'auto')}
                title="経路探索で結んだ区間を、いまの設定で引き直します"
                className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80 disabled:opacity-40"
              >
                引き直す
              </button>
            </>
          )}
          <label
            className={`flex items-center gap-1 ${routingSettings.enabled ? 'opacity-50' : ''}`}
            title={routingSettings.enabled
              ? '経路探索が ON のときは、通過点を道路の中心線へ寄せます'
              : 'クリック地点を地図画像の解析で道路中心・交差点中心へ補正します。地理院地図（標準・淡色）表示中かつズーム15以上で有効。Ctrl（macOSは⌘）を押しながらクリックすると一時的に無効化'}
          >
            <input type="checkbox" checked={mapMatchEnabled} disabled={routingSettings.enabled} onChange={(e) => setMapMatchEnabled(e.target.checked)} />
            マップマッチング
          </label>
          {routingProgress && routingProgress.total >= 8 && (
            <span className="text-[var(--color-muted)]">道路データを取得中 {routingProgress.done}/{routingProgress.total}</span>
          )}
          <button
            onClick={removeLastAnchor}
            disabled={draft.anchors.length === 0}
            className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80 disabled:opacity-40"
          >
            1点削除
          </button>
          <button
            onClick={handleCreateConfirm}
            disabled={draft.anchors.length < 2 || creating || draft.legs.some((l) => l.status === 'pending')}
            className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40"
          >
            {creating ? '作成中…' : draft.legs.some((l) => l.status === 'pending') ? '探索中…' : '確定'}
          </button>
          {showRoutingSettings && (
            <RoutingSettingsDialog
              onClose={(changed) => {
                setShowRoutingSettings(false)
                if (changed && useEditorStore.getState().draft.legs.some((l) => l.mode === 'auto')) {
                  addToast('info', '設定を変えました。「引き直す」で、引いた区間に反映できます')
                }
              }}
            />
          )}
        </div>
      )}
      {mode === 'split' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">分割:</span>
          <span>地図またはタイムラインでポイントを選択後</span>
          <input
            type="text"
            placeholder={route ? `ルート1名（既定: ${route.name}）` : 'ルート1名'}
            value={splitName1}
            onChange={(e) => setSplitName1(e.target.value)}
            className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-40"
          />
          <input
            type="text"
            placeholder={route ? `ルート2名（既定: ${route.name} (2)）` : 'ルート2名'}
            value={splitName2}
            onChange={(e) => setSplitName2(e.target.value)}
            className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-40"
          />
          <button onClick={handleSplit} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500">分割実行</button>
        </div>
      )}
      {mode === 'deleteRange' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">区間削除:</span>
          <span>地図またはタイムラインで開始・終了ポイントをクリック（再クリックでキャンセル）</span>
          {selection && selection.startIndex === selection.endIndex && (
            <>
              <span className="text-red-500">[{selection.startIndex}]</span>
              <button onClick={() => handleDeleteRange('toStart')} className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-500">始点〜この点を削除</button>
              <button onClick={() => handleDeleteRange('toEnd')} className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-500">この点〜終点を削除</button>
            </>
          )}
          {selection && selection.startIndex !== selection.endIndex && (
            <>
              <span className="text-red-500">[{selection.startIndex}→{selection.endIndex}]</span>
              <button onClick={() => handleDeleteRange('range')} className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-500">削除実行</button>
            </>
          )}
        </div>
      )}
      {mode === 'reverse' && (
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-muted)]">逆順:</span>
          <button onClick={handleReverse} className="px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-500">逆順にする</button>
        </div>
      )}
      {mode === 'pointInfo' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">詳細:</span>
          {track && selectedPointIndex != null ? (
            <span>選択中のポイント #{selectedPointIndex} の詳細を右サイドバーの「属性」タブに表示しています（緯度経度・標高・時刻は編集可能）</span>
          ) : (
            <span>地図またはタイムラインでポイントをクリックすると、右サイドバーの「属性」タブに詳細情報が表示されます</span>
          )}
        </div>
      )}
      {mode === 'waypoint' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">ウェイポイント:</span>
          <span>ルート上クリックで追加・マーカー右クリックで削除（即時反映）</span>
          {track && selectedPointIndex != null && track.points[selectedPointIndex]?.waypoint ? (
            <>
              <input
                key={`wpt-name-${selectedPointIndex}`}
                type="text"
                placeholder="名前 (name)"
                defaultValue={track.points[selectedPointIndex].waypoint?.name ?? ''}
                onBlur={(e) => handleWaypointFieldCommit('name', e.target.value)}
                className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-28"
              />
              <input
                key={`wpt-cmt-${selectedPointIndex}`}
                type="text"
                placeholder="コメント (cmt)"
                defaultValue={track.points[selectedPointIndex].waypoint?.cmt ?? ''}
                onBlur={(e) => handleWaypointFieldCommit('cmt', e.target.value)}
                className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-28"
              />
              <input
                key={`wpt-desc-${selectedPointIndex}`}
                type="text"
                placeholder="説明 (desc)"
                defaultValue={track.points[selectedPointIndex].waypoint?.desc ?? ''}
                onBlur={(e) => handleWaypointFieldCommit('desc', e.target.value)}
                className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-28"
              />
            </>
          ) : (
            <span className="text-[var(--color-muted)]">編集するにはウェイポイントマーカー（オレンジ）をクリック</span>
          )}
        </div>
      )}
      {mode === 'elevReplace' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">標高置換（国土地理院API）:</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="useFallbackEle" checked={useFallbackEle} onChange={() => setUseFallbackEle(true)} />
            データが無い地点は前後から補間した代替値を使用
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="useFallbackEle" checked={!useFallbackEle} onChange={() => setUseFallbackEle(false)} />
            データが無い地点は標高をブランクにする
          </label>
          <button
            onClick={handleElevReplace}
            disabled={replacing}
            className="px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-40"
          >
            {replacing ? '取得中…' : '標高置換実行'}
          </button>
        </div>
      )}
      {mode === 'thinOut' && (
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-muted)]">間引き距離:</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={thinDistM}
            onChange={(e) => setThinDistM(Number(e.target.value))}
            className="w-20 px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)]"
          />
          <span>m</span>
          <button onClick={handleThinOut} className="px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-500">間引き実行</button>
        </div>
      )}
      {mode === 'timeEdit' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTimeEditSubMode('recalc')}
              className={`px-2 py-1 rounded text-[10px] ${timeEditSubMode === 'recalc' ? 'bg-green-600 text-white' : 'bg-[var(--color-border)]'}`}
            >
              一括再計算
            </button>
            <button
              onClick={() => setTimeEditSubMode('shift')}
              className={`px-2 py-1 rounded text-[10px] ${timeEditSubMode === 'shift' ? 'bg-green-600 text-white' : 'bg-[var(--color-border)]'}`}
            >
              シフト
            </button>
          </div>
          {timeEditSubMode === 'recalc' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[var(--color-muted)]">開始日時:</span>
              <input
                type="datetime-local"
                value={timeStartStr}
                onChange={(e) => setTimeStartStr(e.target.value)}
                className="px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
              />
              <span className="text-[var(--color-muted)]">終了日時（任意・同一日付内のみ）:</span>
              <input
                type="datetime-local"
                value={timeEndStr}
                onChange={(e) => setTimeEndStr(e.target.value)}
                className="px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
              />
              <button onClick={handleTimeEdit} className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-500">時刻再計算</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[var(--color-muted)]">新しい日付（任意）:</span>
              <input
                type="date"
                value={shiftDateStr}
                onChange={(e) => setShiftDateStr(e.target.value)}
                className="px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
              />
              <span className="text-[var(--color-muted)]">新しい開始時刻（任意・秒は保持）:</span>
              <input
                type="time"
                value={shiftTimeStr}
                onChange={(e) => setShiftTimeStr(e.target.value)}
                className="px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
              />
              <button onClick={handleTimeShift} className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-500">シフト実行</button>
            </div>
          )}
        </div>
      )}
      {mode === 'merge' && (() => {
        const [idA, idB] = mergeTargetIds
        const routeA = routes.find((r) => r.id === idA)
        const routeB = idB ? routes.find((r) => r.id === idB) : null
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[var(--color-muted)]">結合: サイドバーまたは地図でルートを2つクリックして選択（再クリックで解除）</span>
            <span className="text-teal-500">
              {routeA ? routeA.name : '(未選択)'} {idB ? `+ ${routeB?.name}` : ''}
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="mergeMethod" checked={mergeMethod === 'unified'} onChange={() => setMergeMethod('unified')} />
                トラックを統合して結合
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="mergeMethod" checked={mergeMethod === 'chronological'} disabled={!idB} onChange={() => setMergeMethod('chronological')} />
                トラックを時系列で結合
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="mergeMethod" checked={mergeMethod === 'simple'} disabled={!idB} onChange={() => setMergeMethod('simple')} />
                トラックの単純接続
              </label>
            </div>
            <button onClick={handleMerge} className="px-2 py-1 bg-teal-600 text-white rounded hover:bg-teal-500">結合実行</button>
          </div>
        )
      })()}
      {mode === 'rename' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-muted)] shrink-0">ルート名:</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
              className="flex-1 px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
            />
            <button onClick={handleRename} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 shrink-0">変更</button>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[var(--color-muted)] shrink-0 mt-1">トラック名:</span>
            <textarea
              value={trackNamesText}
              onChange={(e) => setTrackNamesText(e.target.value)}
              rows={Math.max(2, route?.tracks.length ?? 2)}
              placeholder="<name>名前<number>番号（1行1トラック、ブランク可）"
              className="flex-1 px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] font-mono text-[10px]"
            />
          </div>
        </div>
      )}
      {mode === 'partialEdit' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">部分編集:</span>
          {partialEdit ? (
            <>
              <span>編集中: {partialEdit.points.length} ポイント（ドラッグで移動・クリックで削除・青ライン上クリックで挿入）</span>
              <button onClick={handlePartialEditConfirm} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500">確定</button>
              <button onClick={() => clearPartialEdit()} className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80">キャンセル</button>
            </>
          ) : (
            <span>ルート上をクリックして編集範囲を選択（前後300点・最大601点）</span>
          )}
        </div>
      )}
      {mode === 'export' && route && (
        <>
          <button
            onClick={() => setShowExport(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-500"
          >
            エクスポートダイアログを開く
          </button>
          {showExport && <ExportDialog route={route} onClose={() => { setShowExport(false); setMode('none') }} />}
        </>
      )}
    </div>
  )
}
