export interface WaypointData {
  name?: string
  cmt?: string
  desc?: string
  sym?: string
}

export interface TrackPoint {
  lat: number
  lng: number
  ele?: number
  time?: Date
  waypoint?: WaypointData
  _extensions?: string
}

export interface Track {
  name?: string
  number?: number
  points: TrackPoint[]
}

/**
 * GPX (topografix.com/gpx.asp) の3種類の要素タイプ:
 * 'waypoint' = <wpt>（順序を持たない単独ポイント群）
 * 'route'    = <rte>（順序を持つ計画path、通常は時刻データなし）
 * 'track'    = <trk>（実際に記録された移動経路。デフォルト）
 */
export type RouteKind = 'waypoint' | 'route' | 'track'

/** 単独ウェイポイント（<wpt> 要素）。TrackPoint とは異なり座標そのものを保持する。 */
export interface Waypoint extends WaypointData {
  lat: number
  lng: number
  ele?: number
  time?: Date
}

export interface RouteData {
  id: string
  name: string
  sourceFormat: 'gpx' | 'kml' | 'geojson'
  sourceFileName: string
  kind: RouteKind
  tracks: Track[]
  standaloneWaypoints: Waypoint[]
  color?: string
}
