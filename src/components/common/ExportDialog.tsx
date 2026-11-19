import { useState } from 'react'
import { useRouteStore } from '@/stores/routeStore'
import { markClean } from '@/lib/persistence/dirty'
import { Download, Copy } from 'lucide-react'
import type { RouteData } from '@/types/route'
import type { ExportOptions, GpxOutputMode } from '@/types/editor'
import { useFileExporter, defaultExportFileName } from '@/hooks/useFileExporter'
import Modal from './Modal'

interface Props {
  route: RouteData
  onClose: () => void
}

const GPX_MODES: { value: GpxOutputMode; label: string }[] = [
  { value: 'original', label: 'オリジナル形式（ウェイポイント含む）' },
  { value: 'original-no-wpt', label: 'オリジナル形式（ウェイポイント除く）' },
  { value: 'minimal', label: '最小形式（ウェイポイント含む）' },
  { value: 'minimal-no-wpt', label: '最小形式（ウェイポイント除く）' },
]

export default function ExportDialog({ route, onClose }: Props) {
  const [format, setFormat] = useState<ExportOptions['format']>('gpx')
  const [gpxMode, setGpxMode] = useState<GpxOutputMode>('original')
  const [fileName, setFileName] = useState(() => defaultExportFileName(route))
  const { exportRoute, copyRoute } = useFileExporter()

  const handleExport = () => {
    exportRoute(route, { format, gpxMode }, fileName)
    // 書き出した直後は「変更なし」（C2）
    const current = useRouteStore.getState().routes.find((r) => r.id === route.id)
    if (current) markClean(current)
    onClose()
  }

  return (
    <Modal title={<h2 className="text-sm font-semibold">エクスポート</h2>} onClose={onClose} widthClassName="w-80">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">形式</label>
          <div className="flex gap-2">
            {(['geojson', 'gpx', 'kml'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  format === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-muted)]/30'
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {format === 'gpx' && (
          <div>
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">GPXモード</label>
            <div className="space-y-1">
              {GPX_MODES.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="gpxMode"
                    value={value}
                    checked={gpxMode === value}
                    onChange={() => setGpxMode(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-[var(--color-border)] pt-2">
          <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">ファイル名</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="flex-1 px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)] text-xs font-mono"
            />
            <span className="text-xs text-[var(--color-muted)] font-mono">.{format}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
          >
            <Download size={14} />
            ダウンロード
          </button>
          <button
            onClick={() => { void copyRoute(route, { format, gpxMode }) }}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-[var(--color-border)] text-[var(--color-fg)] text-sm hover:opacity-80 transition-colors"
            title="選んでいる形式で、クリップボードへコピー"
          >
            <Copy size={14} />
            コピー
          </button>
        </div>
      </div>
    </Modal>
  )
}
