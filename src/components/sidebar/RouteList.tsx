import { Trash2, Download, ChevronRight, Route as RouteIcon, Milestone, MapPin } from 'lucide-react'
import { isRouteDirty, useCleanStore } from '@/lib/persistence/dirty'
import { useShallow } from 'zustand/react/shallow'
import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore } from '@/stores/editorStore'
import ExportDialog from '@/components/common/ExportDialog'
import { useState } from 'react'
import type { RouteData, RouteKind } from '@/types/route'
import { routeColor } from '@/lib/colors'
import { convertRouteKind } from '@/lib/editors/routeEditors'

const KIND_ORDER: RouteKind[] = ['track', 'route', 'waypoint']
const KIND_LABEL: Record<RouteKind, string> = { track: 'トラック', route: 'ルート', waypoint: 'ウェイポイント' }
const KIND_ICON: Record<RouteKind, React.ReactNode> = {
  track: <RouteIcon size={12} />,
  route: <Milestone size={12} />,
  waypoint: <MapPin size={12} />,
}

export default function RouteList() {
  const clean = useCleanStore((st) => st.clean)
  const { routes, selectedRouteId, selectRoute, removeRoute, updateRoute } = useRouteStore(useShallow((s) => ({ routes: s.routes, selectedRouteId: s.selectedRouteId, selectRoute: s.selectRoute, removeRoute: s.removeRoute, updateRoute: s.updateRoute })))
  const { mode, mergeTargetIds, toggleMergeTarget, pushUndo } = useEditorStore()
  const [exportRoute, setExportRoute] = useState<RouteData | null>(null)

  const handleRemove = (id: string) => {
    const snapshot = useRouteStore.getState().routes
    pushUndo('ルート削除', snapshot)
    removeRoute(id)
  }

  const handleColorChange = (id: string, color: string) => {
    updateRoute(id, (r) => { r.color = color })
  }

  const handleCycleKind = (route: RouteData) => {
    const idx = KIND_ORDER.indexOf(route.kind)
    const next = KIND_ORDER[(idx + 1) % KIND_ORDER.length]
    const snapshot = useRouteStore.getState().routes
    pushUndo('要素種別変換', snapshot)
    const converted = convertRouteKind(route, next)
    updateRoute(route.id, (r) => {
      r.kind = converted.kind
      r.tracks = converted.tracks
      r.standaloneWaypoints = converted.standaloneWaypoints
    })
  }

  if (routes.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-[var(--color-muted)]">
        ルートが読み込まれていません
      </div>
    )
  }

  return (
    <>
      <div className="p-2 space-y-1">
        {routes.map((route, idx) => {
          const totalPoints = route.kind === 'waypoint'
            ? route.standaloneWaypoints.length
            : route.tracks.reduce((s, t) => s + t.points.length, 0)
          const isSelected = selectedRouteId === route.id
          const color = routeColor(route.color, idx)
          const isMergeTarget = mode === 'merge' && mergeTargetIds.includes(route.id)

          return (
            <div
              key={route.id}
              onClick={() => {
                selectRoute(route.id)
                if (mode === 'merge') toggleMergeTarget(route.id)
              }}
              className={`rounded p-2 cursor-pointer border transition-colors ${
                isMergeTarget
                  ? 'border-teal-500 bg-teal-500/10'
                  : isSelected
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-transparent hover:bg-[var(--color-border)]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <ChevronRight
                  size={12}
                  className={`shrink-0 text-[var(--color-muted)] ${isSelected ? 'rotate-90' : ''} transition-transform`}
                />

                {/* Color swatch — clicking opens native color picker */}
                <div
                  className="relative shrink-0 w-4 h-4 rounded-sm border border-black/20 dark:border-white/20 overflow-hidden"
                  title="描画色を変更"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="absolute inset-0" style={{ backgroundColor: color }} />
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => handleColorChange(route.id, e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    tabIndex={-1}
                  />
                </div>

                <span className="text-xs font-medium truncate flex-1" title={route.name}>
                  {route.name}
                </span>
                {isRouteDirty(route, clean) && <span className="text-orange-500 text-xs shrink-0" title="保存していない変更があります" aria-label="保存していない変更があります">●</span>}
              </div>

              <div className="flex items-center justify-between mt-1 pl-7">
                <span className="text-[10px] text-[var(--color-muted)]">
                  {totalPoints.toLocaleString()} {route.kind === 'waypoint' ? 'wpt' : `pts · ${route.tracks.length} trk`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCycleKind(route) }}
                    className="flex items-center gap-1 px-1 py-1 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    title={`要素種別: ${KIND_LABEL[route.kind]}（クリックで切替: トラック→ルート→ウェイポイント）`}
                  >
                    {KIND_ICON[route.kind]}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setExportRoute(route) }}
                    className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    title="エクスポート"
                  >
                    <Download size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(route.id) }}
                    className="p-1 rounded hover:bg-red-500/10 text-[var(--color-muted)] hover:text-red-500"
                    title="削除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {exportRoute && (
        <ExportDialog route={exportRoute} onClose={() => setExportRoute(null)} />
      )}
    </>
  )
}
