import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import { LocateFixed, Loader2 } from 'lucide-react'
import { useUiStore } from '@/stores/uiStore'

/**
 * 現在地へ移動（designs/機能追加・UI改善設計書.md E1）。
 * ズームのボタンの下に置く Leaflet のコントロール。押すたびに 1 回だけ位置を取り（追い続けない）、そこへ移動して
 * 丸いマーカーと精度の円を出す。位置はどこにも送らず、保存もしない（自動保存の対象にも入れない）。
 * 位置情報を使うため、public/_headers の Permissions-Policy は geolocation=(self)。
 */
export default function LocateControl({ map }: { map: L.Map }) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    const Control = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control')
        // ボタンのクリック・ダブルクリックを地図に伝えない（作成モードで点が増えないように）
        L.DomEvent.disableClickPropagation(div)
        return div
      },
    })
    const control = new Control({ position: 'topleft' })
    control.addTo(map)
    setContainer(control.getContainer() ?? null)
    const layer = L.layerGroup().addTo(map)
    layerRef.current = layer

    const onFound = (e: L.LocationEvent) => {
      setBusy(false)
      layer.clearLayers()
      L.circle(e.latlng, { radius: e.accuracy, color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.15, interactive: false }).addTo(layer)
      L.circleMarker(e.latlng, { radius: 7, color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(layer)
    }
    const onError = (e: L.ErrorEvent) => {
      setBusy(false)
      // GeolocationPositionError.PERMISSION_DENIED = 1
      const msg = e.code === 1 ? '位置情報の利用が許可されていません' : '現在地を取得できませんでした'
      useUiStore.getState().addToast('error', msg)
    }
    map.on('locationfound', onFound)
    map.on('locationerror', onError)
    return () => {
      map.off('locationfound', onFound)
      map.off('locationerror', onError)
      map.stopLocate()
      layer.remove()
      control.remove()
      setContainer(null)
    }
  }, [map])

  const locate = () => {
    if (busy) return
    setBusy(true)
    map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, timeout: 10000 })
  }

  if (!container) return null
  return createPortal(
    <a
      href="#"
      role="button"
      title="現在地へ移動"
      aria-label="現在地へ移動"
      aria-busy={busy}
      onClick={(e) => { e.preventDefault(); locate() }}
      className="!flex items-center justify-center !text-[var(--color-fg)]"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}
    </a>,
    container,
  )
}
