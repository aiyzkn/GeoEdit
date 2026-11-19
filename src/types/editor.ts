import type { RouteData } from './route'
import type { FallbackReason } from '@/lib/routing/types'

/** 作成モードの区間の結び方（designs/経路探索詳細設計書.md §8.1） */
export type LegMode = 'auto' | 'straight'

/** 作成中のルートの通過点 */
export interface CreateAnchor {
  id: string
  lat: number
  lng: number
  /** 動かせない・消せない（既存ルートの点に固定。機能追加・UI改善設計書 B0） */
  locked?: boolean
}

/** 隣り合う 2 つの通過点の間 */
export interface CreateLeg {
  id: string
  mode: LegMode
  status: 'pending' | 'ok' | 'fallback'
  reason?: FallbackReason
  /** 両端を含む。pending の間は両端の 2 点 */
  points: { lat: number; lng: number }[]
  /** m */
  distance: number
  /** 探索を頼むたびに増やす。古い結果を捨てるため */
  gen: number
}

/** 下書きを確定したときの行き先（機能追加・UI改善設計書 B0） */
export type DraftTarget =
  | { kind: 'new' }
  | { kind: 'append'; routeId: string; trackIndex: number; end: 'tail' | 'head' }
  | { kind: 'replace'; routeId: string; trackIndex: number; startIndex: number; endIndex: number }

/** 作成中の下書き。legs[i] は anchors[i] → anchors[i + 1] */
export interface Draft {
  anchors: CreateAnchor[]
  legs: CreateLeg[]
}

export type EditMode =
  | 'none'
  | 'create'
  | 'reroute'
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
