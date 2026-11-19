import { useState } from 'react'
import {
  Scissors, Trash2, Merge, GitBranch, Clock, RotateCcw,
  Mountain, MapPin, Type, Download, Info, MousePointer, Plus, Menu, X, Route } from 'lucide-react'
import { useEditorStore, confirmLeaveDraft, requestDraftCommit } from '@/stores/editorStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import type { EditMode } from '@/types/editor'

interface ToolDef {
  mode: EditMode
  icon: React.ReactNode
  label: string
  title: string
}

const TOOLS: ToolDef[] = [
  { mode: 'none', icon: <MousePointer size={15} />, label: '選択', title: '選択モード' },
  { mode: 'create', icon: <Plus size={15} />, label: '作成', title: '新規ルート作成' },
  { mode: 'split', icon: <Scissors size={15} />, label: '分割', title: 'トラック分割' },
  { mode: 'deleteRange', icon: <Trash2 size={15} />, label: '区間削除', title: '区間削除' },
  { mode: 'reroute', icon: <Route size={15} />, label: '道なり補正', title: '既存ルートの区間を、道路に沿って引き直す' },
  { mode: 'merge', icon: <Merge size={15} />, label: '結合', title: 'トラック結合' },
  { mode: 'partialEdit', icon: <GitBranch size={15} />, label: '部分編集', title: '部分編集' },
  { mode: 'thinOut', icon: <GitBranch size={15} />, label: '間引き', title: 'ポイント間引き' },
  { mode: 'timeEdit', icon: <Clock size={15} />, label: '時刻編集', title: '時刻再計算' },
  { mode: 'reverse', icon: <RotateCcw size={15} />, label: '逆順', title: 'トラックを逆順にする' },
  { mode: 'elevReplace', icon: <Mountain size={15} />, label: '標高置換', title: '標高データ置換（GSI API）' },
  { mode: 'waypoint', icon: <MapPin size={15} />, label: 'WPT', title: 'ウェイポイント編集' },
  { mode: 'rename', icon: <Type size={15} />, label: '名前変更', title: 'ルート名変更' },
  { mode: 'pointInfo', icon: <Info size={15} />, label: '詳細', title: 'ポイント詳細情報' },
  { mode: 'export', icon: <Download size={15} />, label: '出力', title: 'ファイル出力' },
]

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={tool.title}
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
          <div className="grid grid-cols-4 gap-1 px-3 pb-2 max-h-[50vh] overflow-y-auto">
            {TOOLS.map((tool) => (
              <ToolButton key={tool.mode} tool={tool} active={mode === tool.mode} onClick={() => select(tool.mode)} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto shrink-0">
      {TOOLS.map((tool) => (
        <ToolButton key={tool.mode} tool={tool} active={mode === tool.mode} onClick={() => select(tool.mode)} />
      ))}
    </div>
  )
}
