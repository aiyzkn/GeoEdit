import type { RouteData } from '@/types/route'
import type { FeatureCollection, Feature, LineString, Point } from 'geojson'

export function serializeGeoJson(route: RouteData): string {
  const lineFeatures: Feature[] = route.tracks.map((track) => {
    const coords = track.points.map((pt) =>
      pt.ele != null ? [pt.lng, pt.lat, pt.ele] : [pt.lng, pt.lat]
    )
    const times = track.points.some((p) => p.time != null)
      ? track.points.map((p) => p.time?.toISOString() ?? null)
      : undefined

    const feature: Feature<LineString> = {
      type: 'Feature',
      properties: {
        name: track.name ?? route.name,
        ...(times ? { coordTimes: times } : {}),
      },
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
    }
    return feature
  })

  const pointFeatures: Feature[] = route.standaloneWaypoints.map((wpt) => {
    const feature: Feature<Point> = {
      type: 'Feature',
      properties: {
        name: wpt.name,
        ...(wpt.desc ? { description: wpt.desc } : {}),
      },
      geometry: {
        type: 'Point',
        coordinates: wpt.ele != null ? [wpt.lng, wpt.lat, wpt.ele] : [wpt.lng, wpt.lat],
      },
    }
    return feature
  })

  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: [...lineFeatures, ...pointFeatures],
  }

  return JSON.stringify(fc, null, 2)
}
