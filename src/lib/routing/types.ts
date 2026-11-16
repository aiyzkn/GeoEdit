// 経路探索（designs/経路探索詳細設計書.md）の共通の型。
// 単体テスト（node --test）から直接 import できるよう、このディレクトリ内のモジュールは
// '@/' エイリアスを使わず、相対パス + 拡張子 .ts で import する（mapMatch/ と同じ決まり）。

export interface LatLng {
  lat: number
  lng: number
}

/** 1 里道 / 2 市区町村道 / 3 県道 / 4 国道 / 5 有料道路 / 6 高速道路（詳細設計書 §2.2） */
export type RoadClass = 1 | 2 | 3 | 4 | 5 | 6

/** 道路の構造: 0 通常部 / 1 雪覆い / 2 橋・高架 / 3 トンネル（ftCode の下 1 桁 − 1） */
export const STRUCT_TUNNEL = 3

/** デコードして、タイル自身の範囲で切った z14 のタイルの道路中心線（§3.1） */
export interface RoadTile {
  x: number
  y: number
  count: number
  cls: Uint8Array
  lv: Uint8Array
  struct: Uint8Array
  /** [count + 1] coords の中の開始位置（点の番号） */
  start: Uint32Array
  /** [点の数 × 2] 世界座標（z14 のタイル番号 × 4096 + タイル内の座標）。x, y の順 */
  coords: Int32Array
}

/** 404 のタイルは null を返す */
export type TileBytesLoader = (x: number, y: number, signal?: AbortSignal) => Promise<ArrayBuffer | null>

/** 探索の値（§4.1）。weight の添字は RoadClass（0 は使わない） */
export interface SearchParams {
  weight: number[]
  valley: number
  valleyFloor: RoadClass
  maxClass: RoadClass
  maxExpand: number
}

export interface SnapParams {
  /** この距離（m）以内の道へ寄せる */
  radius: number
  /** 高速道路・トンネルを、この距離（m）だけ遠いものとして比べる */
  bias: number
  maxClass: RoadClass
}

/** 探索と寄せに渡す値。利用者の設定（settings.ts）から作る（§11.3） */
export interface RoutingOptions {
  params: SearchParams
  snap: SnapParams
}

/** 辺の上の位置。t は辺の a 端からの道のりの割合（0〜1） */
export interface GraphPos {
  edge: number
  t: number
  lat: number
  lng: number
}

export interface SearchStep {
  edge: number
  /** 辺の上の範囲。from > to なら b → a の向き */
  from: number
  to: number
}

export interface SearchResult {
  steps: SearchStep[]
  distance: number
  cost: number
  /** 罰則を払った回数（試験・調整用） */
  valleys: number
}

export type FallbackReason = 'no-road' | 'no-route' | 'too-long' | 'tile-error' | 'aborted'

export interface RouteResult {
  status: 'ok' | 'fallback'
  /** 両端を含む。先頭と末尾は入力の位置そのもの。fallback は 2 点 */
  points: LatLng[]
  distance: number
  reason?: FallbackReason
}
