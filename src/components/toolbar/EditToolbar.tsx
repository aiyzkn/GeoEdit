import { useState } from 'react'
import {
  Scissors, Trash2, Merge, PencilLine, ListFilter, Clock, RotateCcw,
  Mountain, MapPin, Type, Info, MousePointer, Plus, Menu, X, Route } from 'lucide-react'
import { useEditorStore, confirmLeaveDraft, requestDraftCommit } from '@/stores/editorStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import type { EditMode } from '@/types/editor'

type ToolGroup = 'select' | 'draw' | 'time' | 'info'

interface ToolDef {
  mode: EditMode
  icon: React.ReactNode
  label: string
  title: string
  group: ToolGroup
}

/** 群の見出し（モバイルの折り畳みで出す。designs/機能追加・UI改善設計書.md D3） */
const GROUP_LABEL: Record<ToolGroup, string> = { select: '', draw: '描く・直す', time: '時刻・標高', info: '名前・情報' }

/** ラベルは要件定義書の節の名前にそろえる（D2）。「出力」はヘッダーのボタンにした（D3） */
const TOOLS: ToolDef[] = [
  { mode: 'none', icon: <MousePointer size={15} />, label: '選択', title: '選択モード', group: 'select' },
  { mode: 'create', icon: <Plus size={15} />, label: '作成', title: '新規ルート作成', group: 'draw' },
  { mode: 'partialEdit', icon: <PencilLine size={15} />, label: '部分編集', title: '部分編集', group: 'draw' },
  { mode: 'reroute', icon: <Route size={15} />, label: '道なり補正', title: '既存ルートの区間を、道路に沿って引き直す', group: 'draw' },
  { mode: 'split', icon: <Scissors size={15} />, label: '分割', title: 'トラック分割', group: 'draw' },
  { mode: 'deleteRange', icon: <Trash2 size={15} />, label: '部分削除', title: '部分削除（区間を指定して削除）', group: 'draw' },
  { mode: 'merge', icon: <Merge size={15} />, label: '結合', title: 'トラック結合', group: 'draw' },
  { mode: 'thinOut', icon: <ListFilter size={15} />, label: '間引き', title: 'ポイント間引き', group: 'draw' },
  { mode: 'reverse', icon: <RotateCcw size={15} />, label: '逆ルート', title: '逆ルート（始点と終点を入れ替える）', group: 'draw' },
  { mode: 'timeEdit', icon: <Clock size={15} />, label: '時間変更', title: '時間変更（再計算・シフト）', group: 'time' },
  { mode: 'elevReplace', icon: <Mountain size={15} />, label: '標高置換', title: '標高データ置換（GSI API）', group: 'time' },
  { mode: 'rename', icon: <Type size={15} />, label: '名前変更', title: 'ルート名変更', group: 'info' },
  { mode: 'waypoint', icon: <MapPin size={15} />, label: 'ウェイポイント', title: 'ウェイポイント編集', group: 'info' },
  { mode: 'pointInfo', icon: <Info size={15} />, label: 'ポイント情報', title: 'ポイント情報', group: 'info' },
]

const GROUPS: ToolGroup[] = ['select', 'draw', 'time', 'info']

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={tool.title}
      aria-pressed={active}
      className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded text-[10px] transition-colors whitespace-nowrap ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-border)]'
      }`}
    >
      {tool.icon}
      {tool.label}
    </button>
  )
}

export default function EditToolbar() {
  const { mode, setMode } = useEditorStore()
  const breakpoint = useBreakpoint()
  const [expanded, setExpanded] = useState(false)

  const select = async (m: EditMode) => {
    // 同一モードのボタンはトグルで解除（'none'）になる。切替先が作成モード以外になる場合、
    // 未確定ポイントを暗黙に破棄しない（確認してキャンセル可能にする）
    const target = m === mode ? 'none' : m
    if (target !== useEditorStore.getState().mode) {
      const answer = await confirmLeaveDraft()
      if (answer === 'keep') return
      if (answer === 'commit') { requestDraftCommit(target); return }
    }
    setMode(target)
    setExpanded(false)
  }

  // モバイル（<768px、基本設計書16.1）: 現在のモードのみ表示し、メニューボタンで全モードを折り畳み表示する
  if (breakpoint === 'mobile') {
    const current = TOOLS.find((t) => t.mode === mode) ?? TOOLS[0]
    return (
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-[var(--color-border)] text-[var(--color-fg)]"
            aria-expanded={expanded}
          >
            {expanded ? <X size={14} /> : <Menu size={14} />}
            編集モード
          </button>
          <span className="flex items-center gap-1 text-xs text-[var(--color-muted)]">
            {current.icon}
            {current.label}
          </span>
        </div>
        {expanded && (
          <div className="px-3 pb-2 max-h-[50vh] overflow-y-auto space-y-1">
            {GROUPS.map((g) => (
              <div key={g}>
                {GROUP_LABEL[g] && <div className="text-[10px] text-[var(--color-muted)] mt-1">{GROUP_LABEL[g]}</div>}
                <div className="grid grid-cols-4 gap-1">
                  {TOOLS.filter((t) => t.group === g).map((tool) => (
                    <ToolButton key={tool.mode} tool={tool} active={mode === tool.mode} onClick={() => select(tool.mode)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto shrink-0">
      {GROUPS.map((g, gi) => (
        <div key={g} role="group" aria-label={GROUP_LABEL[g] || '選択'} className="flex items-center gap-1">
          {gi > 0 && <div className="w-px h-8 bg-[var(--color-border)] mx-1 shrink-0" aria-hidden="true" />}
          {TOOLS.filter((t) => t.group === g).map((tool) => (
            <ToolButton key={tool.mode} tool={tool} active={mode === tool.mode} onClick={() => select(tool.mode)} />
          ))}
        </div>
      ))}
    </div>
  )
}
