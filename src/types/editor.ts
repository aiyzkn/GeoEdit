import type { RouteData } from './route'

export type EditMode =
  | 'none'
  | 'create'
  | 'partialEdit'
  | 'split'
  | 'deleteRange'
  | 'merge'
  | 'thinOut'
  | 'timeEdit'
  | 'rename'
  | 'waypoint'
  | 'reverse'
  | 'elevReplace'
  | 'pointInfo'
  | 'export'

export interface UndoEntry {
  description: string
  snapshot: RouteData[]
}

export type GpxOutputMode = 'original' | 'minimal' | 'original-no-wpt' | 'minimal-no-wpt'

export interface ExportOptions {
  format: 'gpx' | 'geojson' | 'kml'
  gpxMode?: GpxOutputMode
  targetRouteId?: string
}

export interface SelectionRange {
  routeId: string
  trackIndex: number
  startIndex: number
  endIndex: number
}
