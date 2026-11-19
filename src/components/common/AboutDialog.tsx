import { Tag, Calendar } from 'lucide-react'
import { APP_NAME, APP_VERSION, CHANGELOG } from '@/lib/version'
import Modal from './Modal'
import { useState } from 'react'
import { isAutosaveEnabled, setAutosaveEnabled } from '@/lib/persistence/autosave'
import { clearSession } from '@/lib/persistence/sessionDb'
import { useUiStore } from '@/stores/uiStore'

/** 自動保存の設定（designs/機能追加・UI改善設計書.md C1）。共用の PC に位置情報のログを残したくない人のため */
function AutosaveSetting() {
  const [on, setOn] = useState(isAutosaveEnabled)
  return (
    <section>
      <h3 className="font-semibold text-[var(--color-muted)] uppercase tracking-wider text-[10px] mb-2">データの保存</h3>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setAutosaveEnabled(e.target.checked) }} />
        編集内容をこのブラウザに自動保存する（再読み込み・誤ってタブを閉じたときに復元できる）
      </label>
      <button
        onClick={() => {
          void clearSession().then(
            () => useUiStore.getState().addToast('success', '保存したデータを消しました'),
            () => useUiStore.getState().addToast('error', '保存したデータを消せませんでした'),
          )
        }}
        className="mt-2 px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80"
      >
        保存したデータを消す
      </button>
    </section>
  )
}

interface Props {
  onClose: () => void
}

const TYPE_LABEL = {
  major: { text: 'メジャー', cls: 'bg-red-500/20 text-red-400' },
  minor: { text: '機能追加', cls: 'bg-blue-500/20 text-blue-400' },
  patch: { text: 'バグ修正', cls: 'bg-green-500/20 text-green-400' },
}

export default function AboutDialog({ onClose }: Props) {
  const title = (
    <div>
      <h2 className="text-sm font-semibold">{APP_NAME}</h2>
      <div className="flex items-center gap-1.5 mt-0.5">
        <Tag size={11} className="text-[var(--color-muted)]" />
        <span className="text-xs text-[var(--color-muted)]">v{APP_VERSION}</span>
      </div>
    </div>
  )

  return (
    <Modal
      title={title}
      onClose={onClose}
      widthClassName="w-[480px]"
      footer="Cloudflare Pages にデプロイ · セマンティックバージョニング（メジャー.マイナー.パッチ）"
    >
      <div className="space-y-4">
        {/* 自動保存（C1） */}
        <AutosaveSetting />

        {/* Tech stack */}
        <section>
          <h3 className="font-semibold text-[var(--color-muted)] uppercase tracking-wider text-[10px] mb-2">
            技術スタック
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {[
              'React 19', 'TypeScript 5', 'Vite 6', 'Tailwind CSS v4',
              'Leaflet 1.9', 'Zustand 5', 'Recharts 2',
              '@tanstack/react-virtual', '@tmcw/togeojson',
            ].map((tech) => (
              <span
                key={tech}
                className="px-2 py-0.5 rounded-full bg-[var(--color-border)] text-[var(--color-fg)] text-[10px]"
              >
                {tech}
              </span>
            ))}
          </div>
        </section>

        {/* Changelog */}
        <section>
          <h3 className="font-semibold text-[var(--color-muted)] uppercase tracking-wider text-[10px] mb-2">
            変更履歴
          </h3>
          <div className="space-y-3">
            {CHANGELOG.map((entry) => {
              const badge = TYPE_LABEL[entry.type]
              return (
                <div
                  key={entry.version}
                  className="border border-[var(--color-border)] rounded-md p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">v{entry.version}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>
                      {badge.text}
                    </span>
                    <span className="flex items-center gap-1 text-[var(--color-muted)] ml-auto text-[10px]">
                      <Calendar size={10} />
                      {entry.date}
                    </span>
                  </div>
                  <ul className="space-y-0.5 text-[var(--color-muted)]">
                    {entry.notes.map((note) => (
                      <li key={note} className="flex gap-1.5">
                        <span className="shrink-0 mt-0.5">•</span>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </Modal>
  )
}
