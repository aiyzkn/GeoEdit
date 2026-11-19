import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useRouteStore } from '@/stores/routeStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { haversineM } from '@/lib/geometry'
import type { TrackPoint } from '@/types/route'

const CARD_WIDTH = 148
const CARD_GAP = 4
const ROW_HEIGHT = 34
const ROW_GAP = 3
const FAST_STEP = 100

function fmtTime(d?: Date) {
  // 時刻データが無い場合は '--:--:--' で表示する（要件定義書 3.4）
  if (!d) return '--:--:--'
  return d.toLocaleTimeString('ja-JP', { hour12: false })
}

function fmtSpeed(distM: number, prev?: Date, curr?: Date) {
  if (!prev || !curr) return '—'
  const secs = (curr.getTime() - prev.getTime()) / 1000
  if (secs <= 0) return '—'
  return ((distM / secs) * 3.6).toFixed(1) + ' km/h'
}

interface TimelineCardProps {
  index: number
  pt: TrackPoint
  prevTime?: Date
  distM: number
  isSelected: boolean
  isMultiSelected: boolean
  isRangeMarker: boolean
  vertical: boolean
  style: React.CSSProperties
  onCardClick: (e: React.MouseEvent, index: number) => void
  onHoverEnter: (index: number) => void
  onHoverLeave: () => void
  onCommitLatLng: (index: number, field: 'lat' | 'lng', value: number) => void
}

/**
 * `React.memo` でカード単体を再レンダリング境界にする。スクロール中は親の `scrollIndex`
 * 更新で `VirtualTimeline` 自体は毎フレーム再実行されるが、各カードの props
 * （`pt` は immer の構造共有により未変更なら参照が同一）が変わらない限り実際の
 * DOM 差分計算はスキップされ、可視カード数十個ぶんの再レンダリングコストを避けられる。
 */
const TimelineCard = memo(function TimelineCard({
  index, pt, prevTime, distM, isSelected, isMultiSelected, isRangeMarker, vertical, style,
  onCardClick, onHoverEnter, onHoverLeave, onCommitLatLng,
}: TimelineCardProps) {
  const colorClass = isMultiSelected
    ? 'border-violet-500 bg-violet-500/20'
    : isRangeMarker
    ? 'border-red-600 bg-red-500/15'
    : isSelected
    ? 'border-blue-500 bg-blue-500/15'
    : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-muted)]'

  const latLngEditor = isSelected ? (
    <div className={vertical ? 'flex gap-1' : 'flex flex-col gap-0.5'} onClick={(e) => e.stopPropagation()}>
      <input
        key={`lat-${index}-${pt.lat}`}
        type="number"
        step="0.000001"
        defaultValue={pt.lat}
        onBlur={(e) => onCommitLatLng(index, 'lat', parseFloat(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`px-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[9px] font-mono ${vertical ? 'w-20' : 'w-full'}`}
      />
      <input
        key={`lng-${index}-${pt.lng}`}
        type="number"
        step="0.000001"
        defaultValue={pt.lng}
        onBlur={(e) => onCommitLatLng(index, 'lng', parseFloat(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`px-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[9px] font-mono ${vertical ? 'w-20' : 'w-full'}`}
      />
    </div>
  ) : (
    <div className={`font-mono text-[9px] ${vertical ? '' : 'leading-tight'}`}>
      {/* 緯度・経度は小数点6桁で表示（要件定義書 3.4） */}
      {vertical ? `${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}` : <>{pt.lat.toFixed(6)}<br />{pt.lng.toFixed(6)}</>}
    </div>
  )

  const distLabel = index > 0 ? (distM < 1000 ? `${distM.toFixed(0)} m` : `${(distM / 1000).toFixed(2)} km`) : null
  const speedLabel = prevTime && pt.time ? fmtSpeed(distM, prevTime, pt.time) : null

  if (vertical) {
    return (
      <div
        style={style}
        onClick={(e) => onCardClick(e, index)}
        onMouseEnter={() => onHoverEnter(index)}
        onMouseLeave={onHoverLeave}
        title="タップで選択。長押しではなくタップのみ（Shift/Ctrlクリックは非対応）"
        className={`mx-2 rounded border cursor-pointer transition-colors text-[10px] px-2 flex flex-row items-center gap-2 overflow-hidden ${colorClass}`}
      >
        <span className="font-mono text-[var(--color-muted)] font-semibold shrink-0">#{index}</span>
        <span className="font-mono shrink-0">{fmtTime(pt.time)}</span>
        <span className="shrink-0">{latLngEditor}</span>
        {pt.ele != null && <span className="font-mono shrink-0">{pt.ele.toFixed(0)}m</span>}
        {distLabel && <span className="font-mono text-[var(--color-muted)] shrink-0">{distLabel}</span>}
        {speedLabel && <span className="font-mono text-[var(--color-muted)] shrink-0">{speedLabel}</span>}
      </div>
    )
  }

  return (
    <div
      style={style}
      onClick={(e) => onCardClick(e, index)}
      onMouseEnter={() => onHoverEnter(index)}
      onMouseLeave={onHoverLeave}
      title="Shift+クリックで範囲選択、Ctrl+クリックで個別選択（複数選択して一括削除）"
      className={`h-[calc(100%-16px)] mx-1 rounded border cursor-pointer transition-colors text-[10px] p-1.5 flex flex-col gap-0.5 ${colorClass}`}
    >
      <div className="font-mono text-[var(--color-muted)] font-semibold">#{index}</div>
      <div className="font-mono">{fmtTime(pt.time)}</div>
      {latLngEditor}
      {pt.ele != null && <div className="font-mono">{pt.ele.toFixed(0)} m</div>}
      {distLabel && <div className="font-mono text-[var(--color-muted)]">{distLabel}</div>}
      {speedLabel && <div className="font-mono text-[var(--color-muted)]">{speedLabel}</div>}
    </div>
  )
})

export default function VirtualTimeline() {
  const containerRef = useRef<HTMLDivElement>(null)
  // ストア全体ではなく、使う値だけを購読する（ホバーのたびに描き直さないように。E3）
  const { routes, selectedRouteId, selectedTrackIndex, selectedPointIndex, selectPoint, hoverPoint, updateRoute } = useRouteStore(useShallow((s) => ({
    routes: s.routes, selectedRouteId: s.selectedRouteId, selectedTrackIndex: s.selectedTrackIndex,
    selectedPointIndex: s.selectedPointIndex, selectPoint: s.selectPoint, hoverPoint: s.hoverPoint, updateRoute: s.updateRoute,
  })))
  const { mode, selection, pushUndo, toggleDeleteRangeMarker } = useEditorStore()
  const { addToast } = useUiStore()
  const isVertical = useBreakpoint() === 'mobile'
  const [scrollIndex, setScrollIndex] = useState(0)
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set())
  const lastClickIndexRef = useRef<number | null>(null)

  const route = routes.find((r) => r.id === selectedRouteId)
  const track = route?.tracks[selectedTrackIndex]
  const points = track?.points ?? []

  // 隣接ポイント間の距離を points 変更時のみ計算し、スクロール中の再レンダリングで
  // 可視カードごとに haversine を再計算しないようにする（タイムライン60fps対策）
  const segDistances = useMemo(() => {
    const arr = new Array<number>(points.length)
    for (let i = 1; i < points.length; i++) {
      arr[i] = haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
    }
    return arr
  }, [points])

  // ルート・トラック切替時は複数選択をリセット（要件定義書12.3、タイムライン限定の一時状態）
  useEffect(() => {
    setMultiSelected(new Set())
    lastClickIndexRef.current = null
  }, [selectedRouteId, selectedTrackIndex])

  const handleCardClick = useCallback((e: React.MouseEvent, index: number) => {
    if (e.shiftKey && lastClickIndexRef.current != null) {
      const [lo, hi] = [lastClickIndexRef.current, index].sort((a, b) => a - b)
      setMultiSelected((prev) => {
        const next = new Set(prev)
        for (let i = lo; i <= hi; i++) next.add(i)
        return next
      })
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })
      lastClickIndexRef.current = index
      return
    }
    setMultiSelected(new Set())
    lastClickIndexRef.current = index
    selectPoint(index)
    if ((mode === 'deleteRange' || (mode === 'reroute' && useEditorStore.getState().draftTarget.kind !== 'replace')) && route) {
      toggleDeleteRangeMarker(route.id, selectedTrackIndex, index)
    }
  }, [mode, route, selectedTrackIndex, selectPoint, toggleDeleteRangeMarker])

  const handleBulkDelete = () => {
    if (!route || !track || multiSelected.size === 0) return
    if (multiSelected.size >= track.points.length) {
      addToast('error', 'トラック上の全ポイントは削除できません（最低1点を残してください）')
      return
    }
    const snapshot = useRouteStore.getState().routes
    pushUndo('タイムライン複数選択削除', snapshot)
    const indices = Array.from(multiSelected).sort((a, b) => b - a)
    updateRoute(route.id, (r) => {
      const pts = r.tracks[selectedTrackIndex]?.points
      if (!pts) return
      indices.forEach((idx) => pts.splice(idx, 1))
    })
    addToast('success', `${multiSelected.size} 点を削除しました`)
    setMultiSelected(new Set())
    lastClickIndexRef.current = null
  }

  const itemSize = isVertical ? ROW_HEIGHT + ROW_GAP : CARD_WIDTH + CARD_GAP

  const virtualizer = useVirtualizer({
    count: points.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => itemSize,
    horizontal: !isVertical,
    overscan: 10,
  })

  // 地図側でポイントが選択されたときも、タイムラインを対応するカードまでスクロールする
  useEffect(() => {
    if (selectedPointIndex == null) return
    virtualizer.scrollToIndex(selectedPointIndex, { align: 'center' })
  }, [selectedPointIndex, virtualizer])

  // scroll イベントは1フレームに何度も発火しうるため rAF で間引き、
  // タイムライン下部の位置表示・スライダー更新による再レンダリング頻度を抑える
  useEffect(() => {
    const el = containerRef.current
    if (!el || points.length === 0) return
    let rafId: number | null = null
    const handler = () => {
      lastScrollAt.current = performance.now()
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const scrollPos = isVertical ? el.scrollTop : el.scrollLeft
        const idx = Math.round(scrollPos / itemSize)
        setScrollIndex(Math.max(0, Math.min(idx, points.length - 1)))
      })
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [points.length, isVertical, itemSize])

  const jumpTo = (idx: number) => {
    if (points.length === 0) return
    const clamped = Math.max(0, Math.min(idx, points.length - 1))
    virtualizer.scrollToIndex(clamped, { align: 'start' })
    setScrollIndex(clamped)
  }

  // カードの React.memo が効くよう、関数は描き直しのたびに作り直さない（E3）
  const handleHoverLeave = useCallback(() => hoverPoint(null), [hoverPoint])
  // スクロール中は、カードがマウスの下を流れていくだけでホバーが起きる。そのたびに地図・グラフまで描き直すと
  // 重いので、スクロールが止まってから 150 ms はホバーを受けない（E3）
  const lastScrollAt = useRef(0)
  const handleHoverEnter = useCallback((index: number) => {
    if (performance.now() - lastScrollAt.current < 150) return
    hoverPoint(index)
  }, [hoverPoint])

  const handleCommitLatLng = useCallback((index: number, field: 'lat' | 'lng', value: number) => {
    if (!route || isNaN(value)) return
    const snapshot = useRouteStore.getState().routes
    pushUndo('ポイント座標変更', snapshot)
    updateRoute(route.id, (r) => {
      const p = r.tracks[selectedTrackIndex]?.points[index]
      if (!p) return
      if (field === 'lat') p.lat = value
      else p.lng = value
    })
  }, [route, selectedTrackIndex, pushUndo, updateRoute])

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-[var(--color-muted)]">
        {route ? 'トラックポイントがありません' : 'ルートを選択してください'}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div
        ref={containerRef}
        className={isVertical ? 'flex-1 overflow-y-auto overflow-x-hidden' : 'flex-1 overflow-x-auto overflow-y-hidden flex items-center'}
        style={{ scrollbarGutter: 'stable' }}
      >
        <div
          className={isVertical ? 'relative w-full' : 'relative flex items-center h-full'}
          style={isVertical ? { height: virtualizer.getTotalSize() + 8 } : { width: virtualizer.getTotalSize() + 16 }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const pt = points[item.index]
            const prev = item.index > 0 ? points[item.index - 1] : undefined
            const isSelected = selectedPointIndex === item.index
            const isMultiSelected = multiSelected.has(item.index)
            const isRangeMarker = (mode === 'deleteRange' || mode === 'reroute') && !!selection && selection.routeId === route?.id &&
              (item.index === selection.startIndex || item.index === selection.endIndex)

            return (
              <TimelineCard
                key={item.key}
                index={item.index}
                pt={pt}
                prevTime={prev?.time}
                distM={segDistances[item.index] ?? 0}
                isSelected={isSelected}
                isMultiSelected={isMultiSelected}
                isRangeMarker={isRangeMarker}
                vertical={isVertical}
                style={isVertical
                  ? { position: 'absolute', top: item.start, left: 0, right: 0, height: ROW_HEIGHT }
                  : { position: 'absolute', left: item.start, width: CARD_WIDTH }}
                onCardClick={handleCardClick}
                onHoverEnter={handleHoverEnter}
                onHoverLeave={handleHoverLeave}
                onCommitLatLng={handleCommitLatLng}
              />
            )
          })}
        </div>
      </div>

      {multiSelected.size > 0 && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--color-border)] shrink-0 bg-violet-500/10">
          <span className="text-[10px] text-[var(--color-muted)]">{multiSelected.size} 点選択中</span>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            <Trash2 size={11} />
            選択したポイントを削除
          </button>
          <button
            onClick={() => setMultiSelected(new Set())}
            className="px-2 py-0.5 rounded text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            選択解除
          </button>
        </div>
      )}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-[var(--color-border)] shrink-0">
        <button onClick={() => jumpTo(scrollIndex - FAST_STEP)} title={`${FAST_STEP}点戻る`} className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]">
          <ChevronsLeft size={13} />
        </button>
        <button onClick={() => jumpTo(scrollIndex - 1)} title="1点戻る" className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]">
          <ChevronLeft size={13} />
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(points.length - 1, 0)}
          value={scrollIndex}
          onChange={(e) => jumpTo(Number(e.target.value))}
          className="flex-1 h-1 accent-blue-600"
          title={`#${scrollIndex} / ${points.length - 1}`}
        />
        <button onClick={() => jumpTo(scrollIndex + 1)} title="1点進む" className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]">
          <ChevronRight size={13} />
        </button>
        <button onClick={() => jumpTo(scrollIndex + FAST_STEP)} title={`${FAST_STEP}点進む`} className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]">
          <ChevronsRight size={13} />
        </button>
        <span className="text-[9px] font-mono text-[var(--color-muted)] w-16 text-right shrink-0">
          {scrollIndex}/{points.length - 1}
        </span>
      </div>
    </div>
  )
}
