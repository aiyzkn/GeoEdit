import { useRef, useState } from 'react'

interface Props {
  /** horizontal = 上下に動かす（下側のペインの高さ）、vertical = 左右に動かす（右側のパネルの幅） */
  orientation: 'horizontal' | 'vertical'
  /** いまの大きさ（px） */
  value: number
  min: number
  max: number
  /** 大きさを変える。ハンドルを上（左）へ動かすと大きくなる向き */
  onChange: (v: number) => void
  label: string
}

const KEY_STEP = 16

/**
 * ペインの境目のリサイズハンドル（designs/機能追加・UI改善設計書.md D5・D6）。
 * ポインターのイベント（マウス・タッチ・ペン）で動かし、矢印キーでも 16 px ずつ動く。
 * 見た目は 4 px の線、当たりは 8 px。広げた分は地図の側ではなく、下側・右側のペインの余白に重ねる
 * （地図の端のクリックを奪わないように）
 */
export default function ResizeHandle({ orientation, value, min, max, onChange, label }: Props) {
  const start = useRef<{ pos: number; value: number } | null>(null)
  const [active, setActive] = useState(false)
  const horizontal = orientation === 'horizontal'

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={label}
      className={`group relative shrink-0 flex touch-none outline-none z-20 ${horizontal ? 'h-2 -mb-1 flex-col cursor-row-resize' : 'w-2 -mr-1 flex-row cursor-col-resize'}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { pos: horizontal ? e.clientY : e.clientX, value }
        setActive(true)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const delta = start.current.pos - (horizontal ? e.clientY : e.clientX)
        onChange(Math.max(min, Math.min(max, start.current.value + delta)))
      }}
      onPointerUp={(e) => {
        start.current = null
        setActive(false)
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => { start.current = null; setActive(false) }}
      onKeyDown={(e) => {
        const grow = horizontal ? 'ArrowUp' : 'ArrowLeft'
        const shrink = horizontal ? 'ArrowDown' : 'ArrowRight'
        if (e.key === grow) { e.preventDefault(); onChange(Math.min(max, value + KEY_STEP)) }
        else if (e.key === shrink) { e.preventDefault(); onChange(Math.max(min, value - KEY_STEP)) }
      }}
    >
      <div
        className={`${horizontal ? 'h-1 w-full' : 'w-1 h-full'} bg-[var(--color-border)] group-hover:bg-blue-400 group-focus-visible:bg-blue-500 transition-colors ${active ? 'bg-blue-400' : ''}`}
      />
    </div>
  )
}
