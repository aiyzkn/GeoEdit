import type { StyleSpecification } from 'maplibre-gl'

// 国土地理院ベクトルタイル実験提供（experimental_bvmap）は style.json が
// version/sources/layers を持つ完全な MapLibre スタイルではなく、GSI 独自の
// レイヤー定義形式（実際の描画には GSI 専用の合成ロジックが必要）だったため、
// 同じベクトルタイルデータソースを使い、道路・建物・水域・鉄道・ラベルの
// 基本レイヤーを自前で定義した簡易スタイルとして実装する
// （designs/実装チェックリスト.md 参照。実際のレイヤー名は tile を直接デコードして確認した:
//  building / label / symbol / elevation / road / railway / structurea / river / waterarea）
export const GSI_VECTOR_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    bvmap: {
      type: 'vector',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf'],
      // 提供ズームは 4〜16（ズーム17相当の情報は16のタイルに含まれ、オーバーズームで表示する仕様。
      // https://github.com/gsi-cyberjapan/gsimaps-vector-experiment ）。
      // 以前は maxzoom: 18 としていたため、存在しない z17 以上のタイルを要求して何も表示されなかった。
      // maxzoom を 16 にすると、MapLibre はそれより拡大したときに z16 のタイルを拡大描画する
      minzoom: 4,
      maxzoom: 16,
      attribution: '国土地理院ベクトルタイル提供実験',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f2f0e8' },
    },
    {
      id: 'waterarea',
      type: 'fill',
      source: 'bvmap',
      'source-layer': 'waterarea',
      paint: { 'fill-color': '#a8d4f0' },
    },
    {
      id: 'river',
      type: 'line',
      source: 'bvmap',
      'source-layer': 'river',
      paint: { 'line-color': '#5b9bd5', 'line-width': 1 },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'bvmap',
      'source-layer': 'building',
      paint: { 'fill-color': '#d9d3c5', 'fill-outline-color': '#c2b9a3' },
    },
    {
      id: 'structurea',
      type: 'fill',
      source: 'bvmap',
      'source-layer': 'structurea',
      paint: { 'fill-color': '#cfcfcf' },
    },
    {
      id: 'railway',
      type: 'line',
      source: 'bvmap',
      'source-layer': 'railway',
      paint: { 'line-color': '#6b6b6b', 'line-width': 1.2, 'line-dasharray': [2, 2] },
    },
    {
      id: 'road-outline',
      type: 'line',
      source: 'bvmap',
      'source-layer': 'road',
      paint: { 'line-color': '#b0aa9a', 'line-width': 2.6 },
    },
    {
      id: 'road',
      type: 'line',
      source: 'bvmap',
      'source-layer': 'road',
      paint: { 'line-color': '#ffffff', 'line-width': 2 },
    },
    {
      id: 'label',
      type: 'symbol',
      source: 'bvmap',
      'source-layer': 'label',
      layout: {
        'text-field': ['get', 'knj'],
        'text-size': 11,
        'text-font': ['Noto Sans Regular'],
      },
      paint: {
        'text-color': '#333333',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
      },
    },
  ],
}
