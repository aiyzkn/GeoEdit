import type { StyleSpecification } from 'maplibre-gl'

export type TileType = 'raster' | 'vector'

export interface TileLayerDef {
  id: string
  label: string
  url?: string
  attribution: string
  maxZoom?: number
  minZoom?: number
  type: TileType
  noInvert?: boolean
  subdomains?: string | string[]
  tileSize?: number
  zoomOffset?: number
  style?: string | StyleSpecification
}

export interface OverlayLayerDef extends TileLayerDef {
  defaultOpacity: number
}
