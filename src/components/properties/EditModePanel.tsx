import { useState, useEffect, useRef } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useShallow } from 'zustand/react/shallow'
import { useRouteStore } from '@/stores/routeStore'
import { useUiStore } from '@/stores/uiStore'
import {
  splitTrack, deleteRange, reverseTrack, thinOutByDistance, simplifyByTolerance, estimateDurationMs,
  redistributeTime, redistributeTimeWithRange, shiftTime, isRouteNameTaken,
  trackToNameLine, parseTrackNameLine,
  mergeRoutesUnified, mergeRoutesChronological, mergeRoutesSimple,
} from '@/lib/editors/routeEditors'
import { fetchElevations } from '@/lib/elevationApi'
import { useElevReplace } from '@/hooks/useElevReplace'
import RoutingSettingsDialog from '@/components/properties/RoutingSettingsDialog'
import { draftPointsSimplified, draftDistance, DRAFT_SIMPLIFY_M } from '@/lib/editors/draft'
import { computeGainLoss } from '@/lib/routeStats'
import { useDraftProfileSync } from '@/hooks/useDraftProfile'
import SpeedSelect from '@/components/properties/SpeedSelect'
import { cancelMatch, removeLastAnchor, rerouteAll, startAppend, startMatch, startNew, startReplace } from '@/lib/draftController'
import { applyDraft, countWaypointsInRange } from '@/lib/editors/draftApply'
import { Settings2 } from 'lucide-react'
import type { RouteData, TrackPoint } from '@/types/route'
import type { EditMode } from '@/types/editor'

/** <input type="datetime-local"> 用に、ローカルタイムゾーンでの日時文字列を組み立てる（toISOString はUTC基準のためズレる） */
function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EditModePanel() {
  const { mode, setMode, selection, setSelection, pushUndo, draft, clearDraft, routingSettings, setRoutingSettings, routingProgress, setBusy, mergeTargetIds, partialEdit, clearPartialEdit, mapMatchEnabled, setMapMatchEnabled, speedProfile, setSpeedProfile, createAutoElevation: autoElevation, setCreateAutoElevation: setAutoElevation, createSimplify, setCreateSimplify, draftProfile, draftTarget } = useEditorStore()
  useDraftProfileSync()
  const { routes, selectedRouteId, selectedTrackIndex, selectedPointIndex, updateRoute, addRoute, removeRoute } = useRouteStore(useShallow((s) => ({ routes: s.routes, selectedRouteId: s.selectedRouteId, selectedTrackIndex: s.selectedTrackIndex, selectedPointIndex: s.selectedPointIndex, updateRoute: s.updateRoute, addRoute: s.addRoute, removeRoute: s.removeRoute })))
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
  const [createRouteName, setCreateRouteName] = useState('')
  const [createTrackName, setCreateTrackName] = useState('')
  // ページロード時点の日時を既定値にする（リアルタイム更新はしない。EditModePanel はアプリ全体で1度だけマウントされるため useState の初期化関数のみで足りる）
  const [createStartStr, setCreateStartStr] = useState(() => toLocalDatetimeInputValue(new Date()))
  const [createEndStr, setCreateEndStr] = useState('')
  const [thinMethod, setThinMethod] = useState<'distance' | 'shape'>('distance')
  const [thinToleranceM, setThinToleranceM] = useState(2)
  const [creating, setCreating] = useState(false)
  const [mergeMethod, setMergeMethod] = useState<'unified' | 'chronological' | 'simple'>('unified')
  const [splitName1, setSplitName1] = useState('')
  const [splitName2, setSplitName2] = useState('')
  const [useFallbackEle, setUseFallbackEle] = useState(true)
  const [replacing, setReplacing] = useState(false)
  const [matching, setMatching] = useState(false)
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

  // 作成中の 1 行の要約（B5）: 登り・下り・見込みの所要時間と到着時刻
  const draftSummary = (() => {
    if ((mode !== 'create' && mode !== 'reroute') || !draftProfile || draftProfile.points.length < 2) return ''
    const parts: string[] = []
    const hasEle = autoElevation && draftProfile.points.some((p) => p.ele != null)
    if (hasEle) {
      const { gainM, lossM } = computeGainLoss(draftProfile.points)
      parts.push(`登り ${Math.round(gainM)} m / 下り ${Math.round(lossM)} m${draftProfile.complete ? '' : '（取得中）'}`)
    }
    const ms = estimateDurationMs(draftProfile.points, speedProfile)
    const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000)
    let s = `見込み ${h > 0 ? `${h} 時間 ` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')} 分`
    const start = createStartStr ? new Date(createStartStr) : null
    if (start && !isNaN(start.getTime()) && !createEndStr) {
      const arr = new Date(start.getTime() + ms)
      s += `（到着 ${String(arr.getHours()).padStart(2, '0')}:${String(arr.getMinutes()).padStart(2, '0')}）`
    }
    parts.push(s)
    return parts.join(' ・ ')
  })()

  // Enter で、いまのモードの主な確定（D4）。実際の処理は、早い return より後で決まるので ref で渡す
  const modeConfirmRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onConfirm = () => modeConfirmRef.current()
    document.addEventListener('mode-confirm', onConfirm)
    return () => document.removeEventListener('mode-confirm', onConfirm)
  }, [])

  // 「確定して移動」（C3）: ツールバー・Esc の確認ダイアログから来る。フックは早い return より前に置く
  const confirmRef = useRef<(then: EditMode) => Promise<boolean>>(async () => false)
  useEffect(() => {
    const onCommit = (e: Event) => {
      const then = (e as CustomEvent<{ then: EditMode }>).detail?.then ?? 'none'
      void confirmRef.current(then)
    }
    document.addEventListener('draft-commit', onCommit)
    return () => document.removeEventListener('draft-commit', onCommit)
  }, [])

  if (mode === 'none') return null
  if (mode !== 'create' && mode !== 'reroute' && !route) return null

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
    pushUndo('部分削除', snapshot())
    const pts = deleteRange(track.points, start, end)
    updateRoute(route.id, (r) => { r.tracks[selectedTrackIndex].points = pts })
    addToast('success', `部分削除: ${Math.abs(end - start) + 1} ポイント削除`)
    setSelection(null)
    setMode('none')
  }

  const handleReverse = () => {
    if (!track) return
    pushUndo('逆ルート', snapshot())
    const pts = reverseTrack(track.points)
    updateRoute(route.id, (r) => { r.tracks[selectedTrackIndex].points = pts })
    addToast('success', '逆ルートにしました')
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
    const pts = thinMethod === 'shape' ? simplifyByTolerance(track.points, thinToleranceM) : thinOutByDistance(track.points, thinDistM)
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
      pushUndo('時間変更', snapshot())
      pts = redistributeTimeWithRange(track.points, start, end, speedProfile)
    } else {
      pushUndo('時間変更', snapshot())
      pts = redistributeTime(track.points, start, speedProfile)
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
    pushUndo('時間変更（シフト）', snapshot())
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

  /** 下書きを確定する。then = 確定のあとに移るモード。確定できたら true */
  const handleCreateConfirm = async (then: EditMode = 'none'): Promise<boolean> => {
    const target = useEditorStore.getState().draftTarget
    if (draft.anchors.length < 2) {
      addToast('info', '地図をクリックして2点以上追加してください')
      return false
    }
    if (draft.legs.some((l) => l.status === 'pending')) {
      addToast('info', '経路の探索が終わってから確定してください')
      return false
    }
    let newRoute: { id: string; name: string; trackName?: string; startTime?: Date; endTime?: Date } | undefined
    if (target.kind === 'new') {
      const name = createRouteName.trim() || `新規ルート ${routes.length + 1}`
      if (isRouteNameTaken(routes, name)) {
        addToast('error', `同名のルートが既に存在します: ${name}`)
        return false
      }
      let startTime: Date | undefined
      let endTime: Date | undefined
      if (createStartStr) {
        startTime = new Date(createStartStr)
        if (isNaN(startTime.getTime())) { addToast('error', '開始日時の形式が正しくありません'); return false }
      }
      if (createEndStr) {
        if (!startTime) { addToast('error', '終了日時を指定する場合は開始日時も指定してください'); return false }
        endTime = new Date(createEndStr)
        if (isNaN(endTime.getTime())) { addToast('error', '終了日時の形式が正しくありません'); return false }
        if (startTime.toDateString() !== endTime.toDateString()) {
          addToast('error', '開始・終了は同じ日付にしてください（日付をまたぐ設定は不可）')
          return false
        }
        if (endTime.getTime() <= startTime.getTime()) { addToast('error', '終了日時は開始日時より後にしてください'); return false }
      }
      newRoute = { id: crypto.randomUUID(), name, trackName: createTrackName.trim() || undefined, startTime, endTime }
    }
    if (target.kind === 'replace' && !target.match) {
      // 区間の中のウェイポイントは消える（B1）。道に合わせた下書きは、最寄りの点へ移すので消えない（§8.2）
      const tp = routes.find((r) => r.id === target.routeId)?.tracks[target.trackIndex]?.points ?? []
      const n = countWaypointsInRange(tp, target.startIndex, target.endIndex)
      if (n > 0) {
        const ok = await useUiStore.getState().confirm({
          title: 'ウェイポイントが消えます',
          message: `引き直す区間の中にあるウェイポイント ${n} 個が消えます。`,
          actions: [{ id: 'cancel', label: 'やめる' }, { id: 'ok', label: '引き直す', kind: 'danger' }],
        })
        if (ok !== 'ok') return false
      }
    }

    const pts = draftPointsSimplified(draft, createSimplify)
    setCreating(true)
    setBusy(true)
    let elevs: (number | null)[] = []
    if (autoElevation) {
      // 作成中に取った標高がそろっていれば、それを使う（取り直さない。B5）
      const prof = useEditorStore.getState().draftProfile
      if (prof?.complete && prof.points.length === pts.length) {
        elevs = prof.points.map((p) => p.ele ?? null)
      } else {
        addToast('info', `標高取得中: ${pts.length} ポイント`)
        elevs = await fetchElevations(pts)
      }
    }
    const points: TrackPoint[] = pts.map((p, i) => (elevs[i] != null ? { lat: p.lat, lng: p.lng, ele: elevs[i]! } : { lat: p.lat, lng: p.lng }))
    const result = applyDraft(routes, { target, points, newRoute, speed: speedProfile })
    setBusy(false)
    setCreating(false)
    if (!result.ok) {
      addToast('error', result.error === 'target-missing' ? '対象のルートが見つかりません' : '点が足りません')
      return false
    }
    pushUndo(result.undoLabel, routes)
    if (target.kind === 'new') {
      addRoute(result.routes[result.routes.length - 1])
      addToast('success', `ルートを作成しました（${result.addedPoints} ポイント）`)
    } else {
      useRouteStore.getState().setRoutes(result.routes)
      addToast('success', target.kind === 'append' ? `ルートに追記しました（${result.addedPoints} ポイント）`
        : target.kind === 'replace' && target.match ? `道に合わせて確定しました（${result.addedPoints} ポイント。時刻・標高・ウェイポイントは元の点から移しました）`
          : `道なりに引き直しました（${result.addedPoints} ポイント）`)
    }
    clearDraft()
    setMode(then)
    return true
  }

  confirmRef.current = handleCreateConfirm

  /** 軌跡を道に合わせ、道なり補正の下書きにする（確定・キャンセルは道なり補正と同じ） */
  const handleMatch = async (routeId: string, trackIndex: number, startIndex: number, endIndex: number) => {
    setMatching(true)
    const r = await startMatch(routeId, trackIndex, startIndex, endIndex)
    setMatching(false)
    if (r.ok) {
      const kept = r.keptPoints > 0 ? `。道が見つからない ${r.keptSections} か所（${r.keptPoints} 点）は元の点を残しました` : ''
      addToast('success', `道に合わせました（観測 ${r.observed} 点のうち ${r.matched} 点${kept}）。確定するまで元のトラックは変わりません`)
      return
    }
    if (r.error === 'aborted') return
    addToast(r.error === 'bad-range' ? 'info' : 'error',
      r.error === 'bad-range' ? '始点と終点に、違う点を選んでください'
        : r.error === 'no-road' ? '近くに道が見つかりませんでした'
          : '道に合わせられませんでした（道路データを取得できない、または軌跡が長すぎます）')
  }

  modeConfirmRef.current = () => {
    // 処理の最中は何もしない（二重の確定を防ぐ）
    if (useEditorStore.getState().isBusy || creating || replacing) return
    switch (mode) {
      case 'create':
        void handleCreateConfirm()
        break
      case 'reroute':
        if (draftTarget.kind === 'replace') void handleCreateConfirm()
        else if (selection && selection.startIndex !== selection.endIndex) {
          if (!startReplace(selection.routeId, selection.trackIndex, selection.startIndex, selection.endIndex)) addToast('info', '始点と終点に、違う点を選んでください')
        }
        break
      case 'split': handleSplit(); break
      case 'deleteRange':
        if (selection && selection.startIndex !== selection.endIndex) handleDeleteRange('range')
        break
      case 'merge': handleMerge(); break
      case 'partialEdit': if (partialEdit) handlePartialEditConfirm(); break
      case 'thinOut': handleThinOut(); break
      case 'timeEdit': if (timeEditSubMode === 'recalc') handleTimeEdit(); else handleTimeShift(); break
      case 'reverse': handleReverse(); break
      case 'elevReplace': void handleElevReplace(); break
      case 'rename': handleRename(); break
      default: break
    }
  }

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs space-y-2">
      {mode === 'reroute' && draftTarget.kind !== 'replace' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">道なり補正:</span>
          <span>選択中のトラックで、引き直す区間の始点と終点をクリック（地図またはタイムライン）</span>
          {route && selection && selection.routeId === route.id && (
            <span>#{Math.min(selection.startIndex, selection.endIndex)} 〜 #{Math.max(selection.startIndex, selection.endIndex)}</span>
          )}
          <button
            onClick={() => {
              if (!selection) return
              if (!startReplace(selection.routeId, selection.trackIndex, selection.startIndex, selection.endIndex)) {
                addToast('info', '始点と終点に、違う点を選んでください')
              }
            }}
            disabled={!selection || selection.startIndex === selection.endIndex}
            className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40"
          >
            引き直す
          </button>
          <button
            onClick={() => { if (selection) void handleMatch(selection.routeId, selection.trackIndex, selection.startIndex, selection.endIndex) }}
            disabled={matching || !selection || selection.startIndex === selection.endIndex}
            className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40"
            title="選んだ区間の軌跡（GPS のログなど）を、通った道に合わせる。道が見つからない所は元の点を残す"
          >
            道に合わせる
          </button>
          <button
            onClick={() => { if (route && track) void handleMatch(route.id, selectedTrackIndex, 0, track.points.length - 1) }}
            disabled={matching || !track || track.points.length < 2}
            className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80 disabled:opacity-40"
            title="選択中のトラック全体の軌跡を、通った道に合わせる"
          >
            トラック全体を道に合わせる
          </button>
          {matching && (
            <>
              <span className="text-[var(--color-muted)]">
                道に合わせています{routingProgress ? ` ${routingProgress.done}/${routingProgress.total}` : ''}
              </span>
              <button onClick={cancelMatch} className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80">中止</button>
            </>
          )}
        </div>
      )}
      {(mode === 'create' || (mode === 'reroute' && draftTarget.kind === 'replace')) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">{draftTarget.kind === 'replace' ? '道なり補正:' : draftTarget.kind === 'append' ? 'ルートに追記:' : '新規ルート作成:'}</span>
          {mode === 'create' && (
            <select
              aria-label="作成先"
              value={draftTarget.kind === 'append' ? `append-${draftTarget.end}` : 'new'}
              disabled={draft.anchors.some((a) => !a.locked)}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'new') startNew()
                else if (route) startAppend(route.id, selectedTrackIndex, v === 'append-head' ? 'head' : 'tail')
              }}
              title="通過点を置いたあとは変えられません（変えるには、いったん全部消す）"
              className="px-1 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] max-w-56"
            >
              <option value="new">新規ルート</option>
              {route && track && track.points.length > 0 && (
                <>
                  <option value="append-tail">「{route.name}」の末尾に追記</option>
                  <option value="append-head">「{route.name}」の先頭に追記</option>
                </>
              )}
            </select>
          )}
          <span>{draftTarget.kind === 'replace' ? `通過点 ${draft.anchors.length} 点（線の上をドラッグして足す）` : <>地図をクリックしてポイントを追加（{draft.anchors.length} 点）</>}</span>
          {draft.legs.length > 0 && <span className="text-[var(--color-muted)]">{(draftDistance(draft) / 1000).toFixed(2)} km</span>}
          {draftSummary && <span className="text-[var(--color-muted)]" data-testid="draft-summary">{draftSummary}</span>}
          {draftTarget.kind === 'new' && (
            <>
          <input
            type="text"
            placeholder="ルート名"
            aria-label="ルート名"
            value={createRouteName}
            onChange={(e) => setCreateRouteName(e.target.value)}
            className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-32"
          />
          <input
            type="text"
            placeholder="トラック名"
            aria-label="トラック名"
            value={createTrackName}
            onChange={(e) => setCreateTrackName(e.target.value)}
            className="px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] w-32"
          />
          <input
            type="datetime-local"
            value={createStartStr}
            onChange={(e) => setCreateStartStr(e.target.value)}
            title="開始日時（任意）"
            aria-label="開始日時（任意）"
            className="px-1 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
          />
          <input
            type="datetime-local"
            value={createEndStr}
            onChange={(e) => setCreateEndStr(e.target.value)}
            title="終了日時（任意・同一日付内のみ）"
            aria-label="終了日時（任意・同一日付内のみ）"
            className="px-1 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
          />
            </>
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={autoElevation} onChange={(e) => setAutoElevation(e.target.checked)} />
            標高を自動取得
          </label>
          <label className="flex items-center gap-1" title={`経路探索で結んだ区間の点を、線の形を保って間引きます（元の線からのずれ ${DRAFT_SIMPLIFY_M} m まで）`}>
            <input type="checkbox" checked={createSimplify} onChange={(e) => setCreateSimplify(e.target.checked)} />
            点を間引く（形を保つ）
          </label>
          <SpeedSelect value={speedProfile} onChange={setSpeedProfile} />
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
          {draftTarget.kind === 'replace' && (
            <button onClick={() => { clearDraft() }} className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80">
              キャンセル
            </button>
          )}
          <button
            onClick={removeLastAnchor}
            hidden={draftTarget.kind === 'replace'}
            disabled={!draft.anchors.some((a) => !a.locked)}
            className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80 disabled:opacity-40"
          >
            1点削除
          </button>
          <button
            onClick={() => { void handleCreateConfirm() }}
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
          <span className="text-[var(--color-muted)]">部分削除:</span>
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
          <span className="text-[var(--color-muted)]">逆ルート:</span>
          <button onClick={handleReverse} className="px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-500">逆ルートにする</button>
        </div>
      )}
      {mode === 'pointInfo' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--color-muted)]">ポイント情報:</span>
          {track && selectedPointIndex != null ? (
            <span>選択中のポイント #{selectedPointIndex} の情報を右サイドバーの「属性」タブに表示しています（緯度経度・標高・時刻は編集可能）</span>
          ) : (
            <span>地図またはタイムラインでポイントをクリックすると、右サイドバーの「属性」タブにポイント情報が表示されます</span>
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
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1">
            <input type="radio" name="thin-method" checked={thinMethod === 'distance'} onChange={() => setThinMethod('distance')} />
            道のりの間隔
          </label>
          {thinMethod === 'distance' && (
            <>
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
            </>
          )}
          <label className="flex items-center gap-1" title="カーブの頂点を残し、元の線からのずれが許容以内になるように間引きます">
            <input type="radio" name="thin-method" checked={thinMethod === 'shape'} onChange={() => setThinMethod('shape')} />
            形を保つ
          </label>
          {thinMethod === 'shape' && (
            <>
              <span className="text-[var(--color-muted)]">許容:</span>
              <input
                type="number"
                aria-label="許容（m）"
                min={0.5}
                max={100}
                step={0.5}
                value={thinToleranceM}
                onChange={(e) => setThinToleranceM(Number(e.target.value))}
                className="w-16 px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)]"
              />
              <span>m</span>
            </>
          )}
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
              <SpeedSelect value={speedProfile} onChange={setSpeedProfile} />
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
    </div>
  )
}
