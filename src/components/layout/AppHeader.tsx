import { useEffect, useState } from 'react'
import { Upload, Undo2, Redo2, Sun, Moon, Monitor, HelpCircle, Info, PanelRightOpen, PanelRightClose } from 'lucide-react'
import { useEditorStore } from '@/stores/editorStore'
import { useRouteStore } from '@/stores/routeStore'
import { useUiStore, type ColorTheme } from '@/stores/uiStore'
import { useFileLoader } from '@/hooks/useFileLoader'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import AboutDialog from '@/components/common/AboutDialog'
import { APP_VERSION } from '@/lib/version'
import type { RouteKind } from '@/types/route'

const THEMES: { value: ColorTheme; icon: React.ReactNode; label: string }[] = [
  { value: 'light', icon: <Sun size={14} />, label: 'ライト' },
  { value: 'system', icon: <Monitor size={14} />, label: 'システム' },
  { value: 'dark', icon: <Moon size={14} />, label: 'ダーク' },
]

const OPEN_AS_KINDS: { value: RouteKind; label: string }[] = [
  { value: 'track', label: 'トラック' },
  { value: 'route', label: 'ルート' },
  { value: 'waypoint', label: 'ウェイポイント' },
]

export default function AppHeader() {
  const { undoStack, redoStack, undo, redo } = useEditorStore()
  const { setRoutes, routes } = useRouteStore()
  const { theme, setTheme, setShowHelp, openAsKind, setOpenAsKind, sidebarOpen, toggleSidebar } = useUiStore()
  const { openFiles } = useFileLoader()
  const [showAbout, setShowAbout] = useState(false)
  const breakpoint = useBreakpoint()

  useEffect(() => {
    const handler = () => openFiles()
    document.addEventListener('open-files', handler)
    return () => document.removeEventListener('open-files', handler)
  }, [openFiles])

  const handleUndo = () => {
    const entry = undo(useRouteStore.getState().routes)
    if (entry) {
      setRoutes(entry.snapshot)
    }
  }

  const handleRedo = () => {
    const entry = redo(useRouteStore.getState().routes)
    if (entry) {
      setRoutes(entry.snapshot)
    }
  }

  return (
    <header className="h-[52px] flex items-center gap-1.5 md:gap-2 px-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 overflow-x-auto">
      <span className="hidden md:inline font-semibold text-sm text-[var(--color-fg)] mr-2 whitespace-nowrap shrink-0">
        GeoJSON / GPX / KML Editor
      </span>

      <select
        value={openAsKind}
        onChange={(e) => setOpenAsKind(e.target.value as RouteKind)}
        className="shrink-0 px-1.5 py-1.5 rounded text-xs border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)]"
        title="開いたファイルをどの要素種別として読み込むか（通常は「トラック」）"
      >
        {OPEN_AS_KINDS.map(({ value, label }) => (
          <option key={value} value={value}>{label}として開く</option>
        ))}
      </select>

      <button
        onClick={openFiles}
        className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-blue-600 text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
        title="ファイルを開く (Ctrl+O)"
      >
        <Upload size={14} />
        <span className="hidden sm:inline">開く</span>
      </button>

      <div className="w-px h-6 bg-[var(--color-border)] shrink-0" />

      <button
        onClick={handleUndo}
        disabled={undoStack.length === 0}
        className="shrink-0 p-1.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title={`元に戻す (Ctrl+Z)${undoStack[undoStack.length - 1] ? ` — ${undoStack[undoStack.length - 1].description}` : ''}`}
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={handleRedo}
        disabled={redoStack.length === 0}
        className="shrink-0 p-1.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="やり直し (Ctrl+Y)"
      >
        <Redo2 size={16} />
      </button>

      <div className="flex-1 min-w-2" />

      <div className="shrink-0 flex items-center gap-0.5 rounded border border-[var(--color-border)] p-0.5">
        {THEMES.map(({ value, icon, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors whitespace-nowrap ${
              theme === value
                ? 'bg-blue-600 text-white'
                : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
            }`}
            title={label}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowAbout(true)}
        className="shrink-0 p-1.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] transition-colors"
        title={`バージョン情報 v${APP_VERSION}`}
      >
        <Info size={16} />
      </button>
      <button
        onClick={() => setShowHelp(true)}
        className="shrink-0 p-1.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] transition-colors"
        title="ヘルプ"
      >
        <HelpCircle size={16} />
      </button>

      {routes.length > 0 && (
        <span className="hidden sm:inline shrink-0 text-xs text-[var(--color-muted)] whitespace-nowrap">
          {routes.length} ルート
        </span>
      )}

      {breakpoint === 'tablet' && (
        <button
          onClick={toggleSidebar}
          className={`shrink-0 p-1.5 rounded transition-colors ${
            sidebarOpen
              ? 'bg-blue-600 text-white'
              : 'hover:bg-[var(--color-border)] text-[var(--color-muted)]'
          }`}
          title="サイドバーの表示/非表示"
        >
          {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      )}

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </header>
  )
}
