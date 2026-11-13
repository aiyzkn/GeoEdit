import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  widthClassName?: string
}

/** ExportDialog / HelpDialog / AboutDialog が共通利用するモーダルダイアログ基盤（背景オーバーレイ・閉じるボタン・外側クリックで閉じる挙動を集約）。 */
export default function Modal({ title, onClose, children, footer, widthClassName = 'w-[480px]' }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl max-h-[80vh] flex flex-col ${widthClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          {title}
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-fg)] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 text-xs">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-[var(--color-border)] text-[10px] text-[var(--color-muted)] shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
