import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  widthClassName?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * モーダルダイアログの基盤（背景オーバーレイ・閉じるボタン・外側クリックで閉じる）。
 * アクセシビリティ（designs/機能追加・UI改善設計書.md D6）: 見出しで名前を付ける、開いたら中の最初の操作できる要素へ
 * フォーカス、Tab はモーダルの中で回す、Escape で閉じる、閉じたら開く前の要素へフォーカスを戻す
 */
export default function Modal({ title, onClose, children, footer, widthClassName = 'w-[480px]' }: ModalProps) {
  const titleId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const box = boxRef.current
    // 子が autoFocus を持っていればそれを優先する
    if (box && !box.contains(document.activeElement)) {
      const first = box.querySelector<HTMLElement>(`.modal-body ${FOCUSABLE}`) ?? box.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    }
    // document で受ける（ダイアログの中の文字をクリックするとフォーカスが body に移り、box では受けられないため）。
    // 重なったときは、いちばん後に開いた（DOM の最後の）ダイアログだけが反応する
    const onKey = (e: KeyboardEvent) => {
      if (!box) return
      const dialogs = document.querySelectorAll('[role=dialog][aria-modal=true]')
      if (dialogs[dialogs.length - 1] !== box) return
      if (e.key === 'Escape') {
        e.preventDefault()
        // window の全体のショートカット（モードの取り消し）まで届けない。閉じると DOM から消えるので、
        // あちらの「モーダルが開いているか」の確かめは当てにならない
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0], last = items[items.length - 1]
      if (!box.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (before && document.contains(before)) before.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl max-h-[80vh] flex flex-col max-w-[calc(100vw-1rem)] ${widthClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          <div id={titleId}>{title}</div>
          <button onClick={onClose} aria-label="ダイアログを閉じる" title="閉じる" className="text-[var(--color-muted)] hover:text-[var(--color-fg)] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body overflow-y-auto flex-1 px-5 py-4 text-xs">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-[var(--color-border)] text-[10px] text-[var(--color-muted)] shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
