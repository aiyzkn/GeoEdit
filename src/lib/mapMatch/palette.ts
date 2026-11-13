import { BG, ROAD, EDGE, IGNORE, type PixelClass } from './types.ts'

/**
 * 地理院タイル（標準・淡色）の画素分類テーブル。
 *
 * 色値は 2026-07-13 に実タイルの色ヒストグラムで実測した（設計書 §6.2 の校正手順）。
 * 校正タイル例:
 *   std/17/116426/51612（日本橋・国道1号）, std/17/116367/51631（環八・都道311号）,
 *   std/16/58145/25861（東名高速 海老名）, pale の同座標
 * 実測結果（主要色）:
 *   共通: 道路縁 #646464 / 注記黒 #000000 / 駅名等の緑注記 #005a3c /
 *         地下鉄等の青ライン #145aff / 行政界の金色破線 #c8a03c / 水域 #bed2ff
 *   std : 一般道 #ffffff / 国道 #ff7a7a / 都道府県道 #ffff00 / 高速 #64c373 /
 *         市街地塗り(z16) #ff874b（背景扱い。国道と近い色のため許容距離に注意）
 *   pale: 一般道・都道府県道 #ffffff / 国道 #ffdc96 / 高速 #78dca0 /
 *         市街地塗り(z16) #d2d2d2（背景扱い）
 * 地理院タイルのデザイン改定時はこの実測を再実施して更新すること。
 */

export type MatchableLayerId = 'gsi-std' | 'gsi-pale' | 'gsi-blank'

const MATCHABLE_LAYER_IDS: readonly string[] = ['gsi-std', 'gsi-pale', 'gsi-blank']

/** マップマッチング対象のベースレイヤーか（要件: 標準・淡色・白地図） */
export function isMatchableLayer(id: string): id is MatchableLayerId {
  return MATCHABLE_LAYER_IDS.includes(id)
}

/** 道路が描画されるレイヤーか。白地図は道路が無いため常にフォールバックとなる */
export function hasRoadPalette(id: MatchableLayerId): boolean {
  return id === 'gsi-std' || id === 'gsi-pale'
}

const dist2 = (r: number, g: number, b: number, R: number, G: number, B: number) =>
  (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * レイヤー共通の非道路要素の分類。該当しなければ null。
 * 判定順序に意味がある（濃色 → 青系ライン → 行政界 → グレー線の順で、
 * 道路塗り色の判定はこの後に各レイヤー側で行う）。
 */
function classifyCommon(r: number, g: number, b: number): PixelClass | null {
  const lum = luminance(r, g, b)
  // 注記文字・記号・鉄道の黒、駅名等の緑注記 #005a3c（lum≈69）。道路縁 #646464 は lum=100 でここに落ちない
  if (lum <= 95) return IGNORE
  // 地下鉄等の彩度の高い青ライン #145aff。水域 #bed2ff は min(r,g)=190 で除外される
  if (b >= 150 && b - Math.max(r, g) >= 60 && Math.min(r, g) < 150) return IGNORE
  // 行政界の金色破線 #c8a03c（道路上に重なって描かれるため無視対象）
  if (dist2(r, g, b, 200, 160, 60) <= 45 ** 2) return IGNORE
  // 道路縁 #646464 / 鉄道・建物輪郭等の中間グレー（#6d6d6d〜#b1b1b1 実測）。
  // 建物塗りの明るいグレー（#c4c4c4 以上）は背景として扱うため上限 190
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  if (mx - mn <= 16 && lum <= 190) return EDGE
  return null
}

/** 一般道の白（アンチエイリアスの #f5f5f5 前後まで許容） */
const isWhiteRoad = (r: number, g: number, b: number) => Math.min(r, g, b) >= 240

function classifyStd(r: number, g: number, b: number): PixelClass {
  if (isWhiteRoad(r, g, b)) return ROAD
  // 都道府県道の黄 #ffff00
  if (r >= 230 && g >= 230 && b <= 90) return ROAD
  // 国道 #ff7a7a。市街地塗り #ff874b（dist²=2378）を含めないよう許容距離は 35
  if (dist2(r, g, b, 255, 122, 122) <= 35 ** 2) return ROAD
  // 高速道路 #64c373
  if (dist2(r, g, b, 100, 195, 115) <= 40 ** 2) return ROAD
  return BG
}

function classifyPale(r: number, g: number, b: number): PixelClass {
  if (isWhiteRoad(r, g, b)) return ROAD
  // 国道 #ffdc96
  if (dist2(r, g, b, 255, 220, 150) <= 40 ** 2) return ROAD
  // 高速道路 #78dca0
  if (dist2(r, g, b, 120, 220, 160) <= 40 ** 2) return ROAD
  return BG
}

/** 1画素を分類する。白地図は道路が描画されないため全画素 BG（→常にフォールバック） */
export function classifyPixel(layerId: MatchableLayerId, r: number, g: number, b: number): PixelClass {
  if (layerId === 'gsi-blank') return BG
  const common = classifyCommon(r, g, b)
  if (common !== null) return common
  return layerId === 'gsi-std' ? classifyStd(r, g, b) : classifyPale(r, g, b)
}
