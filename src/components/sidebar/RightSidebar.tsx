import { useEffect, useState } from 'react'
import LayerPanel from './LayerPanel'
import RouteList from './RouteList'
import PropertiesPanel from './PropertiesPanel'
import StatsPanel from './StatsPanel'
import { useEditorStore } from '@/stores/editorStore'

interface Props {
  width: number
}

type Tab = 'routes' | 'layers' | 'properties' | 'stats'

export default function RightSidebar({ width }: Props) {
  const [tab, setTab] = useState<Tab>('routes')
  const mode = useEditorStore((s) => s.mode)

  // 「ポイント情報」モードに入ったら、詳細情報が表示される属性タブへ自動的に切り替える
  // （ポイントをクリックしても右パネルが変わらず「何も表示されない」ように見える問題への対応）
  useEffect(() => {
    if (mode === 'pointInfo') setTab('properties')
  }, [mode])

  return (
    <div
      className="flex flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 overflow-hidden"
      style={{ width }}
    >
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        {([['routes', 'ルート'], ['layers', 'レイヤー'], ['properties', '属性'], ['stats', '統計']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
              tab === t
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {tab === 'routes' && <RouteList />}
        {tab === 'layers' && <LayerPanel />}
        {tab === 'properties' && <PropertiesPanel />}
        {tab === 'stats' && <StatsPanel />}
      </div>
    </div>
  )
}
