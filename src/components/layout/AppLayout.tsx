import { useRef, useState, useCallback } from 'react'
import AppHeader from './AppHeader'
import MapPane from '@/components/map/MapPane'
import RightSidebar from '@/components/sidebar/RightSidebar'
import BottomPane from '@/components/timeline/BottomPane'
import ToastContainer from '@/components/common/ToastContainer'
import HelpDialog from '@/components/common/HelpDialog'
import EditToolbar from '@/components/toolbar/EditToolbar'
import EditModePanel from '@/components/properties/EditModePanel'
import { useUiStore } from '@/stores/uiStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'

const MIN_BOTTOM = 80
const MAX_BOTTOM = 600

export default function AppLayout() {
  const { bottomPaneHeight, setBottomPaneHeight, sidebarWidth, setSidebarWidth, sidebarOpen, setSidebarOpen } = useUiStore()
  const breakpoint = useBreakpoint()
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)
  const [isDragging, setIsDragging] = useState(false)
  const sidebarDragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)
  const [isSidebarDragging, setIsSidebarDragging] = useState(false)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startY.current = e.clientY
    startH.current = bottomPaneHeight
    setIsDragging(true)

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = startY.current - ev.clientY
      const newH = Math.max(MIN_BOTTOM, Math.min(MAX_BOTTOM, startH.current + delta))
      setBottomPaneHeight(newH)
    }
    const onUp = () => {
      dragging.current = false
      setIsDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [bottomPaneHeight, setBottomPaneHeight])

  // 右サイドバーの幅リサイズ（uiStore.sidebarWidth/setSidebarWidthは以前から存在したが
  // ドラッグハンドルが未実装で常に初期値のまま固定されていたため新設）
  const onSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    sidebarDragging.current = true
    startX.current = e.clientX
    startW.current = sidebarWidth
    setIsSidebarDragging(true)

    const onMove = (ev: MouseEvent) => {
      if (!sidebarDragging.current) return
      const delta = startX.current - ev.clientX
      setSidebarWidth(startW.current + delta)
    }
    const onUp = () => {
      sidebarDragging.current = false
      setIsSidebarDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth, setSidebarWidth])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-bg)]">
      <AppHeader />
      <EditToolbar />
      <EditModePanel />
      <div className="flex flex-1 overflow-hidden relative">
        {/* isolate: Leaflet内部ペインのz-index（最大700）が独自のスタッキングコンテキストに
            閉じ込められないと、下記のサイドバーオーバーレイ（z-30/z-40）より上に描画されてしまうため */}
        <div className="flex-1 overflow-hidden isolate">
          <MapPane />
        </div>
        {/* PC（>=1024px）: 常時表示。タブレット（768〜1024px）: AppHeaderのトグルで手動展開、オーバーレイ表示。
            モバイル（<768px）: 基本設計書16.1により非表示（アクセス手段自体を提供しない） */}
        {breakpoint === 'desktop' && (
          <>
            <div
              className={`w-1 cursor-col-resize bg-[var(--color-border)] hover:bg-blue-400 transition-colors ${isSidebarDragging ? 'bg-blue-400' : ''}`}
              onMouseDown={onSidebarResizeStart}
            />
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
      <div
        className={`h-1 cursor-row-resize bg-[var(--color-border)] hover:bg-blue-400 transition-colors ${isDragging ? 'bg-blue-400' : ''}`}
        onMouseDown={onResizeStart}
      />
      <BottomPane height={bottomPaneHeight} />
      <ToastContainer />
      <HelpDialog />
    </div>
  )
}
