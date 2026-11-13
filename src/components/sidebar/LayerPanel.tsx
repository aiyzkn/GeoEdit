import { useMapStore } from '@/stores/mapStore'
import { BASE_LAYERS, OVERLAY_LAYERS } from '@/lib/tileLayers'
import { baseZoomRange, describeZoomRange } from '@/lib/zoomRange'

export default function LayerPanel() {
  const { baseLayerId, setBaseLayer, activeOverlays, addOverlay, removeOverlay, setOverlayOpacity } = useMapStore()

  return (
    <div className="p-2 space-y-4">
      <section>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-2 px-1">
          ベースマップ
        </h3>
        <div className="space-y-0.5">
          {BASE_LAYERS.map((layer) => (
            <button
              key={layer.id}
              onClick={() => setBaseLayer(layer.id)}
              title={describeZoomRange(baseZoomRange(layer))}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                baseLayerId === layer.id
                  ? 'bg-blue-500/20 text-blue-500 font-medium'
                  : 'text-[var(--color-fg)] hover:bg-[var(--color-border)]'
              }`}
            >
              {layer.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-2 px-1">
          重ね合わせ
        </h3>
        <div className="space-y-1">
          {OVERLAY_LAYERS.map((layer) => {
            const active = activeOverlays.find((o) => o.id === layer.id)
            return (
              <div key={layer.id} className="px-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`ov-${layer.id}`}
                    checked={!!active}
                    onChange={(e) => {
                      if (e.target.checked) addOverlay(layer.id, layer.defaultOpacity)
                      else removeOverlay(layer.id)
                    }}
                    className="rounded"
                  />
                  <label htmlFor={`ov-${layer.id}`} className="text-xs cursor-pointer flex-1 truncate">
                    {layer.label}
                  </label>
                </div>
                {active && (
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={active.opacity}
                    onChange={(e) => setOverlayOpacity(layer.id, parseFloat(e.target.value))}
                    className="w-full mt-1"
                  />
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
