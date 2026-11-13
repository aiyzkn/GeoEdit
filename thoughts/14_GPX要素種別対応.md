# ターン 14：GPX 3要素種別（ウェイポイント／ルート／トラック）対応

**日時**: 2026-07-01  
**追加ファイル**: `src/lib/elevationApi.ts`（前ターンで既に存在）, `thoughts/14_GPX要素種別対応.md`  
**変更ファイル**: `src/types/route.ts`, `src/lib/parsers/gpxParser.ts`, `src/lib/parsers/kmlParser.ts`, `src/lib/parsers/geojsonParser.ts`, `src/lib/serializers/gpxSerializer.ts`, `src/lib/serializers/geojsonSerializer.ts`, `src/lib/serializers/kmlSerializer.ts`, `src/lib/editors/routeEditors.ts`, `src/stores/uiStore.ts`, `src/hooks/useFileLoader.ts`, `src/components/layout/AppHeader.tsx`, `src/components/sidebar/RouteList.tsx`, `src/components/sidebar/PropertiesPanel.tsx`, `src/components/map/RoutePolyline.tsx`, `src/components/properties/EditModePanel.tsx`（`kind`必須化対応）, `requirements/要件定義書.md`, `designs/基本設計書.md`, `designs/実装チェックリスト.md`, `src/lib/version.ts`

---

## ユーザーのプロンプト

```
次の機能を実装に追加してください。要件定義書、設計書、チェックリスト、thoughts/にも反映してください。

https://www.topografix.com/gpx.aspで定義されている、GPXのウェイポイント（<wpt>要素），ルート（<rte>要素），トラック（<trk>要素）の3種類の要素に関する機能追加。通常作業軌跡はトラックデータとして記録されます。

- 開いたローカルファイルを、3種類から指定した要素として開く機能
- リストにあるルートについて、3種類の要素を相互に変換する機能
```

---

## Claudeの思考

### 現状把握でわかった前提バグ

実装に入る前に既存コードを読み、以下の欠陥を発見した。これらは今回の機能の土台となるため、機能追加と同時に修正する必要があった。

1. **`WaypointData` に座標が無い** — `<wpt lat lon>` の座標を保持するフィールドが型に存在せず、`gpxParser.ts` の `parseWaypoint()` は `name`/`desc`/`sym` しか読み取っていなかった。読み込んだウェイポイントは常に原点(0,0)相当で失われていた。
2. **`<rte>` が `<trk>` と無区別** — `gpxParser.ts` は `<rte>` を解析して `tracks` 配列に押し込んでいたが、どちらの要素から来たかを示すフラグが無かった。
3. **KML/GeoJSON の Point ジオメトリが二重管理** — `standaloneWaypoints` に押し込みつつ「地図に表示されないと困るから」という理由で同じ点をもう一度単独トラックとしても追加する、という場当たり的な回避策がとられていた。
4. **KML シリアライザの Placemark に座標が無い** — `standaloneWaypoints` に座標が無かった（バグ1）ため、`<Point><coordinates>` を出力できず、名前だけの空 Placemark になっていた。
5. **GeoJSON シリアライザは `standaloneWaypoints` を一切出力しない**。

これらはユーザーが直接依頼した内容ではないが、「3種類の要素を正しく扱う」機能を実装する上で座標を保持できないウェイポイントでは成立しないため、土台修正として対応した。

### データモデルの設計判断

最大の設計判断は「`kind` ごとにポイントをどこに格納するか」。検討した2案:

**案A（棄却）**: `kind` はタグのみで、常に `tracks[].points` にポイントを置く。ウェイポイントは「順序を無視した track」として扱う。
- 利点: 変換が `{ ...route, kind }` だけで済み、実装が極小。
- 欠点: `standaloneWaypoints` という既存フィールドの意味が「主データ」と「trkに付随する補助POI」で二重化し、ドメインとして分かりにくい。GPX仕様の `<wpt>` は本来「座標を持つ独立要素」であり、それをわざわざ `tracks` 配列に格納するのは実装の都合を仕様に持ち込むことになる。

**案B（採用）**: `kind==='waypoint'` のときは `standaloneWaypoints` を本体データとして使い、`tracks` を空にする。相互変換時にポイントを両フィールド間で実際に移動する。
- 利点: GPX仕様の語彙（`<wpt>`＝座標付き独立点、`<trk>`/`<rte>`＝順序付きpath）とコード上のデータ構造が1対1で対応し、後から読むメンテナが仕様と実装を対比しやすい。既存の `standaloneWaypoints`（trk/rteに付随する補助POI）ともコンフリクトしない（変換時に統合される）。
- 欠点: 変換関数がやや複雑になる（ポイントの実際の移動が発生）。

コストは大きくない（`convertRouteKind()` は30行程度の純粋関数）ため、ドメインの忠実さを優先して案Bを採用した。

一方で `track ⇔ route` の変換は、両者とも「順序付きpath」でデータ構造が同一なため、`kind` タグを変えるだけで済む（データ移動なし）。この非対称性（waypoint方向だけデータ移動が起きる）は GPX 仕様上の非対称性（`<rte>`/`<trk>` は構造的に同型、`<wpt>` だけ異なる）を正確に反映している。

### 「開いたファイルを指定した要素として開く」の実現方法

複数ファイルを一度に開く既存の `<input type="file" multiple>` フローに、ファイルごとの種別選択ダイアログを割り込ませると UX が重くなる。代わりに、**ツールバーに常設の「開く形式」セレクタ**を置き、`uiStore.openAsKind` として保持する方式を採った。

- `AppHeader` の「開く」ボタンだけでなく、地図への D&D（`useDropZone.ts` 経由）にも同じ設定が適用されるようにしたかったため、ローカル state ではなく `uiStore`（グローバルストア）に置いた。これにより `useFileLoader.loadFiles()` が `useUiStore.getState().openAsKind` を直接読めばよく、`useDropZone.ts` を一切変更せずに済んだ（呼び出し元を増やさずに機能が横展開された）。
- パーサーは常に「ファイルの実際の要素構成」から `kind` を自動判定する（`<trk>` があれば `'track'` 等）。その後 `useFileLoader.ts` で `convertRouteKind(route, openAsKind)` を必ず呼ぶ。ユーザーが選択した種別と自動判定が一致する場合は `convertRouteKind` が早期リターンするため、余計な変換コストは発生しない。

### 「リストにあるルートの相互変換」UI

既存の色スウォッチ（`RouteList.tsx`）と同じ「行内の小さなクリッカブル要素」というパターンを踏襲した。ドロップダウンではなく**クリックで巡回するアイコンボタン**を選んだ理由:
- 3値の巡回であればクリック1回の操作で足り、ドロップダウンを開く・選ぶ・閉じるの3ステップより速い。
- 既存の要素種別を常時アイコンで示せるので、都度メニューを開かなくても一覧性が保たれる。

Undo対象とする判断: 色変更（Undo対象外）とは異なり、種別変換はポイントの格納場所を実際に移動させる場合があり（waypoint⇔track/route）、データ構造への影響が大きいため、`rename` や `split` と同様にUndo対象とした。

### 地図表示の分岐

`RoutePolyline.tsx` に `kind==='waypoint'` の早期分岐を追加し、`standaloneWaypoints` から個別マーカーを描画するようにした。ここで一度バグを作り込んだ:

当初、ウェイポイント用マーカーを既存の `markers` ref（選択中ポイント／ホバー中ポイントのハイライト用に使われている）に push してしまい、「選択ポイントのハイライト」useEffect がレンダリングの度に `markers.current` を空にしてから作り直す仕様のため、ウェイポイントマーカーが一瞬で消えてしまう競合が発生した。Playwright での実機能検証で気づく前に、コードレビュー的に気づいて `waypointMarkers` という専用 ref に分離して修正した。

### 出力（シリアライザ）側の設計

GPX 出力では `<trkpt>`/`<rtept>`/`<wpt>` の3タグが「タグ名以外はほぼ同じ構造（lat/lon属性 + ele/time/name/desc/sym/extensions 子要素）」であることを利用し、共通の `pointTag(tagName, pt, mode)` ヘルパーに統合した。3つの薄いラッパー（`trkptTag`/`rteptTag`/`wptTag`）がフィールドの取り出し元（`TrackPoint.waypoint.*` か `Waypoint.*` か）を橋渡しするだけで、ロジックの重複を避けた。

`kind==='waypoint'` のルートで「wpt無」エクスポートオプションを選ぶと出力が空になってしまう問題に気づき、`includeWpt` の判定に `route.kind === 'waypoint' ||` を追加して常に出力されるようにした。これは要件定義書にも明記した（9.2）。

### バージョン管理

直前のターン（実装チェックリスト精査）で「`version.ts` の更新が徹底されていない」という指摘を自分で記録していたため、今回はその指摘を実践する形で `APP_VERSION` を `0.1.0` → `0.2.0`（MINOR、新機能追加）に上げ、`CHANGELOG` に本ターンの内容を追記した。

---

## 実行した操作

1. `Read` → `designs/実装チェックリスト.md`（ide_opened_fileのため文脈確認）
2. `Glob`/`Read` → `requirements/要件定義書.md`、`thoughts/08`, `thoughts/11`（ドキュメント規約の確認）
3. `Read` → `gpxSerializer.ts`, `kmlParser.ts`, `geojsonParser.ts`, `RouteList.tsx`, `AppHeader.tsx`, `geojsonSerializer.ts`, `kmlSerializer.ts`, `useDropZone.ts`（既存実装の把握）
4. `Edit` → `src/types/route.ts`（`RouteKind`, `Waypoint` 追加、`RouteData.kind`/`standaloneWaypoints: Waypoint[]`）
5. `Edit` → `src/lib/editors/routeEditors.ts`（`convertRouteKind()` 追加）
6. `Edit` × 3 → `gpxParser.ts` / `kmlParser.ts` / `geojsonParser.ts`（座標付き Waypoint 抽出、`kind` 自動判定、単独トラック複製の撤廃）
7. `Edit` → `gpxSerializer.ts`（`pointTag` 共通化、`<rte>`/`<wpt>` 出力分岐）
8. `Edit` × 2 → `geojsonSerializer.ts` / `kmlSerializer.ts`（`standaloneWaypoints` 出力・座標付き Placemark 修正）
9. `Edit` → `uiStore.ts`（`openAsKind` 追加）
10. `Edit` → `useFileLoader.ts`（`convertRouteKind` 適用）
11. `Edit` → `AppHeader.tsx`（開く形式セレクタ追加）
12. `Edit` → `RouteList.tsx`（種別アイコンボタン・巡回変換・ポイント数表示分岐）
13. `Edit` → `RoutePolyline.tsx`（kind別描画分岐、waypoint用ref分離バグ修正）
14. `Edit` → `PropertiesPanel.tsx`（属性タブに要素種別表示）
15. `Bash` → `npm run build` → `EditModePanel.tsx` の `kind` 未設定エラーを検出・修正 → 再ビルド成功
16. `Bash`/`Write` → Playwright ドライバスクリプトを一時作成し、dev サーバー起動 → `<wpt>` のみの GPX を「トラックとして開く」→ 種別を3回巡回クリック → 地図描画（実線→破線→個別マーカー）とサイドバー表示・属性パネルを screenshot で確認 → コンソールエラー0件を確認 → 一時ファイル削除
17. `Edit` → `requirements/要件定義書.md`（v1.1→1.2、新設 4.5 節、9.2/10 節の追記）
18. `Edit` × 複数 → `designs/基本設計書.md`（v1.2→1.3、新設 4.1 節、5.4/6.2/6.3/9.1/9.2/9.4 節の追記、既存 4.1→4.2 の番号調整）
19. `Edit` → `designs/実装チェックリスト.md`（GPX 3要素種別対応セクションを新設・全項目チェック済みで記録）
20. `Edit` → `src/lib/version.ts`（0.1.0→0.2.0、CHANGELOG追記）
21. `Bash` → 最終 `npm run build` 確認

---

## 応答の要点

GPX の `<wpt>`/`<rte>`/`<trk>` 3要素に対応する `RouteKind` をデータモデルに追加し、(1) ファイルを指定した種別として開く機能（ツールバーの「開く形式」セレクタ）と (2) 読込み済みルートの種別を相互変換する機能（サイドバーのアイコンボタン、Undo対象）を実装した。

実装の過程で、ウェイポイントの座標が保存されない・KML出力のPlacemarkに座標が無い・GeoJSON出力にウェイポイントが含まれない、という3件の既存バグを発見し、機能の土台として合わせて修正した。Playwright での実機能確認により、種別変換で地図表示（実線↔破線↔個別マーカー）とサイドバー表示が正しく切り替わることを確認済み。要件定義書・基本設計書・実装チェックリストの3文書と `version.ts` を更新した。
