# 機能追加・UI 改善 設計書（2026-11 提案分）

**バージョン**: 1.0（設計確定。実装前）
**作成日**: 2026-11-15
**依拠**: 要件定義書 / 基本設計書 / [経路探索設計書](経路探索設計書.md) v0.2
**実装の進め方**: [実装引き継ぎ.md](実装引き継ぎ.md)（作業の単位・順序・完了条件）

経路探索の導入に合わせて行う、16 件の追加・修正の設計。作業の単位（WP）ごとに、独立した PR にできるように書いている。

| 群 | WP | 内容 |
|---|---|---|
| B 経路探索の応用 | B1 | 既存ルートの区間を道なりに引き直す |
| | B2 | 既存ルートの続きを描く（追記） |
| | B3 | 時刻の割り振り（速度の指定） |
| | B4 | 形を保つ間引き |
| | B5 | 作成中の標高グラフ・距離 |
| | B6 | 標高の取得をタイル方式に（B5 の前提。提案時の一覧には無く、設計の中で必要と分かった） |
| C データを失わない | C1 | 自動保存と復元 |
| | C2 | 離脱時の警告 |
| | C3 | 確認ダイアログの置き換え |
| D UI | D1 | ツールバーのアイコンの重複 |
| | D2 | ラベルの統一 |
| | D3 | ツールバーの整理 |
| | D4 | 確定のショートカット |
| | D5 | モバイルのサイドバー・タッチでのリサイズ |
| | D6 | アクセシビリティ |
| E 小さな機能 | E1 | 現在地へ移動 |
| | E2 | クリップボードへコピー |
| | E3 | タイムラインのスクロール性能 |

この設計書の中の「確認済み」は、2026-11-15 にコードまたは実物で確かめたこと。「未確認」は、実装の最初に確かめること。

---

## B. 経路探索の応用

### B0. 共通: 下書き（ドラフト）の行き先

経路探索設計書 §3 の作成中の状態（アンカーと区間）に「**確定したときに、どこへ入れるか**」を足す。B1・B2 は、この 1 つの仕組みで実現する（描く操作・引き直し・取り消しは、新規作成とまったく同じものを使う）。

```ts
// src/types/editor.ts
type DraftTarget =
  | { kind: 'new' }                                                       // 新しいルートを作る（今の作成モード）
  | { kind: 'append'; routeId: string; trackIndex: number; end: 'tail' | 'head' }   // B2
  | { kind: 'replace'; routeId: string; trackIndex: number; startIndex: number; endIndex: number }  // B1

interface CreateAnchor {
  // …経路探索設計書 §3 の項目に加えて
  locked?: boolean      // 動かせない・消せないアンカー（既存ルートの点に固定されている）
}
```

- `editorStore` に `draftTarget: DraftTarget`（既定 `{ kind: 'new' }`）を足す。`setMode()` でモードを離れるときに、アンカー・区間と一緒に既定へ戻す
- `locked` のアンカーは、マーカーの色を濃い青（部分編集の端点と同じ `#1e3a8a`）にし、`draggable: false`、クリックしても消えない
- 確定の処理は、純粋関数 `applyDraft(routes, draft, options): RouteData[]` にまとめる（`src/lib/editors/draftApply.ts`。単体テストの対象）。`EditModePanel` は、標高・時刻を付けた点列を作ってこの関数に渡し、`pushUndo` → `setRoutes` するだけにする

### B1. 既存ルートの区間を道なりに引き直す

**目的**: GPS ログの飛び・トンネル内の欠測・手描きの粗い区間を、2 点を選ぶだけで道なりに直す。

**操作**

1. ツールバーの「道なり補正」（新しいモード `reroute`）を選ぶ
2. 選択中のトラックの上で、直したい区間の始点・終点をクリックする（部分削除と同じマーカーの置き方。`toggleDeleteRangeMarker` と `selection` をそのまま使う。地図でもタイムラインでもよい）
3. パネルの「引き直す」を押す → 下書きが始まる。行き先は `replace`、両端は `locked` のアンカー、その間を経路探索で 1 区間として結ぶ
4. 合わなければ、線の上をドラッグして経由点を足す（経路探索設計書 §5.2）
5. 「確定」で、元の区間（始点〜終点。両端を含む）を、下書きの点列で置き換える。「キャンセル」で何も変えずに戻る

**確定時の点の作り方**（`applyDraft` の `replace`）

| 項目 | 決まり |
|---|---|
| 両端の点 | **元の点をそのまま残す**（時刻・標高・ウェイポイント・`_extensions` を保つ）。下書きの先頭と末尾は、元の点に差し替える |
| 間の点の座標 | 下書きの点列（B4 の間引きの後） |
| 間の点の時刻 | 両端に時刻があれば、**道のりの比**で線形に割り振る。どちらかに無ければ付けない |
| 間の点の標高 | 「標高を自動取得」が ON なら B6 で取得する。OFF なら付けない |
| 元の区間にあったウェイポイント | **消える**。確定の前に、区間の中にウェイポイント付きの点が n 個あるときは、確認ダイアログ（C3）で「n 個のウェイポイントが消えます」と知らせる |
| 元の区間の `_extensions`（心拍など） | 消える（新しい点には対応する値が無い）。ヘルプに書く |

- 始点と終点が同じ・隣どうし（間に点が無い）でも実行できる（2 点の間に道なりの点を足す用途）
- Undo の説明は「道なり補正」
- 経路探索が失敗（`fallback`）した区間は直線になる。その場合は確定しても得るものが無いので、トーストで知らせ、確定ボタンは押せるままにする（直線にしたい利用者もいる）

**変更するファイル**: `types/editor.ts`（`EditMode` に `'reroute'`）、`EditToolbar.tsx`、`EditModePanel.tsx`（`reroute` の分岐）、`MapPane.tsx`（`reroute` のとき `CreateRouteLayer` を出す条件）、`RoutePolyline.tsx`（`reroute` のときの点のクリックで `toggleDeleteRangeMarker` を呼ぶ。部分削除と同じ分岐に足す）、`VirtualTimeline.tsx`（同じ）、`lib/editors/draftApply.ts`（新規）

### B2. 既存ルートの続きを描く（追記）

**操作**: 作成モードのパネルの先頭に「作成先」の選択を足す。

| 選択肢 | 行き先 | 出す条件 |
|---|---|---|
| 新規ルート（既定） | `new` | いつも |
| 「<ルート名>」の末尾に追記 | `append` / `tail` | ルートを選択していて、選択中のトラックに 1 点以上あるとき |
| 「<ルート名>」の先頭に追記 | `append` / `head` | 同じ |

- 追記を選ぶと、トラックの末尾（先頭）の点に `locked` のアンカーが 1 つ置かれた状態で始まる。あとは新規作成と同じ
- 先頭への追記は、利用者には「先頭の点から外へ向かって」描かせ、確定のときに点列を逆にしてつなぐ（描く向きを頭の中で逆にさせない）
- 追記のときは、ルート名・トラック名の入力欄を隠す（既存のものを使う）
- アンカーが 1 つでも置かれた後は、「作成先」を変えられない（`disabled`）。変えるには、いったん全部消す

**確定時の点の作り方**（`applyDraft` の `append`）

| 項目 | 決まり |
|---|---|
| つなぎ目 | 既存の端の点を残し、下書きの 1 点目（同じ位置）を捨てる |
| 時刻（末尾への追記） | 既存の末尾に時刻があれば、そこを開始時刻として B3 の速度で続きを付ける。無ければ付けない。開始・終了日時の入力欄は隠す |
| 時刻（先頭への追記） | 既存の先頭に時刻があれば、そこから**さかのぼって**付ける（追記分の所要時間を B3 で求め、先頭の時刻から引く）。無ければ付けない |
| 標高 | 新規作成と同じ |

Undo の説明は「ルートに追記」。

### B3. 時刻の割り振り（速度の指定）

**いまの動き（確認済み）**: `redistributeTime()` は、傾斜ごとの**徒歩**の速度表（平地 4 km/h）で所要時間を出す。経路探索で国道や高速を通るルートを作ると、徒歩の時刻になる。

**設計**

```ts
// src/lib/editors/routeEditors.ts
export type SpeedProfile =
  | { kind: 'walk' }                    // いまの傾斜つきの速度表
  | { kind: 'constant'; kmh: number }   // 一定の速度

export function redistributeTime(points, startTime, profile: SpeedProfile = { kind: 'walk' }): TrackPoint[]
export function redistributeTimeWithRange(points, startTime, endTime, profile = { kind: 'walk' }): TrackPoint[]
export function estimateDurationMs(points, profile): number      // B5 の表示にも使う
```

- 既定の引数を付けるので、いまの呼び出しと試験はそのまま通る
- パネル（作成モード・時間変更モードの「一括再計算」）に「速度」を足す: `徒歩（傾斜を考慮）` / `一定 [ 20 ] km/h`。一定の速度の入力は 1〜200、既定 20
- 終了日時を入れたときは、いまと同じく、合計が終了日時に合うように伸び縮みさせる（速度の指定は、区間ごとの配分の比だけに効く。一定なら道のりに比例）
- 作成モードのパネルに、**見込みの所要時間と到着時刻**を出す（B5）
- 選んだ速度は `editorStore.speedProfile` に持つ（セッションの間だけ）

**やらないこと**: 道路の階級ごとの速度（高速 80 km/h など）。点ごとに階級を持たせる必要があり、効果に対して大きい。日付をまたぐ時刻（要件定義書 6.1 の「同一日付内のみ」）の解禁も、この設計には含めない。

### B4. 形を保つ間引き

**いまの動き（確認済み）**: `thinOutByDistance()` は、道のりが一定に達するごとに点を残す。カーブの頂点が落ちて、角が丸まる・道から外れることがある。

**設計**

```ts
// src/lib/editors/routeEditors.ts
/** Douglas–Peucker 法。toleranceM = 元の線からのずれの上限（m）。ウェイポイント付きの点・両端は必ず残す */
export function simplifyByTolerance(points: TrackPoint[], toleranceM: number): TrackPoint[]
```

- 距離は、区間の中点の緯度で経度を縮めた平面の近似で求める（数 km の区間で誤差は無視できる）。再帰でなく、スタックで実装する（点が多い区間でスタックがあふれないように）
- ウェイポイント付きの点で列を切り、切れ目ごとに適用する
- **使う場所 1（経路探索の確定時）**: 作成モードのパネルに「点を間引く（形を保つ）」のチェック（既定 ON、許容 2 m）。経路探索で結んだ区間（`auto`）だけに、区間ごとに適用する。アンカーの位置の点は必ず残る（区間の両端なので）。直線の区間はもともと 2 点
- **使う場所 2（間引きモード）**: 方式の選択を足す: `道のりの間隔 [10] m`（いまの方式）/ `形を保つ（許容 [2] m）`

### B5. 作成中の標高グラフ・距離

**設計**

- 下書きの点列（全区間の連結。B4 が ON なら間引いた後）から、**下書きの断面**を作る: 点ごとの 累積の道のり・標高
- 標高は B6（タイル方式）で取る。区間ごとに、点列と標高をキャッシュする（キーは区間の世代番号）。区間が変わったら、その区間だけ取り直す。変化から 300 ms 待ってから取る（ドラッグ中に取り続けない）
- `ElevationChart` は、`mode` が `create`・`reroute` で下書きが 2 点以上あるとき、選択中のトラックの代わりに下書きの断面を描く。データの作り方を `useElevationProfile()`（新しいフック）に切り出し、グラフの本体は入力の形（道のり・標高の配列）だけを見るようにする
- グラフにマウスを乗せたときの、地図上の位置の表示（いまは `hoverPoint` でトラックの点を指す）は、下書きのときは下書き用のマーカー 1 つを `CreateRouteLayer` に出す
- パネルに 1 行で出す: `道のり 12.3 km ・ 登り 240 m / 下り 180 m ・ 見込み 3 時間 05 分（到着 14:35）`。登り・下りは `routeStats.ts` の計算を、点列を受け取る関数に切り出して使う（しきい値などの決まりを、確定後の統計と同じにする）
- 「標高を自動取得」が OFF のときは、道のりだけを出す（グラフは出さない）
- 確定のときは、キャッシュの標高をそのまま使う（取り直さない）

### B6. 標高の取得をタイル方式に

**いまの動き（確認済み）**: `fetchElevations()` は、**1 点につき 1 回** `getelevation.php` を呼ぶ（同時に 5 本）。経路探索で数千点になると、数千回の要求になる。B5 のように描くたびに取るのは現実的でない。

**設計**: 国土地理院の標高タイル（PNG）を取り、ブラウザで画素を読む。1 枚（256 × 256）で、その範囲の点をすべてまかなえる。

```
src/lib/elevationTiles.ts
  decodeDemPixel(r, g, b): number | null        // 純粋関数（単体テスト）
  fetchElevationsByTiles(points, signal?): Promise<(number | null)[]>
```

| 項目 | 決まり |
|---|---|
| タイル | まず `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png`（z15。約 5 m メッシュ）。その点が無効（データなし・タイルが 404）なら `…/dem_png/{z}/{x}/{y}.png`（z14。約 10 m メッシュ） |
| 画素 → 標高 | `x = R·65536 + G·256 + B`。`x < 8388608` なら `x × 0.01` m、`x = 8388608`（R,G,B = 128,0,0）は無効、`x > 8388608` なら `(x − 16777216) × 0.01` m |
| 画素の選び方 | 点を含む画素（最近傍）。補間しない |
| 丸め | 0.1 m（いまの API の値の細かさに合わせる） |
| キャッシュ | デコードした標高の配列（`Float32Array`）を LRU で 64 枚。取得の同時数は 6 |
| 失敗 | タイルを取れない点は `null`。**`null` の点が残ったら、その点だけ、いまの API（`getelevation.php`）で取り直す**（海上の橋などの扱いを、いまと変えないため） |
| 画像の読み方 | `mapMatch/tileSampler.ts` と同じ方法（`fetch` → `createImageBitmap` → キャンバスで画素を読む）。色が変わらないように、`createImageBitmap` に `colorSpaceConversion: 'none'`・`premultiplyAlpha: 'none'` を付ける |

- `lib/elevationApi.ts` の `fetchElevations(points)` の**形は変えず**、中身を「タイルで取る → 残った `null` を API で取る」にする。呼び出し側（読み込み時の自動補完・作成の確定・部分編集の挿入・標高置換）は変えない
- 標高置換モードの「代替値を使う / 使わない」は、いまの `useElevReplace` の処理のまま（`null` の扱いは呼び出し側）
- E2E は、標高タイルの URL も固定の画像に差し替える（`helpers.ts` のネットワークのモックに足す）

**確認済み（2026-11-15）**: `dem5a_png/15/29106/12903.png` と `dem_png/14/14553/6451.png` が 200 で返る。`dem5b_png`・`dem5c_png` は同じ場所で 404（場所によって有無が違う。使わない）。
**確認済み（2026-11-16）**: 画素から標高への式は、この節のとおりで合っている（8 地点で、API との差は 0.7 m 以内。API は 1 m メッシュの値を返す場所があるので、0.1 m までは合わない。**E2E・単体の期待値は、API の値ではなくタイルの画素から決める**）。`dem5a_png`・`dem_png` とも `Access-Control-Allow-Origin: *` が付く。日本橋は `dem5a_png` が無効値で、`dem_png` の 4.00 m が API の値（4 m）と一致した（切り替えの順が働く例）。
**以下は、確認前の記述（残す）**: 画素から標高への式（地理院の仕様の記憶に基づく。実装の最初に、同じ地点を API とタイルの両方で取り、差が 0.1 m 以内であることを数地点で確かめる）。標高タイルに CORS のヘッダーが付くこと（標準地図のタイルは、マップマッチングで画素を読めているので付いている。標高タイルは同じホストだが、実物で確かめる）。

---

## C. データを失わない

### C1. 自動保存と復元

**いまの動き（確認済み）**: 状態はメモリの中だけ。`localStorage` はテーマにしか使っていない。リロード・タブを閉じる・ブラウザの異常終了で、すべて消える。

**設計**

```
src/lib/persistence/
  sessionDb.ts      // IndexedDB の読み書き（saveSession / loadSession / clearSession）
  autosave.ts       // ストアの変化を見て、間引いて保存する（startAutosave()）
```

| 項目 | 決まり |
|---|---|
| 置き場所 | IndexedDB。データベース `geoedit`、オブジェクトストア `session`、キー `current`。`localStorage` を使わない理由: 容量（数 MB）と、`Date` をそのまま入れられないこと。IndexedDB は構造化複製なので、`RouteData[]`（`Date` を含む）をそのまま入れられる |
| 保存するもの | `{ schema: 1, savedAt: Date, routes: RouteData[], selectedRouteId, selectedTrackIndex, draft: { anchors, legs, target } \| null }` |
| 保存しないもの | Undo / Redo の履歴、地図の位置・レイヤー、パネルの入力欄の途中の値 |
| いつ保存するか | `routeStore.routes` と下書きの変化を見て、最後の変化から 1 秒後。加えて `visibilitychange` で隠れたとき・`pagehide` のときは、待たずにすぐ |
| 空になったとき | ルートが 0 本で下書きも無ければ、記録を消す |
| 復元 | 起動時に記録があれば、地図の上に帯を出す: 「前回の編集内容があります（3 ルート・11/15 14:20 保存）　［復元］［破棄］」。**自動では復元しない**（古い内容が黙って現れるのを避ける）。帯を出している間にファイルを開いたら、帯はそのまま残す（復元すると、開いたルートに足される。名前が重なれば `makeUniqueRouteName()`）。「破棄」で記録を消す |
| 下書きの復元 | 下書きがあれば、作成モード（行き先が `replace` なら `reroute`）に入った状態で戻す。行き先のルートが復元後に無ければ、行き先を `new` にする |
| 設定 | バージョン情報のダイアログに「編集内容をこのブラウザに自動保存する」のチェック（既定 ON。`localStorage` の `geoedit-autosave`）と、「保存したデータを消す」ボタン。共用の PC に位置情報のログを残したくない人のため |
| 失敗 | IndexedDB を使えない（プライベートブラウズなど）・容量を超えたときは、1 回だけトーストで知らせ、以後は保存を止める。アプリの動きは変えない |
| 版 | `schema` が知らない値なら、復元の帯を出さず、記録を消す |

- 保存は、`routes` の配列をそのまま `put` する（Immer で凍結されたオブジェクトも、構造化複製できる）。10,000 点 × 数本で数十 ms の見込み（**未確認**。50,000 点で測り、100 ms を超えるなら、保存の間隔を 3 秒にする）
- 要件定義書 §15 の「データ保持: ページリロードで状態はリセット（自動保存は対象外）」を、この仕様に書き換える（**要件の変更**。利用者が 2026-11-15 に設計を指示）

### C2. 離脱時の警告

- 「保存していない変更がある」ときに、`beforeunload` でブラウザの確認を出す
- 判定（`src/lib/persistence/dirty.ts`）: ルートごとに「最後に読み込んだ・書き出した時点のオブジェクト」を覚えておき、今のオブジェクトと**同じ参照か**で比べる（Immer は、変えていないルートの参照を保つ）
  - 読み込んだ直後・そのルートを書き出した直後: 覚え直す（= 変更なし）
  - アプリの中で作ったルート（作成・分割でできた 2 本目）: 覚えが無いので「変更あり」
  - 下書きにアンカーが 1 つでもある: 「変更あり」
  - Undo / Redo をすると、全ルートの参照が変わる（スナップショットの複製を戻すため）ので、変えていないルートも「変更あり」になる。警告が余分に出るだけなので、許容する
- ルート一覧で、変更ありのルートの名前の後ろに「●」を付ける（`title="保存していない変更があります"`）
- 自動保存（C1）が ON でも、警告は出す（自動保存は保険で、ファイルに書き出したことにはならない）

### C3. 確認ダイアログの置き換え

**いまの動き（確認済み）**: 作成中の点を捨てる確認だけが `window.confirm`（`editorStore.ts` の `confirmDiscardCreatePoints()`）。

**設計**

```ts
// src/stores/uiStore.ts
interface ConfirmRequest {
  title: string
  message: string
  actions: { id: string; label: string; kind?: 'primary' | 'danger' | 'default' }[]   // 左から順に並べる
}
confirm(req: ConfirmRequest): Promise<string | null>     // 押されたボタンの id。Esc・外側のクリックは null
```

- `components/common/ConfirmDialog.tsx`（`Modal` を使う）。`uiStore.confirmRequest` があれば描く。`AppLayout` に 1 つ置く
- 作成中の点（アンカー）を捨てる確認は、3 つのボタンにする: 「作成を続ける」（既定。Esc と同じ）/ 「破棄して移動」（danger）/ 「確定して移動」（primary）
- `confirmDiscardCreatePoints()` を、`Promise<'keep' | 'discard' | 'commit'>` を返す `confirmLeaveDraft()` に替える。呼び出し元（`EditToolbar.select`・`useKeyboard` の Escape）を `async` にする
- 「確定して移動」: 確定の処理は `EditModePanel` の中の状態（名前・日時）を使うので、いまの `open-files` と同じやり方で、`document.dispatchEvent(new CustomEvent('draft-commit', { detail: { then: <移動先のモード> } }))` を投げ、`EditModePanel` が受けて確定する。確定できたら移動先へ。入力の誤り（名前の重複など）で確定できなければ、作成モードに留まる（トーストは確定の処理が出す）
- B1 の「ウェイポイントが消えます」も、このダイアログを使う
- `window.confirm` を使っている所は、ほかに無い（確認済み）

---

## D. UI

### D1. アイコンの重複

「部分編集」と「間引き」が同じ `GitBranch`（確認済み）。

| モード | いま | 変更後（lucide-react） |
|---|---|---|
| 部分編集 | `GitBranch` | `PencilLine` |
| 間引き | `GitBranch` | `ListFilter` |
| 道なり補正（B1。新規） | — | `Route` |

入っている版（`^0.513.0`）にその名前があることを、import して確かめる。無ければ、近い意味のものに替える（`Pencil`・`Filter`・`Waypoints`）。

### D2. ラベルの統一

要件定義書の節の名前に合わせる（ヘルプ・設計書と同じ言葉になる）。

| モード | いまのラベル / title | 変更後のラベル / title |
|---|---|---|
| `deleteRange` | 区間削除 / 区間削除 | 部分削除 / 部分削除（区間を指定して削除） |
| `timeEdit` | 時刻編集 / 時刻再計算 | 時間変更 / 時間変更（再計算・シフト） |
| `reverse` | 逆順 / トラックを逆順にする | 逆ルート / 逆ルート（始点と終点を入れ替える） |
| `waypoint` | WPT / ウェイポイント編集 | ウェイポイント / ウェイポイント編集 |
| `pointInfo` | 詳細 / ポイント詳細情報 | ポイント情報 / ポイント情報 |

- パネルの見出し・トースト・Undo の説明も同じ言葉にする（「区間削除: n ポイント削除」→「部分削除: n ポイント削除」、「トラックを逆順にしました」→「逆ルートにしました」など。`EditModePanel.tsx` を上から見て、すべて直す）
- E2E がこれらの文言で要素を選んでいる（`tests/e2e` に、該当する行が 29 行。確認済み）。同じ PR で直す

### D3. ツールバーの整理

モードが 14 個、横一列に同じ重さで並んでいる。

**並べ方**（PC・タブレット。群の間に、縦の細い区切り線）

| 群 | モード |
|---|---|
| — | 選択 |
| 描く・直す | 作成 / 部分編集 / 道なり補正 / 分割 / 部分削除 / 結合 / 間引き / 逆ルート |
| 時刻・標高 | 時間変更 / 標高置換 |
| 名前・情報 | 名前変更 / ウェイポイント / ポイント情報 |

- **「出力」をモードから外し、ヘッダーのボタンにする**（「ファイルを開く」の右。アイコン `Download`、ラベル「出力」、`title="ファイルに出力"`）。いまは「出力」モードに入り、パネルの「エクスポートダイアログを開く」を押す 2 段階になっている。ヘッダーのボタンは、選択中のルートの `ExportDialog` を直接開く。ルートを選んでいなければ `disabled`
  - `EditMode` から `'export'` を消す。`uiStore` に `showExport` / `setShowExport` を足し、`ExportDialog` は `AppLayout` で描く
  - 作成中にも出力のボタンは押せる（下書きは出力されない。確定済みのルートだけ）
- モバイルの折り畳みのグリッドは、群ごとに小さな見出しを付ける
- `TOOLS` の配列に `group` を足し、描画は群でまとめる

### D4. 確定のショートカット

| キー | 動き |
|---|---|
| `Enter` | いまのモードの「主な確定」を実行する |
| `Escape` | いまと同じ（モードを抜ける。下書きがあれば C3 の確認） |

| モード | Enter で実行するもの |
|---|---|
| 作成・道なり補正 | 確定 |
| 分割 | 分割実行 |
| 部分削除 | 区間の削除（開始・終了の 2 点が置かれているときだけ。「先頭まで」「末尾まで」は、ボタンだけ） |
| 結合 | 結合実行 |
| 部分編集 | 確定（編集の範囲を選んだ後だけ） |
| 間引き・時間変更・逆ルート・標高置換・名前変更 | それぞれの実行ボタン |
| 選択・ウェイポイント・ポイント情報 | 何もしない |

- 実装: `useKeyboard` が `mode-confirm` のイベントを投げ、`EditModePanel` が受けて、モードに応じた処理を呼ぶ（C3 の `draft-commit` と同じやり方）
- フォーカスが入力欄にあるとき: 1 行の入力欄（`input[type=text]`・`number`）では Enter で確定する。`textarea`・`datetime-local`・`select`・ボタンでは、何もしない（その部品の本来の動きを優先する）。そのため `useKeyboard` の冒頭の「INPUT / TEXTAREA なら何もしない」を、キーごとの判定に直す（Ctrl+Z などは、いまどおり入力欄では効かせない）
- モーダルが開いている間（`[role=dialog]` がある間）は、Enter・Escape の全体の処理をしない（モーダルの側が処理する。D6）
- 処理の最中（`isBusy`・`creating`）は、何もしない（二重の確定を防ぐ）
- ヘルプのダイアログのショートカットの表に足す

### D5. モバイルのサイドバー・タッチでのリサイズ

**いまの動き（確認済み）**: 768 px 未満では `RightSidebar` を描かない。ルート一覧・属性・統計・レイヤーを開けない。下部ペインとサイドバーのリサイズは `mousedown` / `mousemove` だけで、タッチで動かせない。

**設計**

- **下からのシート**: モバイルでは、ヘッダーのサイドバーのボタン（いまはタブレットだけ）を出す。押すと、画面の下から高さ 70vh のシートが出て、`RightSidebar` を幅 100% で描く。上の端に「つまみ」の帯と閉じるボタン。背景の暗い部分を押すと閉じる。ルートを選んだら、シートは開いたまま（続けて属性を見るため）
  - `RightSidebar` の `width: number` を `width: number | '100%'` にする
  - `z-index` は、タブレットの重ね方（背景 z-30・本体 z-40）と同じ。地図の `isolate` はそのまま（基本設計書 16.1 の注意のとおり）
- **リサイズをポインターのイベントに**: `AppLayout.tsx` の 2 つのハンドルを、`onPointerDown` → `setPointerCapture` → `onPointerMove` / `onPointerUp` に替える（`window` へのリスナーの付け外しが要らなくなる）。ハンドルに `touch-action: none`
  - 当たりの大きさ: 見た目は 4 px の線のまま、タッチしやすいように、透明な当たりを上下（左右）に 6 px ずつ広げる（疑似要素か、内側に線を持つ 16 px の入れ物）
- 基本設計書 16.1 の「アクセス手段自体を提供しない」「既知の制約」の記述を直す

### D6. アクセシビリティ

| 対象 | 変更 |
|---|---|
| `ToolButton`（ツールバー） | `aria-pressed={active}`。ラベルの文字があるので `aria-label` は付けない |
| ヘッダーの、アイコンだけのボタン（元に戻す・やり直し・バージョン情報・ヘルプ・サイドバー） | `aria-label`（`title` と同じ言葉。`title` は残す = E2E が使っている） |
| テーマのボタン | `aria-pressed` |
| `Modal` | 見出しに `id` を付けて `aria-labelledby`。開いたら最初の操作できる要素へフォーカス、Tab をモーダルの中で回す、Escape で閉じる、閉じたら開く前の要素へフォーカスを戻す。閉じるボタンに `aria-label="閉じる"` |
| `ToastContainer` | 入れ物に `aria-live="polite"`。`error` のトーストは `role="alert"` |
| リサイズのハンドル | `role="separator"`・`aria-orientation`・`tabIndex=0`。矢印キーで 16 px ずつ動く |
| 地図の上のボタン（ベースマップ・検索・現在地） | アイコンだけのものに `aria-label` |
| 入力欄 | `placeholder` だけで名前が分かるものに `aria-label`（作成のルート名・トラック名、日時） |
| フォーカスの見た目 | `:focus-visible` の輪郭が消えていないか確かめ、無ければ共通のスタイルを足す（`index.css`） |

試験は、Playwright の `getByRole`（名前つき）で、ボタンが名前で取れること・モーダルの中でフォーカスが回ること・Escape で閉じることを確かめる。自動の検査の道具（axe など）は、依存が増えるので入れない。

---

## E. 小さな機能

### E1. 現在地へ移動

- 地図の左上、ズームのボタンの下に、現在地のボタン（`LocateFixed`。`title`・`aria-label` は「現在地へ移動」）
- 押すと `map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, timeout: 10000 })`。1 回だけ（追い続けない）
- 成功: 現在地に丸いマーカーと、精度の円（半透明の青）を出す。もう一度押すと、取り直して移動する。マーカーは、ほかの場所へ移っても残す（ページを読み直すまで）
- 失敗: トースト（拒否された →「位置情報の利用が許可されていません」/ 取れない・時間切れ →「現在地を取得できませんでした」）
- **`public/_headers` の `Permissions-Policy` を `geolocation=(self), camera=(), microphone=()` に変える**（いまは `geolocation=()` で、ブラウザが位置情報を止めている。確認済み）。**セキュリティのヘッダーを緩める変更なので、PR の説明に明記する**
- 位置は、どこにも送らない・保存しない（C1 の対象にも入れない）。ヘルプに書く
- 作成モードで、現在地を 1 点目にする操作は、入れない（ボタンで移動してからクリックすれば足りる）

### E2. クリップボードへコピー

- `ExportDialog` の「保存」の隣に「コピー」を足す。選んでいる形式・オプションで、保存と同じ文字列を作り、`navigator.clipboard.writeText()` する
- 文字列を作る処理は、`useFileExporter` の中の「直列化する部分」と「ダウンロードさせる部分」を分けて、前者を使う（同じものが出ることを保証する）
- 成功:「GeoJSON をコピーしました（12.3 KB）」。失敗（許可が無い・https でない）:「コピーできませんでした」
- 2 MB を超えるときは、押した時点で C3 のダイアログで確かめる（「約 n MB あります。コピーしますか？」）

### E3. タイムラインのスクロール性能

**いまの状況（設計書の記録）**: 10,000 点で約 38.7 fps（目標 60 fps）。`React.memo`・距離の事前計算・`requestAnimationFrame` での間引きは実施済み。計り方（`scrollLeft` を書き換える）が、実際のスクロールと違うおそれがある、と書かれている。

**設計**: 原因を決めつけず、**計る → 効くものだけ入れる**。

1. 計り方を直す: Playwright で、マウスホイールのイベントを一定の間隔で送り、`requestAnimationFrame` の間隔から fps の中央値と下位 5 % を出す（`tests/perf/timeline-scroll.spec.ts`。ふだんの E2E には入れず、`npm run test:perf` で動かす）。10,000 点と 50,000 点
2. 候補（1 つずつ入れて、計って、効いたものだけ残す）
   - カードの大きさを固定し、`contain: strict`（または `content-visibility: auto`）を付ける
   - `overscan` を見直す（多すぎると、1 回のスクロールで作るカードが増える）
   - スクロールの位置に連動する処理（地図・グラフとの同期）が、スクロールのたびにストアを書き換えていないか確かめ、止まってから 1 回にする
   - カードの中の、選択・ホバーの状態の読み方を、カードごとの購読から、親が渡す真偽値に替える（1 点のホバーで全カードが描き直されないように）
3. 完了の条件: 新しい計り方で、10,000 点の中央値が 55 fps 以上。届かなければ、計った結果と、試して効かなかったものを設計書に書いて、そこで止める（利用者に報告する）

**結果（2026-11-19、本番ビルド、1280×800、Chromium）**: 中央値だけだと時々の長い停止が見えないので、平均（フレーム数 ÷ 時間）と下位 5 % も出した。

| 段階 | 10,000 点（中央値 / 平均 / 下位 5 %） | 50,000 点（平均） |
|------|------|------|
| 改善前 | 59.9 / 36.6 / 20 | 約 7 |
| カードの `onHoverLeave` を毎回作らない（memo が効くように） | 59.9 / 36.6 / 20（変化なし） | 約 7 |
| スクロール中（最後のスクロールから 150 ms）はカードのホバーを受けない | 59.9 / 55.6 / 30 | 15.3 |
| 標高グラフ・タイムラインがストア全体ではなく使う値だけを購読 | 59.9 / 57.3 / 59.5 | 33.4 |
| ほかの 9 か所も同じく使う値だけを購読 | 59.9 / 58.0 / 59.5 | 34.9 |

- 原因は、スクロール中にカードがマウスの下を流れてホバーが起き、ストア全体を購読していた部品（標高グラフは全点を描く）がそのたびに描き直されていたこと
- 1 段目は数値に効かなかったが、memo の意図どおりにする直しなので残した。`contain`・`overscan` の見直しは、条件を満たしたので試していない

---

## 変更するファイルの一覧（WP ごと）

| WP | 主なファイル |
|---|---|
| B0・B1・B2 | `types/editor.ts`、`stores/editorStore.ts`、`lib/editors/draftApply.ts`（新規）、`components/properties/EditModePanel.tsx`、`components/map/CreateRouteLayer.tsx`、`MapPane.tsx`、`RoutePolyline.tsx`、`VirtualTimeline.tsx`、`EditToolbar.tsx` |
| B3 | `lib/editors/routeEditors.ts`、`EditModePanel.tsx`、`editorStore.ts` |
| B4 | `lib/editors/routeEditors.ts`、`EditModePanel.tsx` |
| B5 | `hooks/useElevationProfile.ts`（新規）、`components/elevation/ElevationChart.tsx`、`lib/routeStats.ts`、`EditModePanel.tsx`、`CreateRouteLayer.tsx` |
| B6 | `lib/elevationTiles.ts`（新規）、`lib/elevationApi.ts`、`tests/e2e/helpers.ts` |
| C1 | `lib/persistence/sessionDb.ts`・`autosave.ts`（新規）、`components/common/RestoreBanner.tsx`（新規）、`AboutDialog.tsx`、`main.tsx` または `App.tsx` |
| C2 | `lib/persistence/dirty.ts`（新規）、`hooks/useFileLoader.ts`、`hooks/useFileExporter.ts`、`components/sidebar/RouteList.tsx` |
| C3 | `stores/uiStore.ts`、`components/common/ConfirmDialog.tsx`（新規）、`stores/editorStore.ts`、`EditToolbar.tsx`、`hooks/useKeyboard.ts`、`EditModePanel.tsx`、`AppLayout.tsx` |
| D1〜D3 | `EditToolbar.tsx`、`EditModePanel.tsx`、`AppHeader.tsx`、`AppLayout.tsx`、`types/editor.ts`、`uiStore.ts`、`tests/e2e/*` |
| D4 | `hooks/useKeyboard.ts`、`EditModePanel.tsx`、`HelpDialog.tsx` |
| D5 | `AppLayout.tsx`、`AppHeader.tsx`、`components/sidebar/RightSidebar.tsx` |
| D6 | `Modal.tsx`、`ToastContainer.tsx`、`AppHeader.tsx`、`EditToolbar.tsx`、`AppLayout.tsx`、`index.css` ほか |
| E1 | `components/map/LocateControl.tsx`（新規）、`MapPane.tsx`、`public/_headers` |
| E2 | `components/common/ExportDialog.tsx`、`hooks/useFileExporter.ts` |
| E3 | `components/timeline/VirtualTimeline.tsx`、`tests/perf/`（新規）、`package.json`（`test:perf`） |

どの WP でも、終わりに `designs/基本設計書.md`・`designs/実装チェックリスト.md`・`requirements/要件定義書.md`（仕様が変わるもの: B1〜B6・C1・D2〜D5・E1・E2）・`HelpDialog.tsx` を同期する。
