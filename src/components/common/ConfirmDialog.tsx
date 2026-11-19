import Modal from './Modal'
import { useUiStore, resolveConfirm } from '@/stores/uiStore'

const KIND_CLASS = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  default: 'bg-[var(--color-border)] text-[var(--color-fg)] hover:opacity-80',
} as const

/** uiStore.confirm() の確認ダイアログ（designs/機能追加・UI改善設計書.md C3）。AppLayout に 1 つ置く */
export default function ConfirmDialog() {
  const req = useUiStore((s) => s.confirmRequest)

  if (!req) return null
  return (
    <Modal title={<h2 className="text-sm font-semibold">{req.title}</h2>} onClose={() => resolveConfirm(null)} widthClassName="w-[420px]">
      <p className="whitespace-pre-line text-xs mb-4">{req.message}</p>
      <div className="flex justify-end gap-2 flex-wrap">
        {req.actions.map((a, i) => (
          <button
            key={a.id}
            autoFocus={i === 0}
            onClick={() => resolveConfirm(a.id)}
            className={`px-3 py-1 rounded text-xs ${KIND_CLASS[a.kind ?? 'default']}`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </Modal>
  )
}
