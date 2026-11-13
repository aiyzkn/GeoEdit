import type { RouteData, Track, TrackPoint, Waypoint } from '@/types/route'

function parseStandaloneWaypoint(node: Element): Waypoint {
  const lat = parseFloat(node.getAttribute('lat') ?? '0')
  const lng = parseFloat(node.getAttribute('lon') ?? '0')
  const eleEl = node.querySelector('ele')
  const timeEl = node.querySelector('time')

  const w: Waypoint = { lat, lng }
  if (eleEl?.textContent) w.ele = parseFloat(eleEl.textContent)
  if (timeEl?.textContent) w.time = new Date(timeEl.textContent.trim())

  const name = node.querySelector('name')?.textContent?.trim()
  const cmt = node.querySelector('cmt')?.textContent?.trim()
  const desc = node.querySelector('desc')?.textContent?.trim()
  const sym = node.querySelector('sym')?.textContent?.trim()
  if (name) w.name = name
  if (cmt) w.cmt = cmt
  if (desc) w.desc = desc
  if (sym) w.sym = sym
  return w
}

function getExtensionsRaw(node: Element): string | undefined {
  const ext = node.querySelector('extensions')
  if (!ext) return undefined
  return ext.innerHTML.trim() || undefined
}

function parseTrackPoint(trkpt: Element): TrackPoint {
  const lat = parseFloat(trkpt.getAttribute('lat') ?? '0')
  const lng = parseFloat(trkpt.getAttribute('lon') ?? '0')
  const eleEl = trkpt.querySelector('ele')
  const timeEl = trkpt.querySelector('time')
  const nameEl = trkpt.querySelector('name')
  const cmtEl = trkpt.querySelector('cmt')
  const descEl = trkpt.querySelector('desc')
  const symEl = trkpt.querySelector('sym')

  const pt: TrackPoint = { lat, lng }
  if (eleEl?.textContent) pt.ele = parseFloat(eleEl.textContent)
  if (timeEl?.textContent) pt.time = new Date(timeEl.textContent.trim())

  const hasWpt = nameEl || cmtEl || descEl || symEl
  if (hasWpt) {
    pt.waypoint = {
      name: nameEl?.textContent?.trim(),
      cmt: cmtEl?.textContent?.trim(),
      desc: descEl?.textContent?.trim(),
      sym: symEl?.textContent?.trim(),
    }
  }

  const ext = getExtensionsRaw(trkpt)
  if (ext) pt._extensions = ext

  return pt
}

export function parseGpx(text: string, fileName: string): RouteData {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')

  // DOMParser は不正XMLでも例外を投げず <parsererror> 要素を返すため、明示的に検査して
  // エラーを送出する（useFileLoader の catch がエラートーストとして表示する。基本設計書16.2）
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`GPXの解析に失敗しました（不正なXML）: ${parseError.textContent?.trim().slice(0, 120) ?? ''}`)
  }

  const tracks: Track[] = []
  const standaloneWaypoints: Waypoint[] = []
  let hasTrk = false
  let hasRte = false

  // Parse standalone waypoints (<wpt>)
  doc.querySelectorAll('wpt').forEach((wpt) => {
    standaloneWaypoints.push(parseStandaloneWaypoint(wpt))
  })

  // Parse tracks (<trk>)
  doc.querySelectorAll('trk').forEach((trk) => {
    const name = trk.querySelector('name')?.textContent?.trim()
    const number = trk.querySelector('number')?.textContent
      ? parseInt(trk.querySelector('number')!.textContent!)
      : undefined

    trk.querySelectorAll('trkseg').forEach((seg) => {
      const points: TrackPoint[] = []
      seg.querySelectorAll('trkpt').forEach((pt) => {
        points.push(parseTrackPoint(pt))
      })
      if (points.length > 0) {
        hasTrk = true
        tracks.push({ name, number, points })
      }
    })
  })

  // Parse routes (<rte>) — same ordered-points shape as a track, kept in the
  // same `tracks` bucket; the distinction is preserved via `kind` below.
  doc.querySelectorAll('rte').forEach((rte) => {
    const name = rte.querySelector('name')?.textContent?.trim()
    const points: TrackPoint[] = []
    rte.querySelectorAll('rtept').forEach((pt) => {
      points.push(parseTrackPoint(pt))
    })
    if (points.length > 0) {
      hasRte = true
      tracks.push({ name, points })
    }
  })

  // 通常、作業軌跡は <trk> として記録される（要件定義書 4.2 / 基本設計書 9.1）。
  // <trk> が1つもなく <rte> のみの場合は 'route'、両方なければ 'waypoint'。
  const kind = hasTrk ? 'track' : hasRte ? 'route' : 'waypoint'

  return {
    id: crypto.randomUUID(),
    name: fileName.replace(/\.gpx$/i, ''),
    sourceFormat: 'gpx',
    sourceFileName: fileName,
    kind,
    tracks,
    standaloneWaypoints,
  }
}
