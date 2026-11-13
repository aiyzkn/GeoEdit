import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RouteData } from '@/types/route'

interface RouteState {
  routes: RouteData[]
  selectedRouteId: string | null
  selectedTrackIndex: number
  selectedPointIndex: number | null
  hoveredPointIndex: number | null
}

interface RouteActions {
  addRoute: (route: RouteData) => void
  removeRoute: (id: string) => void
  updateRoute: (id: string, updater: (route: RouteData) => void) => void
  setRoutes: (routes: RouteData[]) => void
  selectRoute: (id: string | null) => void
  selectTrack: (trackIndex: number) => void
  selectPoint: (index: number | null) => void
  hoverPoint: (index: number | null) => void
}

export const useRouteStore = create<RouteState & RouteActions>()(
  immer((set) => ({
    routes: [],
    selectedRouteId: null,
    selectedTrackIndex: 0,
    selectedPointIndex: null,
    hoveredPointIndex: null,

    addRoute: (route) =>
      set((state) => {
        state.routes.push(route)
        if (!state.selectedRouteId) {
          state.selectedRouteId = route.id
        }
      }),

    removeRoute: (id) =>
      set((state) => {
        state.routes = state.routes.filter((r) => r.id !== id)
        if (state.selectedRouteId === id) {
          state.selectedRouteId = state.routes[0]?.id ?? null
          state.selectedTrackIndex = 0
          state.selectedPointIndex = null
        }
      }),

    updateRoute: (id, updater) =>
      set((state) => {
        const route = state.routes.find((r) => r.id === id)
        if (route) updater(route)
      }),

    setRoutes: (routes) =>
      set((state) => {
        state.routes = routes
      }),

    selectRoute: (id) =>
      set((state) => {
        state.selectedRouteId = id
        state.selectedTrackIndex = 0
        state.selectedPointIndex = null
      }),

    selectTrack: (trackIndex) =>
      set((state) => {
        state.selectedTrackIndex = trackIndex
        state.selectedPointIndex = null
      }),

    selectPoint: (index) =>
      set((state) => {
        state.selectedPointIndex = index
      }),

    hoverPoint: (index) =>
      set((state) => {
        state.hoveredPointIndex = index
      }),
  }))
)
