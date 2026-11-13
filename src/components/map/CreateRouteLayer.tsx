import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useEditorStore } from '@/stores/editorStore'
import { useMapStore } from '@/stores/mapStore'
import { matchPoint, isMatchModifierPressed } from '@/lib/mapMatch'

interface Props {
  map: L.Map
}

export default function CreateRouteLayer({ map }: Props) {
  const { createPoints, removeCreatePointAt, moveCreatePointAt } = useEditorStore()
  const layers = useRef<L.Layer[]>([])

  useEffect(() => {
    layers.current.forEach((l) => map.removeLayer(l))
    layers.current = []

    if (createPoints.length >= 2) {
      const line = L.polyline(
        createPoints.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#2563eb', weight: 3, dashArray: '6 4' }
      )
      line.addTo(map)
      layers.current.push(line)
    }

    createPoints.forEach((p, i) => {
      const isLast = i === createPoints.length - 1
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${isLast ? 14 : 10}px;height:${isLast ? 14 : 10}px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.5)"></div>`,
        iconSize: [isLast ? 14 : 10, isLast ? 14 : 10],
        iconAnchor: [isLast ? 7 : 5, isLast ? 7 : 5],
      })
      const marker = L.marker([p.lat, p.lng], { icon, draggable: true })
      marker.bindTooltip(`#${i}`, { permanent: false, direction: 'top' })
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        removeCreatePointAt(i)
      })
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng()
        // まずドロップ位置を即時反映し、マッチング結果が出たら補正する
        // （タイル取得待ちでマーカーが元位置に戻って見えるのを防ぐ。設計書 §5.3）
        moveCreatePointAt(i, lat, lng)
        if (!useEditorStore.getState().mapMatchEnabled || isMatchModifierPressed()) return
        void matchPoint({
          map,
          latlng: L.latLng(lat, lng),
          baseLayerId: useMapStore.getState().baseLayerId,
        }).then((r) => {
          if (r.matched) moveCreatePointAt(i, r.lat, r.lng)
        })
      })
      marker.addTo(map)
      layers.current.push(marker)
    })

    return () => {
      layers.current.forEach((l) => map.removeLayer(l))
      layers.current = []
    }
  }, [createPoints, map, removeCreatePointAt, moveCreatePointAt])

  return null
}
