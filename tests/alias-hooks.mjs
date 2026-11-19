// Node の ESM resolve フック: ソースが使う `@/` パスエイリアス（tsconfig の paths）を
// `<repo>/src/` へ解決する。node --test は tsconfig を読まないため、これが無いと
// `@/lib/geometry` のような値インポートを含むモジュールが ERR_MODULE_NOT_FOUND になる。
//
// ソースは拡張子なしで import している（moduleResolution: bundler）ため、
// ディレクトリ index.ts / 同名 .ts を補完する。型のみの `@/` import は Node の
// 型ストリッピングで消えるため、ここに来るのは値インポートだけ。
import { pathToFileURL, fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve(import.meta.dirname, '..', 'src')

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    let target = path.join(srcDir, specifier.slice(2))
    if (!path.extname(target)) {
      if (existsSync(`${target}.ts`)) target = `${target}.ts`
      else if (existsSync(path.join(target, 'index.ts'))) target = path.join(target, 'index.ts')
    }
    return nextResolve(pathToFileURL(target).href, context)
  }
  // src/ 配下のモジュール同士の拡張子なし相対 import（例: tileLayers.ts の './gsiVectorStyle'）も同様に補完する
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier) &&
      context.parentURL?.startsWith(pathToFileURL(srcDir).href)) {
    // new URL(...).pathname は Windows で '/C:/...' になり、path.resolve が 'C:\C:\...' を作ってしまう。fileURLToPath を使う
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    if (existsSync(`${base}.ts`)) return nextResolve(pathToFileURL(`${base}.ts`).href, context)
    if (existsSync(path.join(base, 'index.ts'))) return nextResolve(pathToFileURL(path.join(base, 'index.ts')).href, context)
  }
  return nextResolve(specifier, context)
}
