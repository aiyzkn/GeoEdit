// タイルの属性 → 道路の階級（詳細設計書 §2.2）。
// 属性の意味は、地理院の「地物等の属性一覧」（https://maps.gsi.go.jp/help/pdf/vector/attribute.pdf）で確認した。
// rdCtg: 0 国道 / 1 都道府県道 / 2 市区町村道 / 3 高速自動車国道等 / 5 その他 / 6 不明
// motorway: 0 高速道路以外 / 1 高速道路 / 9 不明
// tollSect: 0 無料 / 1 有料 / 2 暫定無料 / 9 不明
// rnkWidth: 0 3m 未満 / 1 3〜5.5m / 2 5.5〜13m / 3 13〜19.5m / 4 19.5m 以上 / 5 その他 / 6 不明
// ftCode: 270x 通常部の道路、271x 庭園路、272x 徒歩道、273x 石段（下 1 桁 1 通常部 / 2 雪覆い / 3 橋・高架 / 4 トンネル）

import type { RoadClass } from './types.ts'

export interface RoadProps {
  ftCode?: unknown
  rdCtg?: unknown
  motorway?: unknown
  tollSect?: unknown
  rnkWidth?: unknown
  lvOrder?: unknown
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

/** 道路中心線でなければ 0 */
export function roadClassOf(p: RoadProps): RoadClass | 0 {
  const ft = num(p.ftCode)
  if (ft === undefined || ft < 2700 || ft > 2799) return 0
  const rdCtg = num(p.rdCtg)
  if (num(p.motorway) === 1 || rdCtg === 3) return 6
  if (num(p.tollSect) === 1) return 5
  if (ft >= 2710) return 1 // 庭園路・徒歩道・石段
  if (rdCtg === 0) return 4
  if (rdCtg === 1) return 3
  if (rdCtg === 2) return num(p.rnkWidth) === 0 ? 1 : 2 // 幅員 3 m 未満の市区町村道は里道（方針 Q4）
  return 1 // その他・不明
}

/** 0 通常部 / 1 雪覆い / 2 橋・高架 / 3 トンネル */
export function roadStructOf(p: RoadProps): number {
  const ft = num(p.ftCode) ?? 2701
  const d = ft % 10
  return d >= 1 && d <= 4 ? d - 1 : 0
}

export function roadLevelOf(p: RoadProps): number {
  const lv = num(p.lvOrder) ?? 0
  return lv >= 0 && lv <= 255 ? lv : 0
}
