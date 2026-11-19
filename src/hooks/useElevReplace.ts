import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { fetchElevations } from '@/lib/elevationApi'
import { interpolateMissingElevations } from '@/lib/editors/routeEditors'

export function useElevReplace() {
  const { routes, selectedRouteId, selectedTrackIndex, updateRoute } = useRouteStore(useShallow((s) => ({ routes: s.routes, selectedRouteId: s.selectedRouteId, selectedTrackIndex: s.selectedTrackIndex, updateRoute: s.updateRoute })))
  const { pushUndo, setBusy } = useEditorStore()
  const { addToast } = useUiStore()

  // useFallback=true（デフォルト）: API がデータを返さなかった（null）ポイントは、前後の取得済み
  //   標高から距離比で補間した「代替値」で埋める（要件定義書 6.11。海・湖上や KML 補完で穴を埋める）。
  // useFallback=false: 代替値を使わず、API が返さなかったポイントは明示的にブランク（undefined）にする。
  const replaceElevations = useCallback(async (useFallback: boolean) => {
    const route = routes.find((r) => r.id === selectedRouteId)
    if (!route) { addToast('error', 'ルートを選択してください'); return }
    const track = route.tracks[selectedTrackIndex]
    if (!track) return

    pushUndo('標高置換', routes)
    setBusy(true)
    addToast('info', `標高取得中: ${track.points.length} ポイント`)

    const rawElevs = await fetchElevations(track.points)
    const finalElevs = useFallback ? interpolateMissingElevations(track.points, rawElevs) : rawElevs

    updateRoute(route.id, (r) => {
      r.tracks[selectedTrackIndex].points = r.tracks[selectedTrackIndex].points.map((pt, i) => {
        if (finalElevs[i] != null) return { ...pt, ele: finalElevs[i]! }
        return { ...pt, ele: undefined }
      })
    })

    setBusy(false)
    const fetched = rawElevs.filter((e) => e != null).length
    const filled = finalElevs.filter((e) => e != null).length
    addToast('success', useFallback && filled > fetched
      ? `標高置換完了: API取得 ${fetched} 点 + 補間 ${filled - fetched} 点 / 全 ${track.points.length} 点`
      : `標高置換完了: ${fetched}/${track.points.length} ポイント`)
  }, [routes, selectedRouteId, selectedTrackIndex, updateRoute, pushUndo, setBusy, addToast])

  return { replaceElevations }
}
