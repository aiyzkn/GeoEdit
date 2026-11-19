// 保存していない変更の判定（designs/機能追加・UI改善設計書.md C2）。
// ルートごとに「最後に読み込んだ・書き出した時点のオブジェクト」を覚え、今のオブジェクトと同じ参照かで比べる
// （Immer は、変えていないルートの参照を保つ）。

import { create } from 'zustand'
import type { RouteData } from '@/types/route'

interface CleanState {
  /** ルートの id → 変更なしとみなすオブジェクト */
  clean: Record<string, RouteData>
}

export const useCleanStore = create<CleanState>(() => ({ clean: {} }))

/** いまのルートのオブジェクトを「変更なし」として覚える（読み込んだ直後・書き出した直後） */
export function markClean(route: RouteData) {
  useCleanStore.setState((s) => ({ clean: { ...s.clean, [route.id]: route } }))
}

export function forgetClean(routeId: string) {
  useCleanStore.setState((s) => {
    const next = { ...s.clean }
    delete next[routeId]
    return { clean: next }
  })
}

export function isRouteDirty(route: RouteData, clean: Record<string, RouteData> = useCleanStore.getState().clean): boolean {
  return clean[route.id] !== route
}
