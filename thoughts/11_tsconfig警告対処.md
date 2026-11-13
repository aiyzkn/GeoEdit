# ターン 11：tsconfig.app.json の警告対処とドキュメント反映

**日時**: 2026-07-01  
**変更ファイル**: `tsconfig.app.json`（ユーザーが手動変更済み）, `designs/基本設計書.md`  
**追加ファイル**: `thoughts/11_tsconfig警告対処.md`

---

## ユーザーのプロンプト

```
tsconfig.app.jsonに関する「オプション 'baseUrl' は非推奨であり、TypeScript 7.0 で機能しなくなります。
compilerOption '"ignoreDeprecations": "6.0"' を指定して、このエラーを無音にします。
移行情報については、http://aka.ms/ts6 にアクセスしてください。」という警告への対処として、
「"ignoreDeprecations": "6.0",」を追記しました。基本設計書に反映してください。thoughts/も最新化してください。
```

（IDE 選択テキスト: `"ignoreDeprecations": "6.0",`）

---

## Claudeの思考

### 警告の原因と背景

TypeScript は `baseUrl` を v5.0 以降で「非推奨扱い」とし、v7.0 での削除を予告している。
`baseUrl: "."` は `paths`（`@/* → src/*`）を機能させるために必要だった設定で、
現在の構成では外せない。

TypeScript 公式の推奨移行先は：
- バンドラー側の alias 設定に一本化する（Vite の `resolve.alias` がすでに設定済み）
- `moduleResolution: "bundler"` と組み合わせれば `baseUrl`/`paths` を TypeScript 側に持たなくてよい

ただし、今すぐ `baseUrl` を削除すると IDE の型解決（VSCode の IntelliSense）が `@/` import を
認識しなくなるリスクがある。`ignoreDeprecations: "6.0"` で警告を抑制しながら現状維持するのは
妥当な判断。TypeScript 7.0 のリリース時点で再対応すればよい。

### 基本設計書への反映方針

反映内容を 2 カ所に分けた：

1. **ディレクトリ構成のコメント**（セクション 3）  
   `tsconfig.app.json` 行のコメントに `ignoreDeprecations: "6.0"` を追記して概要を示す。

2. **新サブセクション 13.2「tsconfig.app.json（抜粋）」** を追加  
   実際の設定値（`strict`, `noUnusedLocals`, `ignoreDeprecations`, `baseUrl`, `paths`）を
   コード例として掲載。  
   なぜ `ignoreDeprecations` が必要か・将来の移行方針を散文で説明する。

   この説明を追加した理由：
   - `ignoreDeprecations` はコードを読んだだけでは意図が分かりにくい設定
   - 「警告を知りながら意図的に抑制している」という事実をドキュメントに残すことで、
     将来のメンテナーが「直し忘れ」と誤解しないようにする

3. **セクション番号のシフト**  
   旧 13.2〜13.4 が新 13.4〜13.6 にずれた。

---

## 実行した操作

1. `Read` → `tsconfig.app.json`（実際の設定内容確認）
2. `Grep` → `基本設計書.md`（tsconfig・baseUrl 関連の記述箇所を特定）
3. `Edit` × 5 → `基本設計書.md`
   - バージョンを 1.1 → 1.2、更新日を 2026-07-01 に更新
   - ディレクトリ構成コメントに `ignoreDeprecations: "6.0"` を追記
   - セクション 13.2 として tsconfig.app.json 説明サブセクションを新規追加
   - 旧 13.2 → 13.4、旧 13.3 → 13.5、旧 13.4 → 13.6 に番号修正
4. `Write` → `thoughts/11_tsconfig警告対処.md`（本ファイル）

---

## 応答の要点

`"ignoreDeprecations": "6.0"` の追加を基本設計書（v1.2）に反映した。
設定値の掲載に加え、なぜ必要か・将来の移行方針を記述して設計意図を文書化した。
