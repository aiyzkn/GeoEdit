import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useEditorStore } from '@/stores/editorStore'
import { nearestSegmentInsertIndex, interpolatePointTime } from '@/lib/editors/routeEditors'
import { fetchElevations } from '@/lib/elevationApi'
import type { TrackPoint } from '@/types/route'

interface Props {
  map: L.Map
}

export default function PartialEditLayer({ map }: Props) {
  const { partialEdit, movePartialEditPoint, removePartialEditPointAt, insertPartialEditPointAt, setPartialEditPointEle } = useEditorStore()
  const layers = useRef<L.Layer[]>([])

  useEffect(() => {
    layers.current.forEach((l) => map.removeLayer(l))
    layers.current = []

    if (!partialEdit) return
    const { points } = partialEdit

    if (points.length >= 2) {
      const line = L.polyline(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#2563eb', weight: 4, opacity: 0.9 }
      )
      // 青ライン上をクリック → その位置にマーカーを挿入（要件定義書6.2）
      line.on('click', async (e: L.LeafletMouseEvent) => {
        const current = useEditorStore.getState().partialEdit
        if (!current) return
        const insertIdx = nearestSegmentInsertIndex(current.points, e.latlng.lat, e.latlng.lng)
        const prev = current.points[insertIdx - 1]
        const next = current.points[insertIdx]
        const newPoint: TrackPoint = { lat: e.latlng.lat, lng: e.latlng.lng }
        if (prev && next) {
          newPoint.time = interpolatePointTime(prev, next, newPoint)
        }
        insertPartialEditPointAt(insertIdx, newPoint)
        // 追加マーカーの標高は国土地理院APIから取得（要件定義書6.2）
        const [ele] = await fetchElevations([{ lat: newPoint.lat, lng: newPoint.lng }])
        if (ele != null) {
          const p = useEditorStore.getState().partialEdit?.points[insertIdx]
          if (p && p.lat === newPoint.lat && p.lng === newPoint.lng) setPartialEditPointEle(insertIdx, ele)
        }
      })
      line.addTo(map)
      layers.current.push(line)
    }

    points.forEach((p, i) => {
      const isEndpoint = i === 0 || i === points.length - 1
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${isEndpoint ? 12 : 10}px;height:${isEndpoint ? 12 : 10}px;border-radius:50%;background:${isEndpoint ? '#1e3a8a' : '#2563eb'};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.5)"></div>`,
        iconSize: [isEndpoint ? 12 : 10, isEndpoint ? 12 : 10],
        iconAnchor: [isEndpoint ? 6 : 5, isEndpoint ? 6 : 5],
      })
      const marker = L.marker([p.lat, p.lng], { icon, draggable: true })
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng()
        movePartialEditPoint(i, lat, lng)
      })
      if (!isEndpoint) {
        // クリック → マーカーを削除（始点・終点は削除不可、要件定義書6.2）
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          removePartialEditPointAt(i)
        })
      }
      marker.addTo(map)
      layers.current.push(marker)
    })

    return () => {
      layers.current.forEach((l) => map.removeLayer(l))
      layers.current = []
    }
  }, [partialEdit, map, movePartialEditPoint, removePartialEditPointAt, insertPartialEditPointAt, setPartialEditPointEle])

  return null
}
