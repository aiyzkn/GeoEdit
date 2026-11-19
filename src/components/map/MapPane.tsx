import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@maplibre/maplibre-gl-leaflet'
import { useRouteStore } from '@/stores/routeStore'
import { useMapStore } from '@/stores/mapStore'
import { useEditorStore } from '@/stores/editorStore'
import { useDropZone } from '@/hooks/useDropZone'
import { useKeyboard } from '@/hooks/useKeyboard'
import { BASE_LAYERS, OVERLAY_LAYERS } from '@/lib/tileLayers'
import { addAnchorAt, cancelAll } from '@/lib/draftController'
import { routeColor } from '@/lib/colors'
import { baseZoomRange, baseTileZoomOptions, overlayTileZoomOptions, clampZoom } from '@/lib/zoomRange'
import type { TileLayerDef } from '@/types/tile'

/**
 * 重ね合わせ用オーバーレイタイルの専用ペイン。ベースマップ（tilePane, z-index:200）より上、
 * ルートのポリライン等（デフォルトの overlayPane, z-index:400）より下に位置させることで、
 * 「オーバーレイを重ねるとベースマップしか見えない／ルートが隠れる」を防ぐ。
 * ペイン名は Leaflet の createPane() 内部で "Pane" という文字列が除去されて
 * クラス名が組み立てられる（例: 'rasterOverlayPane' → leaflet-rasterOverlay-pane）ため、
 * 紛らわしさを避けて末尾に "Pane" を含まない名前にしている。
 */
const RASTER_OVERLAY_PANE = 'rasterOverlay'
const RASTER_OVERLAY_Z_INDEX = 350
import RoutePolyline from './RoutePolyline'
import CreateRouteLayer from './CreateRouteLayer'
import PartialEditLayer from './PartialEditLayer'
import PlaceSearch from './PlaceSearch'
import BaseMapSwitcher from './BaseMapSwitcher'
import LocateControl from './LocateControl'

function createBaseLayer(layerDef: TileLayerDef): L.Layer {
  if (layerDef.type === 'vector') {
    return L.maplibreGL({
      style: layerDef.style!,
      attributionControl: { customAttribution: layerDef.attribution },
    })
  }
  return L.tileLayer(layerDef.url!, {
    attribution: layerDef.attribution,
    // 提供範囲外のタイルを要求しない／提供上限を超えたら引き伸ばして表示する（lib/zoomRange.ts）
    ...baseTileZoomOptions(layerDef),
    className: layerDef.noInvert ? '' : 'invert-tile',
  })
}

/**
 * 地図のズーム範囲をベースマップに合わせる。minZoom/maxZoom を地図に明示することで、
 * Leaflet が重ね合わせを含む全レイヤーの範囲から自動算出するのを止め、ズームボタンの
 * 有効/無効をベースマップの表示可能範囲と一致させる。現在のズームが範囲外なら Leaflet が範囲内へ移動する。
 */
function applyBaseZoomRange(map: L.Map, layerDef: TileLayerDef) {
  const r = baseZoomRange(layerDef)
  // 「新しい min > 現在の max」等で一時的に min > max にならないよう、広げる側から先に設定する
  if (r.min > map.getMaxZoom()) {
    map.setMaxZoom(r.max)
    map.setMinZoom(r.min)
  } else {
    map.setMinZoom(r.min)
    map.setMaxZoom(r.max)
  }
}

export default function MapPane() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.Layer | null>(null)
  const overlayLayersRef = useRef<Map<string, L.TileLayer>>(new Map())
  const { setMapInstance, baseLayerId, activeOverlays } = useMapStore()
  const routes = useRouteStore((s) => s.routes)
  const { mode } = useEditorStore()
  const { isDragOver, onDragOver, onDragLeave, onDrop } = useDropZone()

  useKeyboard()

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // 初期ベースレイヤーはストアの baseLayerId（既定 'gsi-pale'）から引く。
    // 以前は 'gsi-std' をハードコードしており、既定値変更後も初期化時に標準地図を無駄に読み込んでいた。
    const initialBaseId = useMapStore.getState().baseLayerId
    const layerDef = BASE_LAYERS.find((l) => l.id === initialBaseId) ?? BASE_LAYERS[0]
    const initialRange = baseZoomRange(layerDef)

    const map = L.map(mapRef.current, {
      center: [35.681236, 139.767125],
      zoom: clampZoom(10, initialRange),
      // ズーム範囲はベースマップで決める（applyBaseZoomRange 参照）
      minZoom: initialRange.min,
      maxZoom: initialRange.max,
      zoomControl: true,
    })

    const pane = map.createPane(RASTER_OVERLAY_PANE)
    pane.style.zIndex = String(RASTER_OVERLAY_Z_INDEX)
    pane.style.pointerEvents = 'none'

    const tile = createBaseLayer(layerDef)
    tile.addTo(map)
    tileRef.current = tile
    mapInstanceRef.current = map
    setMapInstance(map)

    // Leaflet は window の大きさの変化しか見ない。パネルの折りたたみ・リサイズで入れ物だけが変わったときに、
    // 広がった部分のタイルが描かれないままにならないよう、入れ物を見張って知らせる
    const container = mapRef.current
    let rafId: number | null = null
    const ro = new ResizeObserver(() => {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        map.invalidateSize({ pan: false })
      })
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      if (rafId != null) cancelAnimationFrame(rafId)
      map.remove()
      mapInstanceRef.current = null
      setMapInstance(null)
    }
  }, [])

  // Swap base tile layer
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const layerDef = BASE_LAYERS.find((l) => l.id === baseLayerId)
    if (!layerDef || (!layerDef.url && !layerDef.style)) return
    if (tileRef.current) {
      map.removeLayer(tileRef.current)
    }
    applyBaseZoomRange(map, layerDef)
    const tile = createBaseLayer(layerDef)
    tile.addTo(map)
    if (typeof (tile as L.TileLayer).bringToBack === 'function') {
      ;(tile as L.TileLayer).bringToBack()
    }
    tileRef.current = tile
  }, [baseLayerId])

  // Sync overlay tile layers（重ね合わせ）with mapStore.activeOverlays
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const layers = overlayLayersRef.current

    // 非アクティブ化されたオーバーレイを地図から除去
    for (const [id, layer] of layers) {
      if (!activeOverlays.some((o) => o.id === id)) {
        map.removeLayer(layer)
        layers.delete(id)
      }
    }

    // アクティブなオーバーレイを追加、または既存レイヤーの透明度を更新
    activeOverlays.forEach((overlay) => {
      const existing = layers.get(overlay.id)
      if (existing) {
        existing.setOpacity(overlay.opacity)
        return
      }
      const layerDef = OVERLAY_LAYERS.find((l) => l.id === overlay.id)
      if (!layerDef?.url) return
      const layer = L.tileLayer(layerDef.url, {
        attribution: layerDef.attribution,
        // 地図のズーム範囲はベースマップ側で固定しているので、重ね合わせは範囲に影響させず
        // 提供上限超えは引き伸ばし表示・提供下限未満は非表示にする
        ...overlayTileZoomOptions(layerDef),
        opacity: overlay.opacity,
        pane: RASTER_OVERLAY_PANE,
        className: layerDef.noInvert ? '' : 'invert-tile',
      })
      layer.addTo(map)
      layers.set(overlay.id, layer)
    })
  }, [activeOverlays])

  // 作成モード: 地図のクリックで通過点を足す（designs/経路探索詳細設計書.md §8.4）。
  // 経路探索が ON なら道へ寄せて前の通過点から道なりに結び、OFF なら画像のマップマッチングで補正する。
  // Ctrl（macOS は Cmd）押下: 経路探索 ON ならその区間を直線に、OFF ならマッチングを飛ばす。
  // 順序は draftController の直列キューが保つ
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || mode !== 'create') return
    const handleClick = (e: L.LeafletMouseEvent) => {
      const straight = e.originalEvent.ctrlKey || e.originalEvent.metaKey
      addAnchorAt(map, { lat: e.latlng.lat, lng: e.latlng.lng }, { straight })
    }
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
      cancelAll()
    }
  }, [mode])

  // Fit bounds when routes added
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || routes.length === 0) return
    const latLngs: L.LatLng[] = []
    routes.forEach((r) =>
      r.tracks.forEach((t) =>
        t.points.forEach((p) => latLngs.push(L.latLng(p.lat, p.lng)))
      )
    )
    if (latLngs.length > 0) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30] })
    }
  }, [routes.length])

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapRef}
        className="w-full h-full"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/20 border-4 border-dashed border-blue-500 flex items-center justify-center pointer-events-none z-[9999]">
          <div className="bg-blue-600 text-white rounded-lg px-6 py-3 text-lg font-semibold shadow-xl">
            ファイルをドロップして開く
          </div>
        </div>
      )}
      {routes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-[var(--color-muted)] select-none">
            <p className="text-lg font-medium mb-1">Route Editor</p>
            <p className="text-sm">GeoJSON / GPX / KML ファイルをドラッグ＆ドロップ、または「開く」ボタンから読み込み</p>
          </div>
        </div>
      )}
      {mapInstanceRef.current && routes.map((route, idx) => (
        <RoutePolyline
          key={route.id}
          route={route}
          map={mapInstanceRef.current!}
          color={routeColor(route.color, idx)}
        />
      ))}
      {mapInstanceRef.current && (mode === 'create' || mode === 'reroute') && (
        <CreateRouteLayer map={mapInstanceRef.current} />
      )}
      {mapInstanceRef.current && mode === 'partialEdit' && (
        <PartialEditLayer map={mapInstanceRef.current} />
      )}
      {mapInstanceRef.current && <PlaceSearch map={mapInstanceRef.current} />}
      {mapInstanceRef.current && <LocateControl map={mapInstanceRef.current} />}
      {/* 右上のベースマップ切替（全画面幅で表示。モバイルではサイドバーが無いため唯一の切替手段） */}
      <BaseMapSwitcher />
    </div>
  )
}
