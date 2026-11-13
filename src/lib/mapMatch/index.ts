import L from 'leaflet'
import { BASE_LAYERS } from '@/lib/tileLayers'
import { samplePatch } from './tileSampler.ts'
import { analyzePatch, PATCH_RADIUS } from './matcher.ts'
import { classifyPixel, hasRoadPalette, isMatchableLayer } from './palette.ts'
import type { MatchResult } from './types.ts'

export { isMatchModifierPressed } from './modifierKey.ts'
export type { MatchResult } from './types.ts'

/** マッチングを有効にする最小ズームレベル（設計書 §1.1、ヒアリング確定） */
export const MIN_MATCH_ZOOM = 15
/** タイル取得のタイムアウト。超過時はクリック座標にフォールバック */
const FETCH_TIMEOUT_MS = 1500

/**
 * クリック/ドロップ地点をタイル画像解析で道路中心・交差点重心へ補正する。
 * 前提条件（対象レイヤー・ズーム）を満たさない場合や解析失敗時は
 * 入力座標をそのまま返す（throw しない）。
 * マッチング ON/OFF（ストア）と修飾キーの判定は呼び出し側で行うこと。
 */
export async function matchPoint(params: {
  map: L.Map
  latlng: L.LatLng
  baseLayerId: string
  signal?: AbortSignal
}): Promise<MatchResult> {
  const { map, latlng, baseLayerId } = params
  const fallback: MatchResult = { lat: latlng.lat, lng: latlng.lng, matched: false, kind: 'none' }
  try {
    if (!isMatchableLayer(baseLayerId) || !hasRoadPalette(baseLayerId)) return fallback
    const layerDef = BASE_LAYERS.find((l) => l.id === baseLayerId)
    if (!layerDef?.url) return fallback
    const z = Math.round(map.getZoom())
    if (z < MIN_MATCH_ZOOM || z > (layerDef.maxZoom ?? 18)) return fallback

    const projected = map.project(latlng, z)
    const centerX = Math.round(projected.x)
    const centerY = Math.round(projected.y)
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout

    const patch = await samplePatch({ urlTemplate: layerDef.url, z, centerX, centerY, radius: PATCH_RADIUS, signal })

    const cls = new Uint8Array(patch.size * patch.size)
    for (let i = 0; i < cls.length; i++) {
      cls[i] = classifyPixel(baseLayerId, patch.data[i * 4], patch.data[i * 4 + 1], patch.data[i * 4 + 2])
    }
    const outcome = analyzePatch(cls, patch.size)
    if (outcome.kind === 'none') return fallback

    const snapped = map.unproject(L.point(centerX + outcome.dx, centerY + outcome.dy), z)
    console.debug(`[mapMatch] ${outcome.kind}: 変位 (${outcome.dx.toFixed(1)}, ${outcome.dy.toFixed(1)}) px`)
    return { lat: snapped.lat, lng: snapped.lng, matched: true, kind: outcome.kind }
  } catch (e) {
    console.debug('[mapMatch] 解析失敗のためクリック座標を使用:', e)
    return fallback
  }
}
