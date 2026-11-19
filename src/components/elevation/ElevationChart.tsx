import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useShallow } from 'zustand/react/shallow'
import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore } from '@/stores/editorStore'
import { haversineM } from '@/lib/geometry'

export default function ElevationChart() {
  // ストア全体ではなく、使う値だけを購読する（ホバーのたびに、全点のグラフを描き直さないように。E3）
  const { routes, selectedRouteId, selectedTrackIndex, selectedPointIndex, selectPoint, hoverPoint } = useRouteStore(useShallow((s) => ({
    routes: s.routes, selectedRouteId: s.selectedRouteId, selectedTrackIndex: s.selectedTrackIndex,
    selectedPointIndex: s.selectedPointIndex, selectPoint: s.selectPoint, hoverPoint: s.hoverPoint,
  })))

  const mode = useEditorStore((s) => s.mode)
  const draftProfile = useEditorStore((s) => s.draftProfile)
  const autoEle = useEditorStore((s) => s.createAutoElevation)
  const setDraftHoverIndex = useEditorStore((s) => s.setDraftHoverIndex)
  // 作成モードで下書きが 2 点以上あれば、選択中のトラックの代わりに下書きの断面を描く（B5）
  const isDraft = (mode === 'create' || mode === 'reroute') && autoEle && !!draftProfile && draftProfile.points.length >= 2

  const route = routes.find((r) => r.id === selectedRouteId)
  const track = route?.tracks[selectedTrackIndex]
  const points: { lat: number; lng: number; ele?: number }[] = isDraft ? draftProfile!.points : (track?.points ?? [])

  const data = useMemo(() => {
    let cumDist = 0
    return points.map((pt, i) => {
      if (i > 0) {
        const prev = points[i - 1]
        cumDist += haversineM(prev.lat, prev.lng, pt.lat, pt.lng)
      }
      return {
        index: i,
        dist: Math.round(cumDist),
        ele: pt.ele ?? null,
      }
    })
  }, [points])

  const hasEle = data.some((d) => d.ele != null)
  if (!hasEle || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[10px] text-[var(--color-muted)]">
        標高データなし
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 4, right: 8, left: 4, bottom: 2 }}
        onMouseMove={(e) => {
          if (e.activePayload?.[0]) {
            if (isDraft) setDraftHoverIndex(e.activePayload[0].payload.index)
            else hoverPoint(e.activePayload[0].payload.index)
          }
        }}
        onMouseLeave={() => (isDraft ? setDraftHoverIndex(null) : hoverPoint(null))}
        onClick={(e) => {
          if (!isDraft && e.activePayload?.[0]) {
            selectPoint(e.activePayload[0].payload.index)
          }
        }}
      >
        <XAxis
          dataKey="dist"
          tickFormatter={(v) => `${(v / 1000).toFixed(1)}km`}
          tick={{ fontSize: 9 }}
          interval="preserveStartEnd"
        />
        <YAxis
          dataKey="ele"
          tick={{ fontSize: 9 }}
          width={36}
          tickFormatter={(v) => `${v}m`}
        />
        <Tooltip
          formatter={(v: number) => [`${v} m`, '標高']}
          labelFormatter={(label) => `${(label / 1000).toFixed(2)} km`}
          contentStyle={{ fontSize: 10 }}
        />
        <Area
          type="monotone"
          dataKey="ele"
          stroke="#3b82f6"
          fill="#3b82f680"
          dot={false}
          activeDot={{ r: 3 }}
          connectNulls
        />
        {!isDraft && selectedPointIndex != null && data[selectedPointIndex] && (
          <ReferenceLine x={data[selectedPointIndex].dist} stroke="#ef4444" strokeWidth={1.5} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}
