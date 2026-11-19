import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRouteStore } from '@/stores/routeStore'
import { computeRouteStats } from '@/lib/routeStats'

function fmtDuration(ms: number) {
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}時間${m}分${s}秒`
}

export default function StatsPanel() {
  const { routes, selectedRouteId } = useRouteStore(useShallow((s) => ({ routes: s.routes, selectedRouteId: s.selectedRouteId })))
  const route = routes.find((r) => r.id === selectedRouteId)

  const stats = useMemo(() => (route ? computeRouteStats(route) : null), [route])

  if (!route) {
    return <div className="p-4 text-xs text-[var(--color-muted)]">ルートを選択してください</div>
  }
  if (!stats || stats.pointCount === 0) {
    return <div className="p-4 text-xs text-[var(--color-muted)]">このルートにはポイントがありません</div>
  }

  return (
    <div className="p-3 text-xs">
      <h4 className="font-semibold mb-2 truncate">{route.name} の統計</h4>
      <table className="w-full">
        <tbody>
          <tr>
            <td className="text-[var(--color-muted)] pr-2 py-1">総距離</td>
            <td>{(stats.distanceM / 1000).toFixed(2)} km</td>
          </tr>
          <tr>
            <td className="text-[var(--color-muted)] pr-2 py-1">累積標高差</td>
            <td>↑{stats.gainM.toFixed(0)} m / ↓{stats.lossM.toFixed(0)} m</td>
          </tr>
          <tr>
            <td className="text-[var(--color-muted)] pr-2 py-1">最高標高 / 最低標高</td>
            <td>
              {stats.maxEle != null ? `${stats.maxEle.toFixed(0)} m` : '—'} /{' '}
              {stats.minEle != null ? `${stats.minEle.toFixed(0)} m` : '—'}
            </td>
          </tr>
          <tr>
            <td className="text-[var(--color-muted)] pr-2 py-1">総所要時間</td>
            <td>{stats.durationMs != null ? fmtDuration(stats.durationMs) : '—（時刻データなし）'}</td>
          </tr>
          <tr>
            <td className="text-[var(--color-muted)] pr-2 py-1">平均速度 / 最高速度</td>
            <td>
              {stats.avgSpeedKmh != null ? `${stats.avgSpeedKmh.toFixed(1)} km/h` : '—'} /{' '}
              {stats.maxSpeedKmh != null ? `${stats.maxSpeedKmh.toFixed(1)} km/h` : '—'}
            </td>
          </tr>
          <tr>
            <td className="text-[var(--color-muted)] pr-2 py-1">トラックポイント総数</td>
            <td>{stats.pointCount.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
