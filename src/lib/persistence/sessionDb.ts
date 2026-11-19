// 編集内容の自動保存の置き場所（IndexedDB。designs/機能追加・UI改善設計書.md C1）。
// データベース geoedit / オブジェクトストア session / キー current。構造化複製なので、Date を含む RouteData をそのまま入れられる。

import type { RouteData } from '@/types/route'
import type { Draft, DraftTarget } from '@/types/editor'

export const SESSION_SCHEMA = 1

export interface SavedSession {
  schema: number
  savedAt: Date
  routes: RouteData[]
  selectedRouteId: string | null
  selectedTrackIndex: number
  draft: { draft: Draft; target: DraftTarget; mode: 'create' | 'reroute' } | null
}

const DB_NAME = 'geoedit'
const STORE = 'session'
const KEY = 'current'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB を使えません')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けません'))
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error ?? req.error ?? new Error('IndexedDB の処理に失敗しました'))
      t.onabort = () => reject(t.error ?? new Error('IndexedDB の処理が中止されました'))
    })
  } finally {
    db.close()
  }
}

export async function saveSession(s: SavedSession): Promise<void> {
  await tx('readwrite', (st) => st.put(s, KEY))
}

/** 保存した内容。無い・壊れている・知らない版なら null（知らない版は消す） */
export async function loadSession(): Promise<SavedSession | null> {
  const v = await tx('readonly', (st) => st.get(KEY) as IDBRequest<SavedSession | undefined>)
  if (!v || typeof v !== 'object') return null
  if (v.schema !== SESSION_SCHEMA || !Array.isArray(v.routes)) {
    await clearSession().catch(() => {})
    return null
  }
  return v
}

export async function clearSession(): Promise<void> {
  await tx('readwrite', (st) => st.delete(KEY))
}
