# GeoEdit
Route Editor — GeoJSON / GPX / KML のルートを閲覧・編集するブラウザのツール

地図（国土地理院の地図を主に使う）の上で、ルート・トラックを読み込み・作成・編集し、GeoJSON / GPX / KML に書き出します。ブラウザだけで動く静的サイトです（ビルド成果物は `dist/`）。

## 主な機能

- 読み込み・書き出し: GeoJSON / GPX（ウェイポイント・ルート・トラック）/ KML
- 編集: 分割・部分削除・逆ルート・間引き・結合・時間変更・標高の置換・部分編集（点の移動・追加・削除）・ウェイポイント
- ルートの作成: 地図をクリックして点を置く。経路探索で、点の間を道路に沿って結ぶ（経路の元は、ベクトルタイルのみ / 地図画像＋ベクトルタイル / 地図画像のみ（試験的））。道なり補正（既存のルートを道路に沿って引き直す）
- 表示: タイムライン・標高グラフ・統計情報、背景の地図とオーバーレイの切り替え、地名・住所の検索、ライト / ダーク / システムのテーマ

変更の履歴は、アプリの「バージョン情報」（中身は `src/lib/version.ts` の `CHANGELOG`）にあります。

## 開発

React + TypeScript + Vite + Leaflet（地理院ベクトルタイルの表示に MapLibre GL）。状態は zustand。

```sh
npm ci            # 依存の導入（clone した直後は node_modules が無い）
npm run dev       # 開発用のサーバー（Vite）
npm run build     # 型の検査（tsc -b）とビルド。出力は dist/
npm run preview   # ビルド結果の確認
```

### テスト

| コマンド | 内容 |
|---|---|
| `npm test` | 単体テスト（`node --test`。`tests/**/*.test.ts`）。**Node 22.6 以上**が要る（`--test` のグロブと、TypeScript の型の除去を使うため） |
| `npm run test:e2e` | E2E（Playwright、Chromium。`tests/e2e/`）。開発用のサーバーをポート 5173 で自動で起こす（起動済みなら使い回す） |
| `npm run test:perf` | 性能の計測（`playwright.perf.config.ts`） |

- 単体テストでも `@/`（`src/` を指す別名）の import が解決されます（`tests/register-alias.mjs`）
- E2E では、localhost 以外への通信をすべて遮断して、決まった応答に差し替えます（`tests/e2e/helpers.ts` の `mockExternalNetwork`。タイル画像は透明、標高は一定の値、unpkg の Leaflet の CSS も遮断されるので、地図の部品の配置に頼るテストは `serveLeafletCss()` を使う）。実際のタイルに依存する見え方・経路は、ブラウザで確かめてください

## 文書

| 場所 | 中身 |
|---|---|
| [requirements/要件定義書.md](requirements/要件定義書.md) | 要件 |
| [designs/基本設計書.md](designs/基本設計書.md) | 全体の設計 |
| [designs/実装チェックリスト.md](designs/実装チェックリスト.md) | 実装の進み具合（設計書との対応） |
| [designs/マップマッチング設計書.md](designs/マップマッチング設計書.md) | 作成モードの点を地図画像の道へ寄せる |
| [designs/トラックのマップマッチング設計書.md](designs/トラックのマップマッチング設計書.md) | 既存のトラックを道へ合わせる |
| [designs/経路探索設計書.md](designs/経路探索設計書.md) / [designs/経路探索詳細設計書.md](designs/経路探索詳細設計書.md) | 経路探索（方針 / 詳細） |
| [designs/経路の元の選択設計書.md](designs/経路の元の選択設計書.md) | 経路の元（ベクトルタイル・地図画像）の選択 |
| [designs/機能追加・UI改善設計書.md](designs/機能追加・UI改善設計書.md) | 2026-11 の機能追加・画面の改善 |
| [designs/実装引き継ぎ.md](designs/実装引き継ぎ.md) | 経路探索などの実装の引き継ぎ |
| `thoughts/` | 作業ごとの検討の記録 |

---

Copyright (c) 2026 YA All rights reserved.
