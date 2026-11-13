import type { TileLayerDef } from '@/types/tile'

/**
 * ベースマップごとの「地図を操作できるズーム範囲」を決める。
 *
 * 以前は L.map() に minZoom/maxZoom を渡しておらず、Leaflet が地図に載っている全タイルレイヤー
 * （ベースマップ＋重ね合わせ）の範囲の和集合をズーム範囲にしていた。そのため
 *   - TileLayer の minZoom 既定値 0 により、提供されていないズーム（例: 白地図の 0〜4）まで縮小できる
 *   - maxZoom の大きい重ね合わせ（Google 等 20）を ON にすると、ベースマップの提供上限を超えて
 *     拡大でき、ベースマップが消えて真っ白になる
 *   - ベクトル地図（maxZoom を持たない）では拡大ボタンが無効にならない
 * と、ズームボタンの有効/無効と実際に表示できる範囲が一致していなかった。
 *
 * ここではベースマップのネイティブ範囲だけから地図のズーム範囲を決め、MapPane が
 * map.setMinZoom/setMaxZoom で明示的に設定する（重ね合わせは地図の範囲に影響させない）。
 */

/** minZoom/maxZoom 未指定時の既定値（tileLayers.ts のコメントと同じ） */
export const DEFAULT_MIN_ZOOM = 0
export const DEFAULT_MAX_ZOOM = 18

/**
 * 提供上限を超えて拡大表示（タイル画像を引き伸ばして表示）を許す段数。
 * 白地図（上限14）や英語地図（上限11）でもルート編集のために少し寄れるようにする。
 * 0 にすると、ズーム上限＝タイルの提供上限と完全に一致する。
 */
export const OVERZOOM_LEVELS = 2

/** 拡大表示を含めた地図全体のズーム上限 */
export const MAP_MAX_ZOOM_CAP = 20

export interface ZoomRange {
  /** 地図を縮小できる下限（＝タイルの提供下限。これより下はタイルが存在しない） */
  min: number
  /** 地図を拡大できる上限（提供上限＋拡大表示分） */
  max: number
  /** タイルの提供下限 */
  nativeMin: number
  /** タイルの提供上限。これを超えるズームでは nativeMax のタイルを引き伸ばして表示する */
  nativeMax: number
}

export function nativeZoomRange(def: Pick<TileLayerDef, 'minZoom' | 'maxZoom'>): { nativeMin: number; nativeMax: number } {
  return {
    nativeMin: def.minZoom ?? DEFAULT_MIN_ZOOM,
    nativeMax: def.maxZoom ?? DEFAULT_MAX_ZOOM,
  }
}

/**
 * ベースマップを選んだときの地図のズーム範囲。
 * ラスタは提供上限を超えると L.tileLayer の maxNativeZoom で引き伸ばし、
 * ベクトルはスタイルの source.maxzoom を超えると MapLibre が拡大描画するため、どちらも同じ規則でよい
 * （ベクトルの source.maxzoom が実際の提供上限と一致していることが前提。lib/gsiVectorStyle.ts 参照）。
 */
export function baseZoomRange(def: Pick<TileLayerDef, 'minZoom' | 'maxZoom' | 'type'>): ZoomRange {
  const { nativeMin, nativeMax } = nativeZoomRange(def)
  const max = Math.max(nativeMax, Math.min(nativeMax + OVERZOOM_LEVELS, MAP_MAX_ZOOM_CAP))
  return { min: nativeMin, max, nativeMin, nativeMax }
}

/** zoom をズーム範囲内に収める */
export function clampZoom(zoom: number, range: Pick<ZoomRange, 'min' | 'max'>): number {
  return Math.min(Math.max(zoom, range.min), range.max)
}

/** ベースマップ用 L.tileLayer のズーム関連オプション */
export function baseTileZoomOptions(def: Pick<TileLayerDef, 'minZoom' | 'maxZoom' | 'type'>) {
  const r = baseZoomRange(def)
  return { minZoom: r.min, maxZoom: r.max, maxNativeZoom: r.nativeMax }
}

/**
 * 重ね合わせ用 L.tileLayer のズーム関連オプション。
 * 提供上限より拡大した場合は引き伸ばして表示し続け（maxNativeZoom）、
 * 提供下限より縮小した場合は非表示にする（存在しないタイルへのリクエストを出さない）。
 */
export function overlayTileZoomOptions(def: Pick<TileLayerDef, 'minZoom' | 'maxZoom'>) {
  const { nativeMin, nativeMax } = nativeZoomRange(def)
  return { minZoom: nativeMin, maxZoom: Math.max(nativeMax, MAP_MAX_ZOOM_CAP), maxNativeZoom: nativeMax }
}

/** UI 表示用の短い説明（例: "ズーム 5〜16（15以上は拡大表示）"） */
export function describeZoomRange(r: ZoomRange): string {
  const base = `ズーム ${r.min}〜${r.max}`
  return r.max > r.nativeMax ? `${base}（${r.nativeMax + 1}以上は拡大表示）` : base
}
