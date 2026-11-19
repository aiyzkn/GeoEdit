import { useState } from 'react'
import { CONSTANT_KMH_LIMITS, type SpeedProfile } from '@/lib/editors/routeEditors'

interface Props {
  value: SpeedProfile
  onChange: (p: SpeedProfile) => void
}

/** 時刻の割り振りの速度（designs/機能追加・UI改善設計書.md B3）: 徒歩（傾斜を考慮）/ 一定 N km/h */
export default function SpeedSelect({ value, onChange }: Props) {
  const [kmhText, setKmhText] = useState(String(value.kind === 'constant' ? value.kmh : CONSTANT_KMH_LIMITS.default))
  const commitKmh = (text: string) => {
    const v = Number(text)
    const kmh = Number.isFinite(v) && text.trim() !== ''
      ? Math.min(CONSTANT_KMH_LIMITS.max, Math.max(CONSTANT_KMH_LIMITS.min, v))
      : CONSTANT_KMH_LIMITS.default
    setKmhText(String(kmh))
    onChange({ kind: 'constant', kmh })
  }
  return (
    <span className="flex items-center gap-1" title="時刻を割り振るときの速度">
      <span className="text-[var(--color-muted)]">速度:</span>
      <select
        aria-label="速度"
        value={value.kind}
        onChange={(e) => (e.target.value === 'walk' ? onChange({ kind: 'walk' }) : commitKmh(kmhText))}
        className="px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
      >
        <option value="walk">徒歩（傾斜を考慮）</option>
        <option value="constant">一定の速度</option>
      </select>
      {value.kind === 'constant' && (
        <>
          <input
            type="number"
            aria-label="一定の速度（km/h）"
            min={CONSTANT_KMH_LIMITS.min}
            max={CONSTANT_KMH_LIMITS.max}
            value={kmhText}
            onChange={(e) => setKmhText(e.target.value)}
            onBlur={(e) => commitKmh(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitKmh((e.target as HTMLInputElement).value) }}
            className="w-14 px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
          />
          <span>km/h</span>
        </>
      )}
    </span>
  )
}
