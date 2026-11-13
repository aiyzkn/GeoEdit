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

export function useFileExporter() {
  const { addToast } = useUiStore()

  const exportRoute = useCallback((route: RouteData, opts: ExportOptions, fileName?: string) => {
    try {
      // Windows/macOS/Linuxのファイルシステムで使用できない文字のみ置換する。
      // \w は日本語等の非ASCII文字にマッチしないため、それらを対象にすると日本語ファイル名が
      // アンダースコアだらけになってしまう（`[^\w\-. ]` は使わない）
      const baseName = (fileName || defaultExportFileName(route)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      if (opts.format === 'gpx') {
        const mode = opts.gpxMode ?? 'original'
        const text = serializeGpx(route, mode)
        download(text, `${baseName}.gpx`, 'application/gpx+xml')
      } else if (opts.format === 'geojson') {
        const text = serializeGeoJson(route)
        download(text, `${baseName}.geojson`, 'application/geo+json')
      } else if (opts.format === 'kml') {
        const text = serializeKml(route)
        download(text, `${baseName}.kml`, 'application/vnd.google-earth.kml+xml')
      }
      addToast('success', `エクスポート完了: ${baseName}.${opts.format}`)
    } catch (e) {
      addToast('error', `エクスポートエラー: ${(e as Error).message}`)
    }
  }, [addToast])

  return { exportRoute }
}
