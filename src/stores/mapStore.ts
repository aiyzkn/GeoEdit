import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Map as LeafletMap } from 'leaflet'

interface ActiveOverlay {
  id: string
  opacity: number
}

interface MapState {
  mapInstance: LeafletMap | null
  baseLayerId: string
  activeOverlays: ActiveOverlay[]
  showElevation: boolean
}

interface MapActions {
  setMapInstance: (map: LeafletMap | null) => void
  setBaseLayer: (id: string) => void
  addOverlay: (id: string, opacity?: number) => void
  removeOverlay: (id: string) => void
  setOverlayOpacity: (id: string, opacity: number) => void
  toggleElevation: () => void
}

export const useMapStore = create<MapState & MapActions>()(
  immer((set) => ({
    mapInstance: null,
    baseLayerId: 'gsi-pale',
    activeOverlays: [],
    showElevation: true,

    setMapInstance: (map) =>
      set((state) => {
        state.mapInstance = map
      }),

    setBaseLayer: (id) =>
      set((state) => {
        state.baseLayerId = id
      }),

    addOverlay: (id, opacity = 0.4) =>
      set((state) => {
        if (!state.activeOverlays.find((o) => o.id === id)) {
          state.activeOverlays.push({ id, opacity })
        }
      }),

    removeOverlay: (id) =>
      set((state) => {
        state.activeOverlays = state.activeOverlays.filter((o) => o.id !== id)
      }),

    setOverlayOpacity: (id, opacity) =>
      set((state) => {
        const overlay = state.activeOverlays.find((o) => o.id === id)
        if (overlay) overlay.opacity = opacity
      }),

    toggleElevation: () =>
      set((state) => {
        state.showElevation = !state.showElevation
      }),
  }))
)
