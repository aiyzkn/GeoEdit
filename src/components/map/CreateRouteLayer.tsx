import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useEditorStore } from '@/stores/editorStore'
import { beginAnchorDrag, dragAnchorTo, endAnchorDrag, insertAnchorOnLeg, removeAnchorById } from '@/lib/draftController'
import type { CreateAnchor, CreateLeg } from '@/types/editor'

interface Props {
  map: L.Map
}

const COLOR = '#2563eb'
const LOCKED_COLOR = '#1e3a8a'
/** 通過点のマーカーからこの距離（px）以内では、つまみを出さない（通過点をつかみにくくなるため） */
const HANDLE_ANCHOR_GAP_PX = 12
/** タッチ端末で長押しして出したつまみを、さわらなければ隠すまでの時間 */
const HANDLE_TOUCH_TIMEOUT_MS = 3000

/** 区間の状態ごとの線の見た目（designs/経路探索詳細設計書.md §8.5） */
function legStyle(leg: CreateLeg): L.PolylineOptions {
  if (leg.mode === 'straight') return { color: COLOR, weight: 3, dashArray: '6 4', opacity: 1 }
  if (leg.status === 'pending') return { color: '#93c5fd', weight: 3, dashArray: '2 6', opacity: 1 }
  if (leg.status === 'fallback') return { color: '#f59e0b', weight: 3, dashArray: '6 4', opacity: 1 }
  return { color: COLOR, weight: 4, dashArray: undefined, opacity: 1 }
}

function anchorIcon(a: CreateAnchor, isLast: boolean): L.DivIcon {
  const size = isLast ? 14 : 10
  const bg = a.locked ? LOCKED_COLOR : COLOR
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.5)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const HANDLE_ICON = L.divIcon({
  className: 'create-leg-handle',
  html: `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid ${COLOR};box-shadow:0 0 3px rgba(0,0,0,0.4);cursor:grab"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

interface MarkerEntry { marker: L.Marker; isLast: boolean; index: number; locked: boolean }
interface LineEntry { line: L.Polyline; hit: L.Polyline }

/** 線（緯度経度の並び）の上で、画面の点 p にいちばん近い点 */
function closestOnLine(map: L.Map, latlngs: L.LatLng[], p: L.Point): L.LatLng | null {
  let best: { d: number; q: L.Point } | null = null
  const pts = latlngs.map((ll) => map.latLngToLayerPoint(ll))
  for (let i = 1; i < pts.length; i++) {
    const q = L.LineUtil.closestPointOnSegment(p, pts[i - 1], pts[i])
    const d = q.distanceTo(p)
    if (!best || d < best.d) best = { d, q }
  }
  return best ? map.layerPointToLatLng(best.q) : null
}

/**
 * 作成中の下書き（通過点と区間）を描く。
 * 毎回すべてを作り直すとドラッグが切れるので、id で対応づけて使い回す（§8.5）。
 * 区間の線の上にマウスを乗せると「つまみ」が出て、ドラッグすると通過点を差し込める。
 */
export default function CreateRouteLayer({ map }: Props) {
  const draft = useEditorStore((s) => s.draft)
  const markers = useRef(new Map<string, MarkerEntry>())
  const lines = useRef(new Map<string, LineEntry>())
  const draggingId = useRef<string | null>(null)

  // つまみ（1 つだけ作って使い回す）
  const handle = useRef<L.Marker | null>(null)
  const handleLegId = useRef<string | null>(null)
  /** つまみのドラッグで差し込んだ通過点の id。ドラッグが終わるまで、この通過点のマーカーは作らない */
  const handleAnchorId = useRef<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** つまみの上でボタンを押している間は隠さない（ドラッグが始まる前に、カーソルが小さなつまみの外へ出ることがあるため） */
  const pressed = useRef(false)

  useEffect(() => {
    const h = L.marker([0, 0], { icon: HANDLE_ICON, draggable: true, zIndexOffset: 1000, keyboard: false })
    handle.current = h
    const onUp = () => { pressed.current = false }
    document.addEventListener('pointerup', onUp)
    document.addEventListener('mouseup', onUp)
    const hide = () => {
      if (handleAnchorId.current || pressed.current) return
      if (map.hasLayer(h)) map.removeLayer(h)
      handleLegId.current = null
    }
    h.on('mousedown', () => { pressed.current = true })
    h.on('mouseover', () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null } })
    h.on('mouseout', () => { if (!handleAnchorId.current) hide() })
    // クリックしただけ（動かさない）なら何もしない。マーカーのクリックは地図へ伝わらない
    h.on('click', (e) => L.DomEvent.stopPropagation(e))
    h.on('dragstart', () => {
      const legId = handleLegId.current
      if (!legId) return
      const { lat, lng } = h.getLatLng()
      const id = insertAnchorOnLeg(legId, { lat, lng })
      handleAnchorId.current = id
      draggingId.current = id
    })
    h.on('drag', () => {
      const id = handleAnchorId.current
      if (!id) return
      const { lat, lng } = h.getLatLng()
      dragAnchorTo(id, { lat, lng })
    })
    h.on('dragend', () => {
      const id = handleAnchorId.current
      handleAnchorId.current = null
      draggingId.current = null
      const { lat, lng } = h.getLatLng()
      hide()
      if (id) void endAnchorDrag(map, id, { lat, lng })
    })
    return () => {
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('mouseup', onUp)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (map.hasLayer(h)) map.removeLayer(h)
      handle.current = null
    }
  }, [map])

  useEffect(() => {
    const showHandleAt = (legId: string, line: L.Polyline, containerPoint: L.Point, timeoutMs?: number) => {
      const h = handle.current
      if (!h || handleAnchorId.current || draggingId.current || pressed.current) return
      const layerPoint = map.containerPointToLayerPoint(containerPoint)
      const ll = closestOnLine(map, line.getLatLngs() as L.LatLng[], layerPoint)
      if (!ll) return
      const q = map.latLngToLayerPoint(ll)
      for (const e of markers.current.values()) {
        if (map.latLngToLayerPoint(e.marker.getLatLng()).distanceTo(q) <= HANDLE_ANCHOR_GAP_PX) {
          if (map.hasLayer(h)) map.removeLayer(h)
          return
        }
      }
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
      handleLegId.current = legId
      h.setLatLng(ll)
      if (!map.hasLayer(h)) h.addTo(map)
      if (timeoutMs) {
        hideTimer.current = setTimeout(() => {
          if (!handleAnchorId.current && !pressed.current && map.hasLayer(h)) map.removeLayer(h)
        }, timeoutMs)
      }
    }
    const scheduleHide = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => {
        const h = handle.current
        if (h && !handleAnchorId.current && !pressed.current && map.hasLayer(h)) map.removeLayer(h)
      }, 150)
    }

    // ── 区間の線 ──
    const legIds = new Set(draft.legs.map((l) => l.id))
    for (const [id, e] of lines.current) {
      if (!legIds.has(id)) {
        map.removeLayer(e.line)
        map.removeLayer(e.hit)
        lines.current.delete(id)
        if (handleLegId.current === id && !handleAnchorId.current && handle.current && map.hasLayer(handle.current)) {
          map.removeLayer(handle.current)
        }
      }
    }
    for (const leg of draft.legs) {
      const latlngs = leg.points.map((p) => [p.lat, p.lng] as [number, number])
      const existing = lines.current.get(leg.id)
      if (existing) {
        existing.line.setLatLngs(latlngs)
        existing.line.setStyle(legStyle(leg))
        existing.hit.setLatLngs(latlngs)
        continue
      }
      const line = L.polyline(latlngs, { ...legStyle(leg), interactive: false })
      // 当たり判定用の透明で太い線（イベントはこちらで受ける）。クリックは地図へ伝わり、通過点の追加になる
      const hit = L.polyline(latlngs, { color: '#000', opacity: 0, weight: 16, className: 'create-leg-hit' })
      const legId = leg.id
      hit.on('mousemove', (e: L.LeafletMouseEvent) => showHandleAt(legId, hit, e.containerPoint))
      hit.on('mouseout', scheduleHide)
      hit.on('contextmenu', (e: L.LeafletMouseEvent) => {
        L.DomEvent.preventDefault(e.originalEvent)
        showHandleAt(legId, hit, e.containerPoint, HANDLE_TOUCH_TIMEOUT_MS)
      })
      line.addTo(map)
      hit.addTo(map)
      lines.current.set(leg.id, { line, hit })
    }

    // ── 通過点のマーカー ──
    const anchorIds = new Set(draft.anchors.map((a) => a.id))
    for (const [id, entry] of markers.current) {
      if (!anchorIds.has(id)) { map.removeLayer(entry.marker); markers.current.delete(id) }
    }
    draft.anchors.forEach((a, i) => {
      const isLast = i === draft.anchors.length - 1
      const entry = markers.current.get(a.id)
      if (entry) {
        if (draggingId.current !== a.id) {
          const cur = entry.marker.getLatLng()
          if (cur.lat !== a.lat || cur.lng !== a.lng) entry.marker.setLatLng([a.lat, a.lng])
        }
        if (entry.isLast !== isLast || entry.locked !== !!a.locked) {
          entry.marker.setIcon(anchorIcon(a, isLast))
          entry.isLast = isLast
          entry.locked = !!a.locked
        }
        if (entry.index !== i) {
          entry.marker.setTooltipContent(`#${i}`)
          entry.index = i
        }
        return
      }
      if (handleAnchorId.current === a.id) return // つまみのドラッグ中は、つまみがこの通過点の代わり
      const marker = L.marker([a.lat, a.lng], { icon: anchorIcon(a, isLast), draggable: !a.locked })
      marker.bindTooltip(`#${i}`, { permanent: false, direction: 'top' })
      const id = a.id
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        removeAnchorById(id)
      })
      marker.on('dragstart', () => {
        draggingId.current = id
        beginAnchorDrag()
      })
      marker.on('drag', () => {
        const { lat, lng } = marker.getLatLng()
        dragAnchorTo(id, { lat, lng })
      })
      marker.on('dragend', () => {
        draggingId.current = null
        const { lat, lng } = marker.getLatLng()
        void endAnchorDrag(map, id, { lat, lng })
      })
      marker.addTo(map)
      markers.current.set(id, { marker, isLast, index: i, locked: !!a.locked })
    })
  }, [draft, map])

  // 標高グラフで、下書きの点にマウスを乗せているとき、その位置に印を出す（B5）
  const hoverIndex = useEditorStore((s) => s.draftHoverIndex)
  const hoverMarker = useRef<L.CircleMarker | null>(null)
  useEffect(() => {
    const prof = useEditorStore.getState().draftProfile
    const p = hoverIndex != null ? prof?.points[hoverIndex] : undefined
    if (!p) {
      if (hoverMarker.current) { map.removeLayer(hoverMarker.current); hoverMarker.current = null }
      return
    }
    if (!hoverMarker.current) {
      hoverMarker.current = L.circleMarker([p.lat, p.lng], { radius: 6, color: '#ef4444', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(map)
    } else {
      hoverMarker.current.setLatLng([p.lat, p.lng])
    }
  }, [hoverIndex, map])
  useEffect(() => () => { if (hoverMarker.current) { map.removeLayer(hoverMarker.current); hoverMarker.current = null } }, [map])

  // アンマウント時に全部外す
  useEffect(() => {
    const ms = markers.current
    const ls = lines.current
    return () => {
      for (const e of ms.values()) map.removeLayer(e.marker)
      for (const e of ls.values()) { map.removeLayer(e.line); map.removeLayer(e.hit) }
      ms.clear()
      ls.clear()
    }
  }, [map])

  return null
}
