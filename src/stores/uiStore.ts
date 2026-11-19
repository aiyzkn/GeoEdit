import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RouteKind } from '@/types/route'

export type ColorTheme = 'light' | 'dark' | 'system'

export interface Toast {
  id: string
  type: 'info' | 'success' | 'error' | 'warning'
  message: string
}

/** 確認ダイアログ（C3）。actions は左から順に並べる */
export interface ConfirmRequest {
  title: string
  message: string
  actions: { id: string; label: string; kind?: 'primary' | 'danger' | 'default' }[]
}

interface UiState {
  theme: ColorTheme
  bottomPaneHeight: number
  sidebarWidth: number
  toasts: Toast[]
  showHelp: boolean
  /** ファイルを開く際に、読み込んだデータをどの GPX 要素種別として扱うか */
  openAsKind: RouteKind
  /** タブレット幅（768〜1024px）で右サイドバーを手動展開しているか（基本設計書16.1） */
  sidebarOpen: boolean
  /** 表示中の確認ダイアログ */
  confirmRequest: ConfirmRequest | null
  /** 選択中のルートの出力ダイアログ（ヘッダーの「出力」。D3） */
  showExport: boolean
}

interface UiActions {
  setTheme: (theme: ColorTheme) => void
  setBottomPaneHeight: (h: number) => void
  setSidebarWidth: (w: number) => void
  addToast: (type: Toast['type'], message: string) => void
  removeToast: (id: string) => void
  setShowHelp: (show: boolean) => void
  setOpenAsKind: (kind: RouteKind) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  /** 確認ダイアログを出し、押されたボタンの id を返す。Esc・外側のクリックは null */
  confirm: (req: ConfirmRequest) => Promise<string | null>
  setShowExport: (show: boolean) => void
}

const THEME_KEY = 'gpx-editor-theme'

function loadTheme(): ColorTheme {
  // node:test などブラウザの外では localStorage が無い（ストアを読み込むだけで落ちないように）
  if (typeof localStorage === 'undefined') return 'system'
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'system'
}

function applyTheme(theme: ColorTheme) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
  root.classList.toggle('dark', isDark)
  localStorage.setItem(THEME_KEY, theme)
}

let toastCounter = 0

/** 表示中の確認ダイアログの返事を待っている関数（ストアに関数を入れないため、ここに持つ） */
let pendingConfirm: ((id: string | null) => void) | null = null

/** 確認ダイアログを閉じて、返事を返す（ConfirmDialog から呼ぶ） */
export function resolveConfirm(id: string | null) {
  const f = pendingConfirm
  pendingConfirm = null
  useUiStore.setState({ confirmRequest: null })
  f?.(id)
}

export const useUiStore = create<UiState & UiActions>()(
  immer((set) => ({
    theme: loadTheme(),
    bottomPaneHeight: 240,
    sidebarWidth: 240,
    toasts: [],
    confirmRequest: null,
    showExport: false,
    showHelp: false,
    openAsKind: 'track',
    sidebarOpen: false,

    setTheme: (theme) => {
      applyTheme(theme)
      set((state) => {
        state.theme = theme
      })
    },

    setBottomPaneHeight: (h) =>
      set((state) => {
        state.bottomPaneHeight = Math.max(80, Math.min(h, 600))
      }),

    setSidebarWidth: (w) =>
      set((state) => {
        state.sidebarWidth = Math.max(160, Math.min(w, 480))
      }),

    addToast: (type, message) =>
      set((state) => {
        const id = String(++toastCounter)
        state.toasts.push({ id, type, message })
      }),

    removeToast: (id) =>
      set((state) => {
        state.toasts = state.toasts.filter((t) => t.id !== id)
      }),

    setShowHelp: (show) =>
      set((state) => {
        state.showHelp = show
      }),

    setOpenAsKind: (kind) =>
      set((state) => {
        state.openAsKind = kind
      }),

    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen
      }),

    setSidebarOpen: (open) =>
      set((state) => {
        state.sidebarOpen = open
      }),

    setShowExport: (show) =>
      set((state) => {
        state.showExport = show
      }),

    confirm: (req) =>
      new Promise<string | null>((resolve) => {
        // 前の確認が残っていれば、それは「やめる」で閉じる
        if (pendingConfirm) { const f = pendingConfirm; pendingConfirm = null; f(null) }
        pendingConfirm = resolve
        set((state) => {
          state.confirmRequest = req
        })
      }),
  }))
)
