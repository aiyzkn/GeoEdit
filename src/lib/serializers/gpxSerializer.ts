import type { RouteData, TrackPoint, Waypoint } from '@/types/route'
import type { GpxOutputMode } from '@/types/editor'
import { APP_NAME } from '@/lib/version'

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isoTime(d: Date): string {
  return d.toISOString()
}

interface PointLike {
  lat: number
  lng: number
  ele?: number
  time?: Date
  name?: string
  cmt?: string
  desc?: string
  sym?: string
  _extensions?: string
}

function pointTag(tagName: 'trkpt' | 'rtept' | 'wpt', pt: PointLike, mode: GpxOutputMode): string {
  // 最小サイズ削減（緯度経度・標高・時刻のみに削減）の対象は trkpt/rtept のみ（要件定義書9.2）。
  // wpt は name/cmt/desc/sym を含めてこそ意味を持つ（特に kind='waypoint' では本体データ）ため、
  // minimal モードでもメタデータを削らず常に出力する。
  const minimal = (mode === 'minimal' || mode === 'minimal-no-wpt') && tagName !== 'wpt'
  let s = `    <${tagName} lat="${pt.lat}" lon="${pt.lng}">\n`
  if (pt.ele != null) s += `      <ele>${pt.ele.toFixed(2)}</ele>\n`
  if (pt.time) s += `      <time>${isoTime(pt.time)}</time>\n`
  if (!minimal) {
    if (pt.name) s += `      <name>${escXml(pt.name)}</name>\n`
    if (pt.cmt) s += `      <cmt>${escXml(pt.cmt)}</cmt>\n`
    if (pt.desc) s += `      <desc>${escXml(pt.desc)}</desc>\n`
    if (pt.sym) s += `      <sym>${escXml(pt.sym)}</sym>\n`
  }
  if (!minimal && pt._extensions) {
    s += `      <extensions>${pt._extensions}</extensions>\n`
  }
  s += `    </${tagName}>\n`
  return s
}

function trkptTag(pt: TrackPoint, mode: GpxOutputMode): string {
  return pointTag('trkpt', {
    lat: pt.lat, lng: pt.lng, ele: pt.ele, time: pt.time,
    name: pt.waypoint?.name, cmt: pt.waypoint?.cmt, desc: pt.waypoint?.desc, sym: pt.waypoint?.sym,
    _extensions: pt._extensions,
  }, mode)
}

function rteptTag(pt: TrackPoint, mode: GpxOutputMode): string {
  return pointTag('rtept', {
    lat: pt.lat, lng: pt.lng, ele: pt.ele, time: pt.time,
    name: pt.waypoint?.name, cmt: pt.waypoint?.cmt, desc: pt.waypoint?.desc, sym: pt.waypoint?.sym,
    _extensions: pt._extensions,
  }, mode)
}

function wptTag(wpt: Waypoint, mode: GpxOutputMode): string {
  return pointTag('wpt', { lat: wpt.lat, lng: wpt.lng, ele: wpt.ele, time: wpt.time, name: wpt.name, cmt: wpt.cmt, desc: wpt.desc, sym: wpt.sym }, mode)
}

export function serializeGpx(route: RouteData, mode: GpxOutputMode): string {
  // kind === 'waypoint' の場合、standaloneWaypoints はこのルートの本体データであり
  // 「wpt無」オプションで消してしまうと出力が空になるため、常に出力する。
  const includeWpt = route.kind === 'waypoint' || mode === 'original' || mode === 'minimal'
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<gpx version="1.1" creator="${APP_NAME}"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n`

  if (includeWpt) {
    route.standaloneWaypoints.forEach((wpt) => {
      xml += wptTag(wpt, mode)
    })
  }

  route.tracks.forEach((track) => {
    if (route.kind === 'route') {
      xml += `  <rte>\n`
      if (track.name) xml += `    <name>${escXml(track.name)}</name>\n`
      track.points.forEach((pt) => {
        xml += rteptTag(pt, mode)
      })
      xml += `  </rte>\n`
    } else {
      xml += `  <trk>\n`
      if (track.name) xml += `    <name>${escXml(track.name)}</name>\n`
      if (track.number != null) xml += `    <number>${track.number}</number>\n`
      xml += `    <trkseg>\n`
      track.points.forEach((pt) => {
        xml += trkptTag(pt, mode)
      })
      xml += `    </trkseg>\n`
      xml += `  </trk>\n`
    }
  })

  xml += `</gpx>\n`
  return xml
}
