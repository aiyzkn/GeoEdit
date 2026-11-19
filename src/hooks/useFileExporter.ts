import { useCallback } from 'react'
import { serializeGpx } from '@/lib/serializers/gpxSerializer'
import { serializeGeoJson } from '@/lib/serializers/geojsonSerializer'
import { serializeKml } from '@/lib/serializers/kmlSerializer'
import { useUiStore } from '@/stores/uiStore'
import type { RouteData } from '@/types/route'
import type { ExportOptions } from '@/types/editor'

function download(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 元ファイル名から拡張子を除いたベース名に "_ed" を付与したデフォルト出力名（要件定義書 9.3）。 */
export function defaultExportFileName(route: RouteData): string {
  const base = route.sourceFileName.replace(/\.[^./]+$/, '')
  return `${base}_ed`
}

const FORMAT_LABEL: Record<ExportOptions['format'], string> = { gpx: 'GPX', geojson: 'GeoJSON', kml: 'KML' }

/**
 * 出力する文字列を作る（保存とクリップボードへのコピーで同じものを出す。designs/機能追加・UI改善設計書.md E2）
 */
export function serializeRoute(route: RouteData, opts: ExportOptions): { text: string; mime: string; label: string } {
  if (opts.format === 'gpx') return { text: serializeGpx(route, opts.gpxMode ?? 'original'), mime: 'application/gpx+xml', label: FORMAT_LABEL.gpx }
  if (opts.format === 'geojson') return { text: serializeGeoJson(route), mime: 'application/geo+json', label: FORMAT_LABEL.geojson }
  return { text: serializeKml(route), mime: 'application/vnd.google-earth.kml+xml', label: FORMAT_LABEL.kml }
}

/** 1 KB 未満は B、それ以上は KB・MB（小数 1 桁） */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** これを超えるコピーは、押した時点で確かめる */
export const COPY_CONFIRM_BYTES = 2 * 1024 * 1024

export function useFileExporter() {
  const { addToast } = useUiStore()

  const exportRoute = useCallback((route: RouteData, opts: ExportOptions, fileName?: string) => {
    try {
      // Windows/macOS/Linuxのファイルシステムで使用できない文字のみ置換する。
      // \w は日本語等の非ASCII文字にマッチしないため、それらを対象にすると日本語ファイル名が
      // アンダースコアだらけになってしまう（`[^\w\-. ]` は使わない）
      const baseName = (fileName || defaultExportFileName(route)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      const { text, mime } = serializeRoute(route, opts)
      download(text, `${baseName}.${opts.format}`, mime)
      addToast('success', `エクスポート完了: ${baseName}.${opts.format}`)
    } catch (e) {
      addToast('error', `エクスポートエラー: ${(e as Error).message}`)
    }
  }, [addToast])

  /** クリップボードへコピーする。コピーしたら true */
  const copyRoute = useCallback(async (route: RouteData, opts: ExportOptions): Promise<boolean> => {
    let out: ReturnType<typeof serializeRoute>
    try {
      out = serializeRoute(route, opts)
    } catch (e) {
      addToast('error', `エクスポートエラー: ${(e as Error).message}`)
      return false
    }
    const bytes = new Blob([out.text]).size
    if (bytes > COPY_CONFIRM_BYTES) {
      const ok = await useUiStore.getState().confirm({
        title: '大きなデータのコピー',
        message: `約 ${(bytes / 1024 / 1024).toFixed(1)} MB あります。コピーしますか？`,
        actions: [
          { id: 'copy', label: 'コピーする', kind: 'primary' },
          { id: 'cancel', label: 'やめる' },
        ],
      })
      if (ok !== 'copy') return false
    }
    try {
      await navigator.clipboard.writeText(out.text)
      addToast('success', `${out.label} をコピーしました（${formatBytes(bytes)}）`)
      return true
    } catch {
      addToast('error', 'コピーできませんでした（ブラウザがクリップボードへの書き込みを許していません）')
      return false
    }
  }, [addToast])

  return { exportRoute, copyRoute }
}
