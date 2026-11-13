import { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useUiStore } from '@/stores/uiStore'
import type { Toast } from '@/stores/uiStore'

const ICONS: Record<Toast['type'], React.ReactNode> = {
  success: <CheckCircle size={14} className="text-green-400" />,
  error: <AlertCircle size={14} className="text-red-400" />,
  info: <Info size={14} className="text-blue-400" />,
  warning: <AlertTriangle size={14} className="text-yellow-400" />,
}

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useUiStore()

  useEffect(() => {
    const t = setTimeout(() => removeToast(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id])

  return (
    <div className="flex items-start gap-2 bg-gray-800 text-white rounded-lg shadow-xl px-3 py-2.5 text-xs max-w-xs border border-gray-700">
      {ICONS[toast.type]}
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-gray-400 hover:text-white transition-colors ml-1 shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const { toasts } = useUiStore()
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[99999] pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>
  )
}
