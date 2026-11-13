import type { RouteData, Track, TrackPoint } from '@/types/route'
import type { FeatureCollection, Feature, LineString, MultiLineString, Point, Geometry } from 'geojson'

function coordsToPoints(coords: number[][], times?: string[]): TrackPoint[] {
  return coords.map((coord, i) => {
    const pt: TrackPoint = { lat: coord[1], lng: coord[0] }
    if (coord[2] != null) pt.ele = coord[2]
    if (times?.[i]) pt.time = new Date(times[i])
    return pt
  })
}

interface FeatureTracks {
  name?: string
  tracks: Track[]
}

/**
 * 各 Feature を処理する。LineString/MultiLineString は featureGroups に1エントリとして積む
 * （1 Feature = 1 ルートとして扱うため。要件: 1ファイルに複数 Feature があっても1つに
 * まとめず、それぞれ別ルートとして読み込む）。Point は standaloneWaypoints にまとめて集約する。
 */
function processFeature(feature: Feature<Geometry>, featureGroups: FeatureTracks[], wpts: RouteData['standaloneWaypoints']) {
  const name = (feature.properties?.name as string | undefined) ?? undefined
  const times: string[] = feature.properties?.times ?? feature.properties?.coordTimes ?? []

  const geom = feature.geometry
  if (!geom) return

  if (geom.type === 'LineString') {
    const g = geom as LineString
    featureGroups.push({ name, tracks: [{ name, points: coordsToPoints(g.coordinates, times) }] })
  } else if (geom.type === 'MultiLineString') {
    const g = geom as MultiLineString
    // coordTimes/times は MultiLineString ではセグメント別（string[][]）の場合と全体共通（string[]）の
    // 場合がある。kmlParser と同じ方式でセグメントごとに時刻配列を選んで渡す（時刻欠落バグの修正）。
    const nested = Array.isArray((times as unknown[])[0])
    featureGroups.push({
      name,
      tracks: g.coordinates.map((line, segIdx) => {
        const segTimes = nested ? ((times as unknown as string[][])[segIdx] ?? []) : times
        return { name, points: coordsToPoints(line, segTimes) }
      }),
    })
  } else if (geom.type === 'Point') {
    const g = geom as Point
    wpts.push({
      lat: g.coordinates[1],
      lng: g.coordinates[0],
      ele: g.coordinates[2] ?? undefined,
      name,
      desc: feature.properties?.description as string | undefined,
    })
  }
}

export function parseGeoJson(text: string, fileName: string): RouteData[] {
  const data = JSON.parse(text)
  const featureGroups: FeatureTracks[] = []
  const standaloneWaypoints: RouteData['standaloneWaypoints'] = []

  if (data.type === 'FeatureCollection') {
    const fc = data as FeatureCollection
    fc.features.forEach((f) => processFeature(f as Feature<Geometry>, featureGroups, standaloneWaypoints))
  } else if (data.type === 'Feature') {
    processFeature(data as Feature<Geometry>, featureGroups, standaloneWaypoints)
  } else if (data.type === 'LineString' || data.type === 'MultiLineString' || data.type === 'Point') {
    processFeature({ type: 'Feature', geometry: data, properties: {} }, featureGroups, standaloneWaypoints)
  }

  const baseName = fileName.replace(/\.geojson$/i, '').replace(/\.json$/i, '')

  // ライン系 Feature が1つもない場合は、従来通りウェイポイントのみの単一ルートとして返す
  if (featureGroups.length === 0) {
    return [{
      id: crypto.randomUUID(),
      name: baseName,
      sourceFormat: 'geojson',
      sourceFileName: fileName,
      kind: 'waypoint',
      tracks: [],
      standaloneWaypoints,
    }]
  }

  return featureGroups.map((group, i) => ({
    id: crypto.randomUUID(),
    name: group.name ?? (featureGroups.length > 1 ? `${baseName} (${i + 1})` : baseName),
    sourceFormat: 'geojson',
    sourceFileName: fileName,
    kind: 'track',
    tracks: group.tracks,
    // ファイル内の単独ウェイポイント（Point Feature）は、先頭のルートにまとめて付与する
    standaloneWaypoints: i === 0 ? standaloneWaypoints : [],
  }))
}
