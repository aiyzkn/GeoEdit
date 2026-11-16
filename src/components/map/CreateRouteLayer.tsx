import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useEditorStore } from '@/stores/editorStore'
import { beginAnchorDrag, dragAnchorTo, endAnchorDrag, removeAnchorById } from '@/lib/draftController'
import type { CreateAnchor, CreateLeg } from '@/types/editor'

interface Props {
  map: L.Map
}

const COLOR = '#2563eb'
const LOCKED_COLOR = '#1e3a8a'

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

interface MarkerEntry { marker: L.Marker; isLast: boolean; index: number; locked: boolean }

/**
 * 作成中の下書き（通過点と区間）を描く。
 * 毎回すべてを作り直すとドラッグが切れるので、id で対応づけて使い回す（§8.5）。
 */
export default function CreateRouteLayer({ map }: Props) {
  const draft = useEditorStore((s) => s.draft)
  const markers = useRef(new Map<string, MarkerEntry>())
  const lines = useRef(new Map<string, L.Polyline>())
  const draggingId = useRef<string | null>(null)

  useEffect(() => {
    // ── 区間の線 ──
    const legIds = new Set(draft.legs.map((l) => l.id))
    for (const [id, line] of lines.current) {
      if (!legIds.has(id)) { map.removeLayer(line); lines.current.delete(id) }
    }
    for (const leg of draft.legs) {
      const latlngs = leg.points.map((p) => [p.lat, p.lng] as [number, number])
      const existing = lines.current.get(leg.id)
      if (existing) {
        existing.setLatLngs(latlngs)
        existing.setStyle(legStyle(leg))
      } else {
        const line = L.polyline(latlngs, { ...legStyle(leg), interactive: false })
        line.addTo(map)
        lines.current.set(leg.id, line)
      }
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

  // アンマウント時に全部外す
  useEffect(() => {
    const ms = markers.current
    const ls = lines.current
    return () => {
      for (const e of ms.values()) map.removeLayer(e.marker)
      for (const l of ls.values()) map.removeLayer(l)
      ms.clear()
      ls.clear()
    }
  }, [map])

  return null
}
