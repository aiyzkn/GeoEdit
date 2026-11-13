// `@/` パスエイリアス解決フックを登録する（node --import で読み込む）。
// register() は非推奨の --loader を避け、解決フックを子テストプロセスへも伝播させる。
import { register } from 'node:module'

register('./alias-hooks.mjs', import.meta.url)
