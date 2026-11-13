// マップマッチング（designs/マップマッチング設計書.md）の共通型定義。
// matcher.ts をユニットテスト（node --test）から直接 import できるよう、
// このディレクトリ内のモジュールは '@/' エイリアスを使わない。

/** 画素分類クラス。Uint8Array に格納するため数値定数で表現する */
export const BG = 0 // 背景（建物・市街地塗り・水域など道路以外すべて）
export const ROAD = 1 // 道路の塗り（一般道の白・国道・都道府県道・高速道路）
export const EDGE = 2 // 道路縁・鉄道等の中間グレー線（走査時の確定的な区切り）
export const IGNORE = 3 // 道路に被る注記文字・記号類（穴埋めで道路に吸収する対象）

export type PixelClass = typeof BG | typeof ROAD | typeof EDGE | typeof IGNORE

/** analyzePatch の結果。dx/dy はパッチ中心（クリック位置）からの補正量（px） */
export interface MatchOutcome {
  dx: number
  dy: number
  kind: 'road' | 'intersection' | 'none'
}

/** matchPoint の結果。マッチング不能時は入力座標がそのまま入る */
export interface MatchResult {
  lat: number
  lng: number
  matched: boolean
  kind: 'road' | 'intersection' | 'none'
}
