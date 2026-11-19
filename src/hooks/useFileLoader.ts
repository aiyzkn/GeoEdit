import { useCallback } from 'react'
import { useRouteStore } from '@/stores/routeStore'
import { isRouteDirty, markClean } from '@/lib/persistence/dirty'
import { useUiStore } from '@/stores/uiStore'
import { parseGpx } from '@/lib/parsers/gpxParser'
import { parseKml } from '@/lib/parsers/kmlParser'
import { parseGeoJson } from '@/lib/parsers/geojsonParser'
import { convertRouteKind, isRouteNameTaken, makeUniqueRouteName, dedupeConsecutivePoints } from '@/lib/editors/routeEditors'
import { fetchElevations } from '@/lib/elevationApi'
import type { RouteData } from '@/types/route'

async function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target!.result as string)
    reader.onerror = reject
    reader.readAsText(file, 'UTF-8')
  })
}

/**
 * 1ファイルから複数ルートが得られる場合がある（GeoJSON/KMLで複数Featureが
 * それぞれ独立したルートとして扱われるため）。GPXは1ファイル1ルート（複数トラック可）のまま。
 */
async function parseFile(file: File): Promise<RouteData[] | null> {
  const text = await readFile(file)
  const name = file.name.toLowerCase()
  if (name.endsWith('.gpx')) return [parseGpx(text, file.name)]
  if (name.endsWith('.kml')) return parseKml(text, file.name)
  if (name.endsWith('.geojson') || name.endsWith('.json')) return parseGeoJson(text, file.name)
  return null
}

/**
 * ファイルに標高データが1つも含まれていない場合、国土地理院APIから自動取得して補完する。
 * ルート表示を待たせないよう addRoute() 後に非同期・非ブロッキングで実行する。
 */
async function autoFillElevation(route: RouteData) {
  const pts = route.kind === 'waypoint' ? route.standaloneWaypoints : route.tracks.flatMap((t) => t.points)
  if (pts.length === 0 || pts.some((p) => p.ele != null)) return

  const { addToast } = useUiStore.getState()
  addToast('info', `標高データを自動取得中: ${route.name}`)
  const elevs = await fetchElevations(pts)
  let i = 0
  // 読み込んだままのルートなら、補完したあとも「変更なし」のまま（C2）
  const before = useRouteStore.getState().routes.find((r) => r.id === route.id)
  const wasClean = !!before && !isRouteDirty(before)
  useRouteStore.getState().updateRoute(route.id, (r) => {
    if (r.kind === 'waypoint') {
      r.standaloneWaypoints.forEach((w) => { const e = elevs[i++]; if (e != null) w.ele = e })
    } else {
      r.tracks.forEach((t) => t.points.forEach((p) => { const e = elevs[i++]; if (e != null) p.ele = e }))
    }
  })
  if (wasClean) {
    const after = useRouteStore.getState().routes.find((r) => r.id === route.id)
    if (after) markClean(after)
  }
  const filled = elevs.filter((e) => e != null).length
  addToast('success', `標高データを自動補完しました（${route.name}）: ${filled}/${pts.length} ポイント`)
}

export function useFileLoader() {
  const addRoute = useRouteStore((s) => s.addRoute)
  const { addToast } = useUiStore()

  const loadFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files)
    const openAsKind = useUiStore.getState().openAsKind
    for (const file of arr) {
      try {
        const parsedRoutes = await parseFile(file)
        if (!parsedRoutes) {
          addToast('error', `未対応のファイル形式: ${file.name}`)
          continue
        }

        let loadedCount = 0
        const renamed: string[] = []
        for (let route of parsedRoutes) {
          route = convertRouteKind(route, openAsKind)
          // 名前が既存ルートと衝突する場合は読み込みを拒否せず自動リネームする（要件定義書 4.2）。
          // 同一ファイル内の同名ルート同士（KML/GeoJSON で同じ name を持つ Feature が並ぶケース）も、
          // 別ファイル・同一ファイルの再読み込みによる衝突も区別せず、常に全件読み込む。
          if (isRouteNameTaken(useRouteStore.getState().routes, route.name)) {
            const original = route.name.trim()
            route = { ...route, name: makeUniqueRouteName(useRouteStore.getState().routes, route.name) }
            renamed.push(`${original} → ${route.name}`)
          }

          // 重複トラックポイント（同一座標・時刻）を除去（要件定義書 4.2）
          let dedupedCount = 0
          route.tracks = route.tracks.map((t) => {
            const deduped = dedupeConsecutivePoints(t.points)
            dedupedCount += t.points.length - deduped.length
            return { ...t, points: deduped }
          })
          if (dedupedCount > 0) {
            addToast('info', `重複ポイントを除去しました: ${dedupedCount} 点`)
          }

          if (route.tracks.length === 0 && route.standaloneWaypoints.length === 0) {
            addToast('warning', `ルートポイントが見つかりません: ${route.name}`)
          }
          addRoute(route)
          const stored = useRouteStore.getState().routes.find((r) => r.id === route.id)
          if (stored) markClean(stored) // 読み込んだ直後は「変更なし」（C2）
          loadedCount++
          void autoFillElevation(route)
        }

        if (renamed.length > 0) {
          const head = renamed.slice(0, 3).join('、')
          addToast('info', renamed.length > 3
            ? `同名ルートを自動リネームしました（${renamed.length} 件）: ${head} ほか`
            : `同名ルートを自動リネームしました: ${head}`)
        }

        if (loadedCount > 0) {
          addToast('success', parsedRoutes.length > 1
            ? `読み込み完了: ${file.name}（${loadedCount} ルート）`
            : `読み込み完了: ${file.name}`)
        }
      } catch (e) {
        addToast('error', `読み込みエラー: ${file.name} — ${(e as Error).message}`)
      }
    }
  }, [addRoute, addToast])

  const openFiles = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.gpx,.kml,.geojson,.json'
    input.multiple = true
    input.onchange = () => {
      if (input.files) loadFiles(input.files)
    }
    input.click()
  }, [loadFiles])

  return { loadFiles, openFiles }
}
