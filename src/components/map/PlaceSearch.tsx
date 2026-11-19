import { useState } from 'react'
import type L from 'leaflet'
import { Search, X } from 'lucide-react'
import { searchPlace, type GeocodeResult } from '@/lib/geocodeApi'
import { useUiStore } from '@/stores/uiStore'

interface Props {
  map: L.Map
}

export default function PlaceSearch({ map }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const { addToast } = useUiStore()

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setIsSearching(true)
    try {
      const found = await searchPlace(query.trim())
      setResults(found)
      if (found.length === 0) {
        addToast('info', '該当する地名が見つかりませんでした')
      }
    } catch {
      addToast('error', '地名検索に失敗しました（ネットワーク接続を確認してください）')
    } finally {
      setIsSearching(false)
    }
  }

  const handleJump = (result: GeocodeResult) => {
    map.setView([result.lat, result.lng], 15)
    setResults([])
  }

  return (
    <div className="absolute top-3 left-3 z-[1000] w-64">
      <form onSubmit={handleSearch} className="flex items-stretch shadow-lg rounded overflow-hidden border border-[var(--color-border)]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="地名・住所を検索"
          aria-label="地名・住所を検索"
          className="flex-1 px-2.5 py-1.5 text-xs bg-[var(--color-surface)] text-[var(--color-fg)] outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]) }}
            className="px-1.5 bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            title="クリア"
            aria-label="クリア"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="submit"
          disabled={isSearching}
          className="px-2.5 bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          title="検索"
          aria-label="検索"
        >
          <Search size={14} />
        </button>
      </form>
      {results.length > 0 && (
        <ul className="mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg max-h-56 overflow-y-auto">
          {results.map((r, i) => (
            <li key={i}>
              <button
                onClick={() => handleJump(r)}
                className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-[var(--color-border)] transition-colors truncate"
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
