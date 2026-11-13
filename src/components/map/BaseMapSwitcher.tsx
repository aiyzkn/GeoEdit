import { useEffect, useRef, useState } from 'react'
import { Layers, Check } from 'lucide-react'
import { useMapStore } from '@/stores/mapStore'
import { BASE_LAYERS } from '@/lib/tileLayers'
import { baseZoomRange, describeZoomRange } from '@/lib/zoomRange'
import type { TileLayerDef } from '@/types/tile'

/**
 * 地図右上に常時表示するベースマップのクイック切替。
 *
 * 右サイドバー「レイヤー」タブにも同じ機能はあるが、
 *   - モバイル（<768px）ではサイドバー自体が非表示（基本設計書16.1）でベースマップを変更する手段がない
 *   - タブレットではヘッダーのトグルを開かないと見えない
 *   - PC でも 40 件以上のボタンが縦に並び、淡色・写真などの主要な地図を探しにくい
 * ため、どの画面幅でも地図上から 1〜2 クリックで切り替えられる UI を追加する。
 * 状態は mapStore.baseLayerId を共有するので、サイドバー側の選択表示とも常に同期する。
 */

/** クイック切替に並べる主要ベースマップ（BASE_LAYERS の id と短縮表示名）。 */
const QUICK_LAYERS: { id: string; short: string }[] = [
  { id: 'gsi-std', short: '標準' },
  { id: 'gsi-pale', short: '淡色' },
  { id: 'gsi-blank', short: '白地図' },
  { id: 'gsi-seamlessphoto', short: '航空写真' },
  { id: 'osm', short: 'OSM' },
  { id: 'esri-world-imagery', short: '衛星(Esri)' },
]

/** 「その他」のプルダウンで使うグループ分け（id の接頭辞で判定）。 */
function groupOf(layer: TileLayerDef): string {
  if (layer.id.startsWith('gsi-nendophoto')) return '年代別写真（国土地理院）'
  if (layer.id.startsWith('gsi')) return '国土地理院'
  if (layer.id.startsWith('osm')) return 'OpenStreetMap'
  if (layer.id.startsWith('esri')) return 'Esri'
  if (layer.id.startsWith('google')) return 'Google'
  return 'その他'
}

const GROUPED: [string, TileLayerDef[]][] = (() => {
  const map = new Map<string, TileLayerDef[]>()
  for (const layer of BASE_LAYERS) {
    const g = groupOf(layer)
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(layer)
  }
  return [...map.entries()]
})()

export default function BaseMapSwitcher() {
  const baseLayerId = useMapStore((s) => s.baseLayerId)
  const setBaseLayer = useMapStore((s) => s.setBaseLayer)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const current = BASE_LAYERS.find((l) => l.id === baseLayerId)
  const currentShort = QUICK_LAYERS.find((q) => q.id === baseLayerId)?.short ?? current?.label ?? ''
  const zoomText = current ? describeZoomRange(baseZoomRange(current)) : ''

  // パネル外をクリック／タップしたら閉じる
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      ref={rootRef}
      className="absolute top-3 right-3 z-[1000]"
      data-testid="basemap-switcher"
      onKeyDown={(e) => {
        // Esc はパネルを閉じるだけにし、編集モード解除などのグローバルショートカット（useKeyboard）には伝えない
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="ベースマップ切替"
        aria-expanded={open}
        title={`ベースマップ: ${current?.label ?? ''}（${zoomText}）`}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded shadow-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] text-xs hover:bg-[var(--color-border)] transition-colors"
      >
        <Layers size={16} />
        {/* 狭い画面では左上の地名検索と重ならないようアイコンのみ表示 */}
        <span className="hidden sm:inline max-w-40 truncate">{currentShort}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="ベースマップの選択"
          className="absolute right-0 top-full mt-1 w-60 p-2 rounded shadow-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] space-y-2"
        >
          <div className="grid grid-cols-3 gap-1">
            {QUICK_LAYERS.filter((q) => BASE_LAYERS.some((l) => l.id === q.id)).map((q) => {
              const active = q.id === baseLayerId
              return (
                <button
                  key={q.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setBaseLayer(q.id)
                    setOpen(false)
                  }}
                  className={`relative px-1 py-2 rounded text-xs border transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-500/20 text-blue-500 font-medium'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-border)]'
                  }`}
                >
                  {active && <Check size={10} className="absolute top-0.5 right-0.5" />}
                  {q.short}
                </button>
              )
            })}
          </div>

          <label className="block">
            <span className="block text-[10px] font-semibold text-[var(--color-muted)] mb-1">
              その他のベースマップ
            </span>
            <select
              value={baseLayerId}
              onChange={(e) => {
                setBaseLayer(e.target.value)
                setOpen(false)
              }}
              className="w-full px-1.5 py-1 rounded text-xs border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)]"
            >
              {GROUPED.map(([group, layers]) => (
                <optgroup key={group} label={group}>
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {/* 選択中のベースマップで操作できるズーム範囲（ズームボタンの有効/無効と一致） */}
          <p className="text-[10px] text-[var(--color-muted)] px-0.5" data-testid="basemap-zoom-range">
            {zoomText}
          </p>
        </div>
      )}
    </div>
  )
}
