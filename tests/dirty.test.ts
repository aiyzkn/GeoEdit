// dirty.ts（保存していない変更の判定。designs/機能追加・UI改善設計書.md C2）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRouteDirty, markClean, forgetClean, useCleanStore } from '../src/lib/persistence/dirty.ts'
import type { RouteData } from '../src/types/route.ts'

const r = (id: string): RouteData => ({ id, name: id, sourceFormat: 'gpx', sourceFileName: `${id}.gpx`, kind: 'track', tracks: [], standaloneWaypoints: [] })

test('覚えたオブジェクトと同じ参照なら変更なし。別のオブジェクト（編集後）なら変更あり', () => {
  const a = r('a')
  assert.equal(isRouteDirty(a), true) // 覚えが無い（アプリの中で作った）
  markClean(a)
  assert.equal(isRouteDirty(a), false)
  const edited = { ...a, name: 'A2' }
  assert.equal(isRouteDirty(edited), true)
  markClean(edited) // 書き出した
  assert.equal(isRouteDirty(edited), false)
  forgetClean('a')
  assert.equal(isRouteDirty(edited), true)
  assert.deepEqual(useCleanStore.getState().clean, {})
})
