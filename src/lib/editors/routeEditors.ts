import type { RouteData, RouteKind, Track, TrackPoint, Waypoint } from '@/types/route'
import { haversineM } from '@/lib/geometry'

/** ルート名が既存ルート（自分以外）と重複していないか判定する（要件定義書 4.2/6.1/6.3/13）。 */
export function isRouteNameTaken(routes: RouteData[], name: string, excludeId?: string): boolean {
  const trimmed = name.trim()
  return routes.some((r) => r.id !== excludeId && r.name === trimmed)
}

/**
 * 重複しないルート名を作る（要件定義書 4.2）。既存と重複する場合は ` (2)`, ` (3)` … を付ける。
 * 1ファイル内に同名ルートが複数含まれる場合の自動リネームに使う。
 * 既存の ` (n)` は剥がさない（`Trip (2019)` → `Trip (2020)` のような意味の変わるリネームを避けるため、
 * `Trip (2019) (2)` とする）。
 */
export function makeUniqueRouteName(routes: RouteData[], desiredName: string, excludeId?: string): string {
  const base = desiredName.trim()
  if (!isRouteNameTaken(routes, base, excludeId)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!isRouteNameTaken(routes, candidate, excludeId)) return candidate
  }
}

/**
 * 連続する重複トラックポイント（同一座標・同一時刻）を除去する（要件定義書 4.2）。
 * 隣り合う2点のみを比較する（非連続の同一座標は意図的な往復とみなし保持する）。
 */
export function dedupeConsecutivePoints(points: TrackPoint[]): TrackPoint[] {
  if (points.length === 0) return points
  const result: TrackPoint[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    const sameCoord = prev.lat === curr.lat && prev.lng === curr.lng
    const sameTime = (prev.time?.getTime() ?? null) === (curr.time?.getTime() ?? null)
    if (sameCoord && sameTime) continue
    result.push(curr)
  }
  return result
}

/**
 * Remove points between startIndex and endIndex (inclusive).
 */
export function deleteRange(points: TrackPoint[], start: number, end: number): TrackPoint[] {
  const s = Math.min(start, end)
  const e = Math.max(start, end)
  return [...points.slice(0, s), ...points.slice(e + 1)]
}

/**
 * Split track at splitIndex; returns [before, after].
 * The split point is included in both segments.
 */
export function splitTrack(points: TrackPoint[], splitIndex: number): [TrackPoint[], TrackPoint[]] {
  return [points.slice(0, splitIndex + 1), points.slice(splitIndex)]
}

/**
 * Reverse the order of points. Time data is cleared since a reversed
 * track's original timestamps would run backwards (要件定義書 6.10).
 */
export function reverseTrack(points: TrackPoint[]): TrackPoint[] {
  return [...points].reverse().map((p) => {
    if (p.time == null) return p
    const { time: _time, ...rest } = p
    return rest
  })
}

/**
 * Thin out points by keeping every nth point, always keeping first and last.
 */
export function thinOut(points: TrackPoint[], step: number): TrackPoint[] {
  if (step <= 1 || points.length <= 2) return points
  const result: TrackPoint[] = [points[0]]
  for (let i = step; i < points.length - 1; i += step) {
    result.push(points[i])
  }
  if (points.length > 1) result.push(points[points.length - 1])
  return result
}

/**
 * Thin out by distance threshold (meters).
 *
 * 間隔は「最後に残した点からの直線距離」ではなく、ポイント間距離の積算（トラックに沿った
 * 累積距離）で判断する（要件定義書 6.6・基本設計書 14.4）。累積距離が閾値に達するたびに
 * その点を残して累積をリセットするため、蛇行区間でも一定の道のり間隔で間引かれる。
 * ウェイポイント付きポイント・終点は常に残す（残った時点で累積をリセットする）。
 */
export function thinOutByDistance(points: TrackPoint[], minDistM: number): TrackPoint[] {
  if (points.length <= 2) return points

  const result: TrackPoint[] = [points[0]]
  let cumDist = 0
  for (let i = 1; i < points.length; i++) {
    cumDist += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
    if (cumDist >= minDistM || points[i].waypoint || i === points.length - 1) {
      result.push(points[i])
      cumDist = 0
    }
  }
  return result
}

/**
 * Redistribute timestamps using slope-based speed.
 * Speed table: slope (grade %) → speed (km/h)
 */
const SPEED_TABLE: Array<[number, number]> = [
  [-30, 1.5],
  [-20, 2.0],
  [-10, 3.5],
  [0, 4.0],
  [10, 3.0],
  [20, 2.2],
  [30, 1.5],
]

function interpolateSpeed(gradePercent: number): number {
  for (let i = 0; i < SPEED_TABLE.length - 1; i++) {
    const [g0, s0] = SPEED_TABLE[i]
    const [g1, s1] = SPEED_TABLE[i + 1]
    if (gradePercent >= g0 && gradePercent <= g1) {
      const t = (gradePercent - g0) / (g1 - g0)
      return s0 + t * (s1 - s0)
    }
  }
  if (gradePercent < SPEED_TABLE[0][0]) return SPEED_TABLE[0][1]
  return SPEED_TABLE[SPEED_TABLE.length - 1][1]
}

/**
 * Convert a route between the 3 GPX element kinds (waypoint / route / track).
 * - track <-> route: no data movement, only the `kind` tag changes (both are
 *   ordered path data stored in `tracks[].points`).
 * - -> waypoint: flattens every track's points into `standaloneWaypoints`
 *   (merged with any waypoints that already exist there), clears `tracks`.
 * - waypoint -> route/track: promotes `standaloneWaypoints` into a single
 *   new track, clears `standaloneWaypoints`.
 */
export function convertRouteKind(route: RouteData, kind: RouteKind): RouteData {
  if (route.kind === kind) return route

  if (kind === 'waypoint') {
    const flattened: Waypoint[] = route.tracks.flatMap((t) =>
      t.points.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        ele: p.ele,
        time: p.time,
        name: p.waypoint?.name,
        cmt: p.waypoint?.cmt,
        desc: p.waypoint?.desc,
        sym: p.waypoint?.sym,
      }))
    )
    return {
      ...route,
      kind,
      tracks: [],
      standaloneWaypoints: [...route.standaloneWaypoints, ...flattened],
    }
  }

  if (route.kind === 'waypoint') {
    const points: TrackPoint[] = route.standaloneWaypoints.map((w) => ({
      lat: w.lat,
      lng: w.lng,
      ele: w.ele,
      time: w.time,
      waypoint: (w.name || w.cmt || w.desc || w.sym) ? { name: w.name, cmt: w.cmt, desc: w.desc, sym: w.sym } : undefined,
    }))
    return {
      ...route,
      kind,
      tracks: points.length > 0 ? [{ name: route.name, points }] : route.tracks,
      standaloneWaypoints: [],
    }
  }

  // track <-> route: same ordered-points representation, just retag
  return { ...route, kind }
}

export function redistributeTime(points: TrackPoint[], startTime: Date): TrackPoint[] {
  if (points.length === 0) return points
  const result = structuredClone(points) as TrackPoint[]
  result[0].time = new Date(startTime)
  let currentMs = startTime.getTime()

  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1]
    const curr = result[i]
    const distM = haversineM(prev.lat, prev.lng, curr.lat, curr.lng)
    const elevDiff = (curr.ele ?? 0) - (prev.ele ?? 0)
    const grade = distM > 0 ? (elevDiff / distM) * 100 : 0
    const speedKmh = interpolateSpeed(grade)
    const durationMs = (distM / (speedKmh * 1000 / 3600)) * 1000
    currentMs += Math.round(durationMs)
    result[i].time = new Date(currentMs)
  }

  return result
}

/**
 * 開始・終了時刻の両方を指定して時刻を再配分する（要件定義書 6.7 一括再計算モード）。
 * 傾斜・距離ベースの相対配分（redistributeTime）を求めた後、合計時間が
 * endTime と一致するよう各区間の所要時間を比例スケーリングする。
 */
export function redistributeTimeWithRange(points: TrackPoint[], startTime: Date, endTime: Date): TrackPoint[] {
  const naive = redistributeTime(points, startTime)
  if (naive.length < 2) return naive
  const lastTime = naive[naive.length - 1].time
  if (!lastTime) return naive
  const naiveTotalMs = lastTime.getTime() - startTime.getTime()
  const targetTotalMs = endTime.getTime() - startTime.getTime()
  if (naiveTotalMs <= 0 || targetTotalMs <= 0) return naive

  const scale = targetTotalMs / naiveTotalMs
  return naive.map((p, i) => {
    if (i === 0 || !p.time) return p
    const offsetMs = p.time.getTime() - startTime.getTime()
    return { ...p, time: new Date(startTime.getTime() + Math.round(offsetMs * scale)) }
  })
}

/**
 * 日付のみ・開始時刻のみ・または両方を指定してすべてのポイントをシフトする
 * （要件定義書 6.7 シフトモード）。シフト後も秒の桁は元の値を維持する
 * （新しい開始時刻の分・時のみを変更し、秒はそのまま保持した上で一律オフセットを計算するため）。
 */
export function shiftTime(points: TrackPoint[], newDateStr?: string, newTimeStr?: string): TrackPoint[] {
  if (points.length === 0 || !points[0].time) return points
  const original = points[0].time
  const target = new Date(original)

  if (newDateStr) {
    const [y, m, d] = newDateStr.split('-').map(Number)
    target.setFullYear(y, m - 1, d)
  }
  if (newTimeStr) {
    const [hh, mm] = newTimeStr.split(':').map(Number)
    target.setHours(hh, mm)
  }

  const deltaMs = target.getTime() - original.getTime()
  if (deltaMs === 0) return points
  return points.map((p) => (p.time ? { ...p, time: new Date(p.time.getTime() + deltaMs) } : p))
}

/**
 * 結合（merge）モード用の3アルゴリズム（要件定義書 6.5）。2つのルートの
 * トラック配列を受け取り、結合後の新しいトラック配列を返す。
 * ルート内の複数トラックを1本化する場合は tracksB を空配列で呼ぶ。
 */

/** トラックを統合して結合: 全トラックの全ポイントを1本にまとめ時系列に並べ替える（時刻データ必須）。 */
export function mergeRoutesUnified(tracksA: Track[], tracksB: Track[]): Track[] {
  const allPoints = [...tracksA, ...tracksB].flatMap((t) => t.points)
  allPoints.sort((a, b) => (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0))
  return [{ points: allPoints }]
}

/** トラックを時系列で結合: トラック単位は保持しつつ、各トラックの開始時刻でトラックの並び順を決める（時刻データ必須）。 */
export function mergeRoutesChronological(tracksA: Track[], tracksB: Track[]): Track[] {
  const combined = [...tracksA, ...tracksB]
  combined.sort((a, b) => (a.points[0]?.time?.getTime() ?? 0) - (b.points[0]?.time?.getTime() ?? 0))
  return combined
}

/** トラックの単純接続: 順序を保持したまま単純連結する（時刻データ不要）。 */
export function mergeRoutesSimple(tracksA: Track[], tracksB: Track[]): Track[] {
  return [...tracksA, ...tracksB]
}

/**
 * 部分編集モード用: クリック地点付近のトラックポイントを中心に前後300点
 * （トラック全体が601点以下ならトラック全体）を編集範囲として抽出する（要件定義書 6.2）。
 */
export function extractPartialEditRange(points: TrackPoint[], centerIndex: number): { startIndex: number; points: TrackPoint[] } {
  if (points.length <= 601) {
    return { startIndex: 0, points: structuredClone(points) }
  }
  const start = Math.max(0, centerIndex - 300)
  const end = Math.min(points.length - 1, centerIndex + 300)
  return { startIndex: start, points: structuredClone(points.slice(start, end + 1)) }
}

/**
 * 部分編集: 青ライン上のクリック位置から、挿入すべきインデックスを推定する。
 * 各セグメント（隣接2点間）の中点とクリック地点の距離を比較し、最も近いセグメントの直後に挿入する。
 */
export function nearestSegmentInsertIndex(points: TrackPoint[], lat: number, lng: number): number {
  let bestIndex = 1
  let bestDist = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const midLat = (points[i].lat + points[i + 1].lat) / 2
    const midLng = (points[i].lng + points[i + 1].lng) / 2
    const d = haversineM(lat, lng, midLat, midLng)
    if (d < bestDist) { bestDist = d; bestIndex = i + 1 }
  }
  return bestIndex
}

/**
 * トラック名の複数行編集用フォーマット（要件定義書 6.8）。
 * 1行 = 1トラック、書式 `<name>名前<number>番号`（名前・番号ともブランク可）。
 */
export function trackToNameLine(t: Track): string {
  return `<name>${t.name ?? ''}<number>${t.number ?? ''}`
}

export function parseTrackNameLine(line: string): { name?: string; number?: number } {
  const m = line.match(/^<name>(.*?)<number>(.*)$/)
  if (!m) return {}
  const name = m[1].trim() || undefined
  const numStr = m[2].trim()
  const number = numStr ? parseInt(numStr, 10) : undefined
  return { name, number: number != null && isNaN(number) ? undefined : number }
}

/** 傾斜（勾配%）に基づく区間の所要時間（秒）。標高差と距離の両方を速度テーブル経由で反映する。 */
function segmentTimeCostSec(a: TrackPoint, b: TrackPoint): number {
  const distM = haversineM(a.lat, a.lng, b.lat, b.lng)
  if (distM === 0) return 0
  const grade = ((b.ele ?? 0) - (a.ele ?? 0)) / distM * 100
  const speedKmh = interpolateSpeed(grade)
  return distM / (speedKmh * 1000 / 3600)
}

/**
 * 部分編集: 補間ポイント挿入時の時刻を、前後ポイント間の「標高差・距離」で配分して求める
 * （要件定義書6.2）。距離比のみの線形補間ではなく、勾配ベースの速度モデル（redistributeTime と
 * 同じ SPEED_TABLE）で prev→新点・新点→next の所要時間比を求め、その比で prev.time〜next.time を配分する。
 * 挿入直後は newPoint.ele が未取得（標高APIは非同期取得）のため、前後標高から距離比で推定して用いる。
 */
export function interpolatePointTime(prev: TrackPoint, next: TrackPoint, newPoint: TrackPoint): Date | undefined {
  if (!prev.time || !next.time) return undefined

  let est = newPoint
  if (newPoint.ele == null && prev.ele != null && next.ele != null) {
    const totalDist = haversineM(prev.lat, prev.lng, next.lat, next.lng)
    const frac = totalDist > 0
      ? Math.min(1, Math.max(0, haversineM(prev.lat, prev.lng, newPoint.lat, newPoint.lng) / totalDist))
      : 0
    est = { ...newPoint, ele: prev.ele + (next.ele - prev.ele) * frac }
  }

  const costPrev = segmentTimeCostSec(prev, est)
  const costNext = segmentTimeCostSec(est, next)
  const total = costPrev + costNext
  if (total === 0) return new Date(prev.time.getTime())
  const fraction = Math.min(1, Math.max(0, costPrev / total))
  const ms = prev.time.getTime() + (next.time.getTime() - prev.time.getTime()) * fraction
  return new Date(ms)
}

/**
 * 標高置換モードの「代替値」算出（要件定義書 6.11）。API がデータを返さなかった（null）ポイントの
 * 標高を、前後の「取得済み」標高から累積距離比で線形補間して埋める。海・湖上など API に標高が無い
 * 区間や、標高データの無い KML への補完で穴を埋める用途。両側に取得済み点が無い端は最寄り値で
 * 水平外挿し、取得済み点が1つも無い（全点欠損）場合のみ null のままにする。
 * 補間のアンカーは常に API 取得値（引数 elevs）を用い、埋めた値を次の補間に使わない。
 */
export function interpolateMissingElevations(
  points: { lat: number; lng: number }[],
  elevs: (number | null)[],
): (number | null)[] {
  const n = points.length
  const cum = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
  }
  const result: (number | null)[] = elevs.slice()
  for (let i = 0; i < n; i++) {
    if (elevs[i] != null) continue
    let p = i - 1
    while (p >= 0 && elevs[p] == null) p--
    let q = i + 1
    while (q < n && elevs[q] == null) q++
    if (p >= 0 && q < n) {
      const span = cum[q] - cum[p]
      const t = span > 0 ? (cum[i] - cum[p]) / span : 0
      result[i] = elevs[p]! + (elevs[q]! - elevs[p]!) * t
    } else if (p >= 0) {
      result[i] = elevs[p]
    } else if (q < n) {
      result[i] = elevs[q]
    } else {
      result[i] = null
    }
  }
  return result
}
