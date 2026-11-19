import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { RouteData } from '@/types/route'
import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore } from '@/stores/editorStore'
import { nearestPointIndex } from '@/lib/geometry'
import { extractPartialEditRange } from '@/lib/editors/routeEditors'

interface Props {
  route: RouteData
  map: L.Map
  color: string
}

export default function RoutePolyline({ route, map, color }: Props) {
  const polylines = useRef<L.Polyline[]>([])
  const markers = useRef<L.Layer[]>([])
  const waypointMarkers = useRef<L.CircleMarker[]>([])
  const rangeMarkers = useRef<L.CircleMarker[]>([])
  const wptEditMarkers = useRef<L.CircleMarker[]>([])
  const startEndMarkers = useRef<L.CircleMarker[]>([])
  const { selectedRouteId, selectedPointIndex, hoveredPointIndex, selectRoute } = useRouteStore()
  const { pushUndo, mode, selection, toggleDeleteRangeMarker, toggleMergeTarget } = useEditorStore()
  const isSelected = selectedRouteId === route.id

  useEffect(() => {
    // Clear previous layers
    polylines.current.forEach((p) => map.removeLayer(p))
    waypointMarkers.current.forEach((m) => map.removeLayer(m))
    startEndMarkers.current.forEach((m) => map.removeLayer(m))
    polylines.current = []
    waypointMarkers.current = []
    startEndMarkers.current = []

    if (route.kind === 'waypoint') {
      // ウェイポイント（<wpt>）は順序を持たない単独ポイント群なので、
      // 接続線ではなく個別マーカーとして表示する（selectedPointIndex ハイライト用の
      // `markers` refとは別の `waypointMarkers` refで管理し、相互に消し合わないようにする）。
      route.standaloneWaypoints.forEach((wpt) => {
        const m = L.circleMarker([wpt.lat, wpt.lng], {
          radius: isSelected ? 7 : 6,
          color: '#fff',
          weight: 2,
          fillColor: color,
          fillOpacity: isSelected ? 1 : 0.85,
        })
        if (wpt.name) m.bindTooltip(wpt.name, { direction: 'top' })
        m.on('click', () => selectRoute(route.id))
        m.addTo(map)
        waypointMarkers.current.push(m)
      })
      return
    }

    route.tracks.forEach((track, trackIndex) => {
      const latlngs = track.points.map((p) => L.latLng(p.lat, p.lng))
      if (latlngs.length < 2) return

      const pl = L.polyline(latlngs, {
        color,
        weight: isSelected ? 4 : 3,
        opacity: isSelected ? 1 : 0.7,
        // route（<rte>、計画path）は track（<trk>、記録済み経路）と視覚的に区別するため破線にする
        dashArray: route.kind === 'route' ? '8 6' : undefined,
        interactive: true,
      })

      pl.on('click', (e: L.LeafletMouseEvent) => {
        // selectRoute/selectTrack は選択状態をリセットするため、再クリック判定に必要な
        // 直前の選択状態はハンドラ冒頭（リセット前）に捕捉しておく
        const prev = useRouteStore.getState()
        const currentMode = useEditorStore.getState().mode
        const nearest = nearestPointIndex(e.latlng.lat, e.latlng.lng, track.points)

        // split モードで同一ルート・トラックの同じ分割点を再クリック → マーカー解除（要件定義書6.3）
        if (
          currentMode === 'split' && nearest &&
          prev.selectedRouteId === route.id && prev.selectedTrackIndex === trackIndex &&
          prev.selectedPointIndex === nearest.index
        ) {
          prev.selectPoint(null)
          return
        }

        selectRoute(route.id)
        const { selectTrack, selectPoint } = useRouteStore.getState()
        selectTrack(trackIndex)
        if (nearest) {
          selectPoint(nearest.index)
          if (currentMode === 'deleteRange' || (currentMode === 'reroute' && useEditorStore.getState().draftTarget.kind !== 'replace')) {
            toggleDeleteRangeMarker(route.id, trackIndex, nearest.index)
          } else if (currentMode === 'merge') {
            toggleMergeTarget(route.id)
          } else if (currentMode === 'waypoint') {
            // ルート上のクリック → 最近傍ポイントにウェイポイントを追加（即時反映、要件定義書6.9）
            const pt = track.points[nearest.index]
            if (!pt.waypoint) {
              const snapshot = useRouteStore.getState().routes
              pushUndo('ウェイポイント追加', snapshot)
              useRouteStore.getState().updateRoute(route.id, (r) => {
                r.tracks[trackIndex].points[nearest.index].waypoint = {}
              })
            }
          } else if (currentMode === 'partialEdit') {
            // ルート上のクリック → 前後300点（最大601点）を編集範囲として抽出（要件定義書6.2）
            const { startIndex, points } = extractPartialEditRange(track.points, nearest.index)
            useEditorStore.getState().startPartialEdit({
              routeId: route.id,
              trackIndex,
              startIndex,
              originalLength: points.length,
              points,
            })
          }
        }
      })

      pl.addTo(map)
      polylines.current.push(pl)

      // 開始点（マゼンタ）・終了点（シアン）マーカー（要件定義書4.4）
      const startPt = track.points[0]
      const endPt = track.points[track.points.length - 1]
      const startMarker = L.circleMarker([startPt.lat, startPt.lng], {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: '#d946ef',
        fillOpacity: 1,
      })
      startMarker.bindTooltip('開始点', { direction: 'top' })
      startMarker.addTo(map)
      const endMarker = L.circleMarker([endPt.lat, endPt.lng], {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: '#06b6d4',
        fillOpacity: 1,
      })
      endMarker.bindTooltip('終了点', { direction: 'top' })
      endMarker.addTo(map)
      startEndMarkers.current.push(startMarker, endMarker)
    })

    return () => {
      polylines.current.forEach((p) => map.removeLayer(p))
      waypointMarkers.current.forEach((m) => map.removeLayer(m))
      startEndMarkers.current.forEach((m) => map.removeLayer(m))
    }
  }, [route, map, color, isSelected, selectRoute, toggleDeleteRangeMarker, toggleMergeTarget, pushUndo])

  // Highlight selected point — draggable so its lat/lng can be corrected directly on the map
  useEffect(() => {
    markers.current.forEach((m) => map.removeLayer(m))
    markers.current = []

    if (!isSelected || selectedPointIndex == null) return

    const trackIndex = useRouteStore.getState().selectedTrackIndex
    const track = route.tracks[trackIndex]
    if (!track) return
    const pt = track.points[selectedPointIndex]
    if (!pt) return

    map.panTo([pt.lat, pt.lng])

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.5)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
    // ドラッグによる座標修正は選択（none）・詳細（pointInfo）モードのみ許可する。
    // 分割・区間削除等の他モード中は、選択マーカーの誤ドラッグで「ポイント位置変更」が
    // 意図せず確定してしまうのを防ぐ（要件定義書6.3 まわりの副作用対策）。
    const draggable = mode === 'none' || mode === 'pointInfo'
    const m = L.marker([pt.lat, pt.lng], { icon, draggable })
    // 分割モードでは選択マーカー（＝分割マーカー）がポイント上に重なりポリラインのクリックを遮るため、
    // マーカー自身のクリックで選択解除できるようにする（要件定義書6.3「再クリックでキャンセル」）。
    if (mode === 'split') {
      m.on('click', () => useRouteStore.getState().selectPoint(null))
    }
    if (draggable) {
      m.on('dragend', () => {
        const { lat, lng } = m.getLatLng()
        const snapshot = useRouteStore.getState().routes
        pushUndo('ポイント位置変更', snapshot)
        useRouteStore.getState().updateRoute(route.id, (r) => {
          const p = r.tracks[trackIndex]?.points[selectedPointIndex]
          if (p) { p.lat = lat; p.lng = lng }
        })
      })
    }
    m.addTo(map)
    markers.current.push(m)
  }, [selectedPointIndex, isSelected, route, color, map, pushUndo, mode])

  // Highlight deleteRange start/end markers
  useEffect(() => {
    rangeMarkers.current.forEach((m) => map.removeLayer(m))
    rangeMarkers.current = []

    if ((mode !== 'deleteRange' && mode !== 'reroute') || !selection || selection.routeId !== route.id) return
    const track = route.tracks[selection.trackIndex]
    if (!track) return

    const indices = selection.startIndex === selection.endIndex
      ? [selection.startIndex]
      : [selection.startIndex, selection.endIndex]

    indices.forEach((idx) => {
      const pt = track.points[idx]
      if (!pt) return
      const m = L.circleMarker([pt.lat, pt.lng], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#dc2626',
        fillOpacity: 1,
      })
      m.addTo(map)
      rangeMarkers.current.push(m)
    })

    return () => {
      rangeMarkers.current.forEach((m) => map.removeLayer(m))
    }
  }, [mode, selection, route, map])

  // Waypoint 編集モード: ウェイポイント付きポイントを表示（クリックで選択・右クリックで削除）
  useEffect(() => {
    wptEditMarkers.current.forEach((m) => map.removeLayer(m))
    wptEditMarkers.current = []

    if (mode !== 'waypoint' || !isSelected) return
    const trackIndex = useRouteStore.getState().selectedTrackIndex
    const track = route.tracks[trackIndex]
    if (!track) return

    track.points.forEach((pt, idx) => {
      if (!pt.waypoint) return
      const m = L.circleMarker([pt.lat, pt.lng], {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 1,
      })
      if (pt.waypoint.name) m.bindTooltip(pt.waypoint.name, { direction: 'top' })
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        useRouteStore.getState().selectPoint(idx)
      })
      m.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e)
        e.originalEvent.preventDefault()
        const snapshot = useRouteStore.getState().routes
        pushUndo('ウェイポイント削除', snapshot)
        useRouteStore.getState().updateRoute(route.id, (r) => {
          delete r.tracks[trackIndex].points[idx].waypoint
        })
      })
      m.addTo(map)
      wptEditMarkers.current.push(m)
    })

    return () => {
      wptEditMarkers.current.forEach((m) => map.removeLayer(m))
    }
  }, [mode, route, map, isSelected, pushUndo])

  // Highlight hovered point
  useEffect(() => {
    if (!isSelected || hoveredPointIndex == null) return
    const track = route.tracks[useRouteStore.getState().selectedTrackIndex]
    if (!track) return
    const pt = track.points[hoveredPointIndex]
    if (!pt) return

    const m = L.circleMarker([pt.lat, pt.lng], {
      radius: 5,
      color: '#fff',
      weight: 1.5,
      fillColor: '#f59e0b',
      fillOpacity: 1,
    })
    m.addTo(map)
    markers.current.push(m)

    return () => {
      map.removeLayer(m)
      markers.current = markers.current.filter((x) => x !== m)
    }
  }, [hoveredPointIndex, isSelected])

  return null
}
