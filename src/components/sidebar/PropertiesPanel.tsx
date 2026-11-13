import { useMemo } from 'react'
import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import type { RouteKind } from '@/types/route'
import { haversineM } from '@/lib/geometry'

function fmt6(n: number) {
  return n.toFixed(6)
}
function fmtTime(d?: Date) {
  if (!d) return '—'
  return d.toLocaleTimeString('ja-JP', { hour12: false })
}
function fmtDate(d?: Date) {
  if (!d) return '—'
  return d.toLocaleDateString('ja-JP')
}
function toTimeInputValue(d?: Date) {
  if (!d) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
const KIND_LABEL: Record<RouteKind, string> = { track: 'トラック (<trk>)', route: 'ルート (<rte>)', waypoint: 'ウェイポイント (<wpt>)' }

export default function PropertiesPanel() {
  const { routes, selectedRouteId, selectedTrackIndex, selectedPointIndex, updateRoute } = useRouteStore()
  const { pushUndo } = useEditorStore()
  const { addToast } = useUiStore()
  const route = routes.find((r) => r.id === selectedRouteId)

  const track = route?.tracks[selectedTrackIndex]
  // 間引き・区間削除等でポイント数が減った直後は selectedPointIndex が範囲外になりうる
  // （編集前に選択していたインデックスがそのまま残るため）。範囲外なら未選択として扱う
  const hasValidSelection = track != null && selectedPointIndex != null && selectedPointIndex < track.points.length
  const point = hasValidSelection ? track.points[selectedPointIndex] : null

  // 累積距離・累積標高差（登り/下り）: トラック先頭から選択ポイントまで（要件定義書 7章）
  const cumStats = useMemo(() => {
    if (!track || selectedPointIndex == null || selectedPointIndex >= track.points.length) return null
    let dist = 0, gain = 0, loss = 0
    for (let i = 1; i <= selectedPointIndex; i++) {
      const a = track.points[i - 1]
      const b = track.points[i]
      dist += haversineM(a.lat, a.lng, b.lat, b.lng)
      if (a.ele != null && b.ele != null) {
        const diff = b.ele - a.ele
        if (diff > 0) gain += diff
        else loss += -diff
      }
    }
    return { dist, gain, loss }
  }, [track, selectedPointIndex])

  const handleCommitElevation = (value: string) => {
    if (!route || !track || selectedPointIndex == null) return
    const ele = value.trim() === '' ? undefined : parseFloat(value)
    if (ele != null && isNaN(ele)) return
    const snapshot = useRouteStore.getState().routes
    pushUndo('ポイント標高変更', snapshot)
    updateRoute(route.id, (r) => {
      const p = r.tracks[selectedTrackIndex]?.points[selectedPointIndex]
      if (!p) return
      p.ele = ele
    })
  }

  const handleCommitTime = (value: string) => {
    if (!route || !track || !point?.time || selectedPointIndex == null || !value) return
    const [hh, mm, ss] = value.split(':').map(Number)
    if ([hh, mm, ss].some((n) => isNaN(n))) return
    const newDate = new Date(point.time)
    newDate.setHours(hh, mm, ss, 0)
    const prev = selectedPointIndex > 0 ? track.points[selectedPointIndex - 1] : undefined
    const next = selectedPointIndex < track.points.length - 1 ? track.points[selectedPointIndex + 1] : undefined
    if ((prev?.time && newDate < prev.time) || (next?.time && newDate > next.time)) {
      addToast('warning', '前後のポイントと時刻の順序が逆転しています')
    }
    const snapshot = useRouteStore.getState().routes
    pushUndo('ポイント時刻変更', snapshot)
    updateRoute(route.id, (r) => {
      const p = r.tracks[selectedTrackIndex]?.points[selectedPointIndex]
      if (!p) return
      p.time = newDate
    })
  }

  if (!route) {
    return <div className="p-4 text-xs text-[var(--color-muted)]">ルートを選択してください</div>
  }

  return (
    <div className="p-3 space-y-3 text-xs">
      <section>
        <h4 className="font-semibold mb-1">ルート情報</h4>
        <table className="w-full">
          <tbody>
            <tr>
              <td className="text-[var(--color-muted)] pr-2">名前</td>
              <td className="truncate">{route.name}</td>
            </tr>
            <tr>
              <td className="text-[var(--color-muted)] pr-2">形式</td>
              <td>{route.sourceFormat.toUpperCase()}</td>
            </tr>
            <tr>
              <td className="text-[var(--color-muted)] pr-2">要素種別</td>
              <td>{KIND_LABEL[route.kind]}</td>
            </tr>
            <tr>
              <td className="text-[var(--color-muted)] pr-2">トラック数</td>
              <td>{route.tracks.length}</td>
            </tr>
            {route.kind === 'waypoint' && (
              <tr>
                <td className="text-[var(--color-muted)] pr-2">ウェイポイント数</td>
                <td>{route.standaloneWaypoints.length}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {track && (
        <section>
          <h4 className="font-semibold mb-1">トラック [{selectedTrackIndex}]</h4>
          <table className="w-full">
            <tbody>
              <tr>
                <td className="text-[var(--color-muted)] pr-2">ポイント数</td>
                <td>{track.points.length.toLocaleString()}</td>
              </tr>
              {track.name && (
                <tr>
                  <td className="text-[var(--color-muted)] pr-2">名前</td>
                  <td className="truncate">{track.name}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {point && (
        <section>
          <h4 className="font-semibold mb-1">選択ポイント [{selectedPointIndex}]</h4>
          <table className="w-full">
            <tbody>
              <tr>
                <td className="text-[var(--color-muted)] pr-2">緯度</td>
                <td>{fmt6(point.lat)}</td>
              </tr>
              <tr>
                <td className="text-[var(--color-muted)] pr-2">経度</td>
                <td>{fmt6(point.lng)}</td>
              </tr>
              <tr>
                <td className="text-[var(--color-muted)] pr-2">標高</td>
                <td>
                  <input
                    key={`ele-${selectedPointIndex}-${point.ele ?? ''}`}
                    type="number"
                    step="0.1"
                    defaultValue={point.ele ?? ''}
                    placeholder="—"
                    onBlur={(e) => handleCommitElevation(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="w-20 px-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)]"
                  /> m
                </td>
              </tr>
              <tr>
                <td className="text-[var(--color-muted)] pr-2">日付</td>
                <td>{fmtDate(point.time)}</td>
              </tr>
              <tr>
                <td className="text-[var(--color-muted)] pr-2">時刻</td>
                <td>
                  {point.time ? (
                    <input
                      key={`time-${selectedPointIndex}-${toTimeInputValue(point.time)}`}
                      type="time"
                      step={1}
                      defaultValue={toTimeInputValue(point.time)}
                      onBlur={(e) => handleCommitTime(e.target.value)}
                      className="px-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)]"
                    />
                  ) : (
                    <span title="時刻データがないルートは「時間変更」モードで設定してください">{fmtTime(point.time)}</span>
                  )}
                </td>
              </tr>
              {cumStats && (
                <>
                  <tr>
                    <td className="text-[var(--color-muted)] pr-2">累積距離</td>
                    <td>{(cumStats.dist / 1000).toFixed(2)} km</td>
                  </tr>
                  <tr>
                    <td className="text-[var(--color-muted)] pr-2">累積標高差</td>
                    <td>↑{cumStats.gain.toFixed(0)}m / ↓{cumStats.loss.toFixed(0)}m</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
