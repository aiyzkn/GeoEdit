import AppHeader from './AppHeader'
import ResizeHandle from './ResizeHandle'
import MapPane from '@/components/map/MapPane'
import RightSidebar from '@/components/sidebar/RightSidebar'
import BottomPane from '@/components/timeline/BottomPane'
import ToastContainer from '@/components/common/ToastContainer'
import HelpDialog from '@/components/common/HelpDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import RestoreBanner from '@/components/common/RestoreBanner'
import ExportDialog from '@/components/common/ExportDialog'
import { useRouteStore } from '@/stores/routeStore'
import EditToolbar from '@/components/toolbar/EditToolbar'
import EditModePanel from '@/components/properties/EditModePanel'
import { useUiStore } from '@/stores/uiStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { X } from 'lucide-react'

const MIN_BOTTOM = 80
const MAX_BOTTOM = 600
const MIN_SIDEBAR = 160
const MAX_SIDEBAR = 480

export default function AppLayout() {
  const { bottomPaneHeight, setBottomPaneHeight, sidebarWidth, setSidebarWidth, sidebarOpen, setSidebarOpen } = useUiStore()
  const breakpoint = useBreakpoint()
  const showExport = useUiStore((s) => s.showExport)
  const setShowExport = useUiStore((s) => s.setShowExport)
  const exportRoute = useRouteStore((s) => s.routes.find((r) => r.id === s.selectedRouteId))

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-bg)]">
      <AppHeader />
      <EditToolbar />
      <EditModePanel />
      <div className="flex flex-1 overflow-hidden relative">
        {/* isolate: Leaflet内部ペインのz-index（最大700）が独自のスタッキングコンテキストに
            閉じ込められないと、下記のサイドバーオーバーレイ（z-30/z-40）より上に描画されてしまうため */}
        <div className="flex-1 overflow-hidden isolate relative">
          <MapPane />
          <RestoreBanner />
        </div>
        {/* PC（>=1024px）: 常時表示。タブレット（768〜1024px）: ヘッダーのボタンで、右から重ねて出す。
            モバイル（<768px）: ヘッダーのボタンで、画面の下からシートを出す（D5） */}
        {breakpoint === 'desktop' && (
          <>
            <ResizeHandle orientation="vertical" value={sidebarWidth} min={MIN_SIDEBAR} max={MAX_SIDEBAR} onChange={setSidebarWidth} label="右側のパネルの幅" />
            <RightSidebar width={sidebarWidth} />
          </>
        )}
        {breakpoint === 'tablet' && sidebarOpen && (
          <>
            <div
              className="absolute inset-0 bg-black/30 z-30"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute right-0 top-0 bottom-0 z-40 shadow-2xl">
              <RightSidebar width={sidebarWidth} />
            </div>
          </>
        )}
      </div>
      {breakpoint === 'mobile' && sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-30" onClick={() => setSidebarOpen(false)} />
          <div
            role="region"
            aria-label="ルート・レイヤー・属性・統計"
            className="fixed left-0 right-0 bottom-0 z-40 h-[70vh] flex flex-col rounded-t-xl shadow-2xl bg-[var(--color-surface)] border-t border-[var(--color-border)] overflow-hidden"
          >
            <div className="relative flex items-center justify-center h-6 shrink-0">
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" aria-hidden="true" />
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="閉じる"
                title="閉じる"
                className="absolute right-2 top-0.5 p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex">
              <RightSidebar width="100%" />
            </div>
          </div>
        </>
      )}
      <ResizeHandle orientation="horizontal" value={bottomPaneHeight} min={MIN_BOTTOM} max={MAX_BOTTOM} onChange={setBottomPaneHeight} label="下側のタイムラインの高さ" />
      <BottomPane height={bottomPaneHeight} />
      <ToastContainer />
      <HelpDialog />
      <ConfirmDialog />
      {showExport && exportRoute && <ExportDialog route={exportRoute} onClose={() => setShowExport(false)} />}
    </div>
  )
}
