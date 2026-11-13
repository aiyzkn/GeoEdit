import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RouteKind } from '@/types/route'

export type ColorTheme = 'light' | 'dark' | 'system'

export interface Toast {
  id: string
  type: 'info' | 'success' | 'error' | 'warning'
  message: string
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
}

const THEME_KEY = 'gpx-editor-theme'

function loadTheme(): ColorTheme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'system'
}

function applyTheme(theme: ColorTheme) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
  root.classList.toggle('dark', isDark)
  localStorage.setItem(THEME_KEY, theme)
}

let toastCounter = 0

export const useUiStore = create<UiState & UiActions>()(
  immer((set) => ({
    theme: loadTheme(),
    bottomPaneHeight: 240,
    sidebarWidth: 240,
    toasts: [],
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
  }))
)
