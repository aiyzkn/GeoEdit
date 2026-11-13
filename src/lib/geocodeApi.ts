export interface GeocodeResult {
  title: string
  lat: number
  lng: number
}

interface GsiAddressSearchFeature {
  geometry: { coordinates: [number, number]; type: 'Point' }
  properties: { title: string; addressCode: string }
}

// 要件定義書12.2: 国土地理院ジオコーディングAPIによる地名検索
export async function searchPlace(query: string): Promise<GeocodeResult[]> {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`地名検索に失敗しました (HTTP ${res.status})`)
  const data: GsiAddressSearchFeature[] = await res.json()
  return data.map((f) => ({
    title: f.properties.title,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }))
}
