import { useMapStore } from '@/stores/mapStore'
import ElevationChart from '@/components/elevation/ElevationChart'
import VirtualTimeline from './VirtualTimeline'
import { ChevronDown, ChevronUp, BarChart2, PanelBottomClose } from 'lucide-react'

interface Props {
  height: number
  /** タイムラインを折りたたむ */
  onCollapse?: () => void
}

export default function BottomPane({ height, onCollapse }: Props) {
  const { showElevation, toggleElevation } = useMapStore()

  const elevH = showElevation ? Math.min(120, Math.floor(height * 0.4)) : 0
  const timelineH = height - elevH

  return (
    <div
      className="flex flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 overflow-hidden"
      style={{ height }}
    >
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--color-border)] shrink-0">
        <span className="text-xs font-medium text-[var(--color-muted)]">タイムライン</span>
        <div className="flex-1" />
        <button
          onClick={toggleElevation}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
            showElevation
              ? 'bg-blue-500/20 text-blue-500'
              : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
          }`}
          title="標高グラフの表示/非表示"
        >
          <BarChart2 size={12} />
          標高
          {showElevation ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        {onCollapse && (
          <button
            onClick={onCollapse}
            aria-label="タイムラインを折りたたむ"
            title="タイムラインを折りたたむ（ヘッダーのボタンで開く）"
            className="p-0.5 rounded text-[var(--color-muted)] hover:text-[var(--color-fg)] transition-colors"
          >
            <PanelBottomClose size={13} />
          </button>
        )}
      </div>
      {showElevation && elevH > 0 && (
        <div style={{ height: elevH }} className="shrink-0">
          <ElevationChart />
        </div>
      )}
      <div style={{ height: timelineH }} className="overflow-hidden">
        <VirtualTimeline />
      </div>
    </div>
  )
}
