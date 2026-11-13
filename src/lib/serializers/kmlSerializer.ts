import type { RouteData } from '@/types/route'

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function serializeKml(route: RouteData): string {
  let kml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  kml += `<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n`
  kml += `  <name>${escXml(route.name)}</name>\n`

  route.tracks.forEach((track, i) => {
    kml += `  <Placemark>\n`
    kml += `    <name>${escXml(track.name ?? `Track ${i + 1}`)}</name>\n`
    kml += `    <LineString>\n`
    kml += `      <tessellate>1</tessellate>\n`
    kml += `      <altitudeMode>clampToGround</altitudeMode>\n`
    kml += `      <coordinates>\n`
    track.points.forEach((pt) => {
      const z = pt.ele != null ? pt.ele : 0
      kml += `        ${pt.lng},${pt.lat},${z}\n`
    })
    kml += `      </coordinates>\n`
    kml += `    </LineString>\n`
    kml += `  </Placemark>\n`
  })

  route.standaloneWaypoints.forEach((wpt, i) => {
    const z = wpt.ele != null ? wpt.ele : 0
    kml += `  <Placemark>\n`
    kml += `    <name>${escXml(wpt.name ?? `Waypoint ${i + 1}`)}</name>\n`
    if (wpt.desc) kml += `    <description>${escXml(wpt.desc)}</description>\n`
    kml += `    <Point>\n`
    kml += `      <coordinates>${wpt.lng},${wpt.lat},${z}</coordinates>\n`
    kml += `    </Point>\n`
    kml += `  </Placemark>\n`
  })

  kml += `</Document>\n</kml>\n`
  return kml
}
