import { kml } from '@tmcw/togeojson'
import type { RouteData, Track, TrackPoint } from '@/types/route'
import type { FeatureCollection, LineString, MultiLineString, Point } from 'geojson'

interface FeatureTracks {
  name?: string
  tracks: Track[]
}

export function parseKml(text: string, fileName: string): RouteData[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')

  // DOMParser は不正XMLでも例外を投げず <parsererror> 要素を返すため、明示的に検査する（基本設計書16.2）
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`KMLの解析に失敗しました（不正なXML）: ${parseError.textContent?.trim().slice(0, 120) ?? ''}`)
  }

  const geojson = kml(doc) as FeatureCollection

  const featureGroups: FeatureTracks[] = []
  const standaloneWaypoints: RouteData['standaloneWaypoints'] = []

  geojson.features.forEach((feature) => {
    const name = (feature.properties?.name as string | undefined) ?? undefined
    const timeArr: string[] = feature.properties?.coordTimes ?? []

    if (feature.geometry.type === 'LineString') {
      const geom = feature.geometry as LineString
      const points: TrackPoint[] = geom.coordinates.map((coord, i) => {
        const pt: TrackPoint = { lat: coord[1], lng: coord[0] }
        if (coord[2] != null) pt.ele = coord[2]
        if (timeArr[i]) pt.time = new Date(timeArr[i])
        return pt
      })
      // Placemark（Feature）1つ = ルート1つとして扱う（複数Placemarkを1ルートに束ねない）
      featureGroups.push({ name, tracks: [{ name, points }] })
    } else if (feature.geometry.type === 'MultiLineString') {
      const geom = feature.geometry as MultiLineString
      const tracks: Track[] = geom.coordinates.map((line, segIdx) => {
        const times: string[] = Array.isArray(timeArr[0]) ? (timeArr[segIdx] as unknown as string[]) : timeArr
        const points: TrackPoint[] = line.map((coord, i) => {
          const pt: TrackPoint = { lat: coord[1], lng: coord[0] }
          if (coord[2] != null) pt.ele = coord[2]
          if (times[i]) pt.time = new Date(times[i])
          return pt
        })
        return { name, points }
      })
      featureGroups.push({ name, tracks })
    } else if (feature.geometry.type === 'Point') {
      const geom = feature.geometry as Point
      standaloneWaypoints.push({
        lat: geom.coordinates[1],
        lng: geom.coordinates[0],
        ele: geom.coordinates[2] ?? undefined,
        name,
        desc: feature.properties?.description as string | undefined,
      })
    }
  })

  const baseName = fileName.replace(/\.kml$/i, '')

  // ラインが1本もなければ、この KML はウェイポイント（Point）のみのファイル
  if (featureGroups.length === 0) {
    return [{
      id: crypto.randomUUID(),
      name: baseName,
      sourceFormat: 'kml',
      sourceFileName: fileName,
      kind: 'waypoint',
      tracks: [],
      standaloneWaypoints,
    }]
  }

  return featureGroups.map((group, i) => ({
    id: crypto.randomUUID(),
    name: group.name ?? (featureGroups.length > 1 ? `${baseName} (${i + 1})` : baseName),
    sourceFormat: 'kml',
    sourceFileName: fileName,
    kind: 'track',
    tracks: group.tracks,
    standaloneWaypoints: i === 0 ? standaloneWaypoints : [],
  }))
}
