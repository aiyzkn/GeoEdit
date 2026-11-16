// 利用者ごと（ブラウザごと）の経路探索の設定（詳細設計書 §11）。純粋関数。保存・読み出しは呼ぶ側が行う。

import type { RoadClass, RoutingOptions, SearchParams } from './types.ts'

export type PriorityPreset = 'strong' | 'standard' | 'weak' | 'shortest' | 'custom'
/** 里道 / 市区町村道 / 県道 / 国道 / 有料 / 高速 の順 */
export type ClassWeights = [number, number, number, number, number, number]

export interface RoutingSettings {
  version: 1
  enabled: boolean
  avoidMotorway: boolean
  avoidToll: boolean
  preset: PriorityPreset
  weights: ClassWeights
  valleyPenaltyM: number
  snapRadiusM: number
  snapMotorwayBiasM: number
}

export const ROUTING_SETTINGS_KEY = 'geoedit-routing'

const PRESETS: Record<Exclude<PriorityPreset, 'custom'>, { weights: ClassWeights; valleyPenaltyM: number }> = {
  strong: { weights: [12, 6, 3.2, 2.0, 1.3, 1.0], valleyPenaltyM: 5000 },
  standard: { weights: [8, 4, 2.4, 1.6, 1.2, 1.0], valleyPenaltyM: 2000 },
  weak: { weights: [3, 2, 1.5, 1.25, 1.1, 1.0], valleyPenaltyM: 500 },
  shortest: { weights: [1, 1, 1, 1, 1, 1], valleyPenaltyM: 0 },
}

export const LIMITS = {
  weight: { min: 1, max: 20 },
  valleyPenaltyM: { min: 0, max: 20000 },
  snapRadiusM: { min: 5, max: 100 },
  snapMotorwayBiasM: { min: 0, max: 50 },
} as const

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  version: 1,
  enabled: true,
  avoidMotorway: false,
  avoidToll: false,
  preset: 'standard',
  weights: [...PRESETS.standard.weights] as ClassWeights,
  valleyPenaltyM: PRESETS.standard.valleyPenaltyM,
  snapRadiusM: 30,
  snapMotorwayBiasM: 15,
}

/** 谷の数え方（市区町村道より下は、市区町村道として数える）。利用者には変えさせない（§11.1） */
const VALLEY_FLOOR: RoadClass = 2
const MAX_EXPAND = 2_000_000

export function presetParams(preset: Exclude<PriorityPreset, 'custom'>): { weights: ClassWeights; valleyPenaltyM: number } {
  const p = PRESETS[preset]
  return { weights: [...p.weights] as ClassWeights, valleyPenaltyM: p.valleyPenaltyM }
}

function clampNum(v: unknown, lim: { min: number; max: number }, fallback: number, digits = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  const m = 10 ** digits
  return Math.round(Math.min(lim.max, Math.max(lim.min, v)) * m) / m
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** 壊れた・古い・範囲外の値は、項目ごとに既定値へ戻す */
export function sanitizeSettings(raw: unknown): RoutingSettings {
  const d = DEFAULT_ROUTING_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d, weights: [...d.weights] as ClassWeights }
  const r = raw as Record<string, unknown>
  if (r.version !== undefined && r.version !== 1) return { ...d, weights: [...d.weights] as ClassWeights }
  const preset: PriorityPreset = ['strong', 'standard', 'weak', 'shortest', 'custom'].includes(r.preset as string)
    ? (r.preset as PriorityPreset)
    : d.preset
  const rawW = Array.isArray(r.weights) && r.weights.length === 6 ? r.weights : d.weights
  const weights = rawW.map((w, i) => clampNum(w, LIMITS.weight, d.weights[i], 2)) as ClassWeights
  return {
    version: 1,
    enabled: bool(r.enabled, d.enabled),
    avoidMotorway: bool(r.avoidMotorway, d.avoidMotorway),
    avoidToll: bool(r.avoidToll, d.avoidToll),
    preset,
    weights,
    valleyPenaltyM: clampNum(r.valleyPenaltyM, LIMITS.valleyPenaltyM, d.valleyPenaltyM),
    snapRadiusM: clampNum(r.snapRadiusM, LIMITS.snapRadiusM, d.snapRadiusM),
    snapMotorwayBiasM: clampNum(r.snapMotorwayBiasM, LIMITS.snapMotorwayBiasM, d.snapMotorwayBiasM),
  }
}

export function maxClassOf(s: Pick<RoutingSettings, 'avoidMotorway' | 'avoidToll'>): RoadClass {
  if (s.avoidToll) return 4
  if (s.avoidMotorway) return 5
  return 6
}

export function resolveSearchParams(s: RoutingSettings): SearchParams {
  const { weights, valleyPenaltyM } = s.preset === 'custom' ? s : presetParams(s.preset)
  return {
    weight: [0, ...weights],
    valley: valleyPenaltyM,
    valleyFloor: VALLEY_FLOOR,
    maxClass: maxClassOf(s),
    maxExpand: MAX_EXPAND,
  }
}

export function resolveRoutingOptions(s: RoutingSettings): RoutingOptions {
  return {
    params: resolveSearchParams(s),
    snap: { radius: s.snapRadiusM, bias: s.snapMotorwayBiasM, maxClass: maxClassOf(s) },
  }
}
