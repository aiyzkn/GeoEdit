// matcher.ts のユニットテスト（設計書 §8.1）。
// 実行: npm test（node --test。Node の型ストリッピングで TypeScript を直接実行するため
// ビルド不要。エイリアス '@/' は使えないので相対パス＋拡張子付きで import する）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BG, ROAD, EDGE, IGNORE } from '../src/lib/mapMatch/types.ts'
import { analyzePatch, PATCH_SIZE } from '../src/lib/mapMatch/matcher.ts'

const C = (PATCH_SIZE - 1) / 2 // パッチ中心 = クリック位置 (20,20)

function grid(fn: (x: number, y: number) => number): Uint8Array {
  const g = new Uint8Array(PATCH_SIZE * PATCH_SIZE)
  for (let y = 0; y < PATCH_SIZE; y++) {
    for (let x = 0; x < PATCH_SIZE; x++) {
      g[y * PATCH_SIZE + x] = fn(x, y)
    }
  }
  return g
}

test('水平道路: クリック位置から中心線へ補正される', () => {
  // 道路 = 行12〜22（中心17）、縁 = 行11・23。クリック(y=20)は道路内
  const g = grid((_x, y) => (y >= 12 && y <= 22 ? ROAD : y === 11 || y === 23 ? EDGE : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'road')
  assert.ok(Math.abs(r.dy - -3) <= 1, `dy=${r.dy} は約-3のはず`)
  assert.ok(Math.abs(r.dx) <= 1, `dx=${r.dx} は約0のはず`)
})

test('垂直道路: クリックが道路脇でも近傍シードから中心線へ補正される', () => {
  // 道路 = 列10〜18（中心14）。クリック(x=20)は道路の2px外 → シード探索で吸着
  const g = grid((x) => (x >= 10 && x <= 18 ? ROAD : x === 9 || x === 19 ? EDGE : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'road')
  assert.ok(Math.abs(r.dx - -6) <= 1, `dx=${r.dx} は約-6のはず`)
  assert.ok(Math.abs(r.dy) <= 1, `dy=${r.dy} は約0のはず`)
})

test('斜め45°道路: 中心線上のクリックは補正ほぼゼロ', () => {
  const g = grid((x, y) => (Math.abs(x - y) <= 5 ? ROAD : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'road')
  assert.ok(Math.hypot(r.dx, r.dy) <= 1.5, `変位 (${r.dx}, ${r.dy}) はほぼ0のはず`)
})

test('分離帯道路: クリックされた側の車道中心へ補正される', () => {
  // 上側車道 = 行14〜20（中心17）、分離帯 = 行21〜25、下側車道 = 行26〜32。クリック(y=20)は上側車道内
  const g = grid((_x, y) =>
    (y >= 14 && y <= 20) || (y >= 26 && y <= 32) ? ROAD : y === 13 || y === 33 ? EDGE : BG
  )
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'road')
  assert.ok(Math.abs(r.dy - -3) <= 1, `dy=${r.dy} は約-3（上側車道の中心）のはず`)
})

test('分離帯上のクリック: 最寄りの車道中心へ補正される', () => {
  // 上側車道 = 行12〜18（中心15）、分離帯 = 行19〜21、下側車道 = 行22〜28。クリック(y=20)は分離帯上
  const g = grid((_x, y) =>
    (y >= 12 && y <= 18) || (y >= 22 && y <= 28) ? ROAD : BG
  )
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'road')
  // どちらかの車道中心（dy = -5 または +5）に吸着していればよい
  assert.ok(Math.abs(Math.abs(r.dy) - 5) <= 1, `dy=${r.dy} は約±5のはず`)
})

test('1pxの道路縁は幅が狭くても run の区切りになる（歩道への誤連結防止）', () => {
  // 道路 = 行14〜20（中心17）、1pxの縁 = 行21、白い歩道 = 行22〜26。クリック(y=20)
  const g = grid((_x, y) =>
    y >= 14 && y <= 20 ? ROAD : y === 21 ? EDGE : y >= 22 && y <= 26 ? ROAD : y === 13 || y === 27 ? EDGE : BG
  )
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'road')
  assert.ok(Math.abs(r.dy - -3) <= 1, `dy=${r.dy} は約-3（縁の手前まで）のはず`)
})

test('十字交差点: 交差点領域の中心へ補正される', () => {
  // 交差点中心 (22,22)。横帯 = 行17〜27、縦帯 = 列17〜27。
  // 直交2方向とも道路が途切れない → 交差点判定。距離変換の最大点＝交差点中心 (22,22) へ
  const g = grid((x, y) => ((y >= 17 && y <= 27) || (x >= 17 && x <= 27) ? ROAD : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'intersection')
  assert.ok(Math.abs(r.dx - 2) <= 1, `dx=${r.dx} は約+2のはず`)
  assert.ok(Math.abs(r.dy - 2) <= 1, `dy=${r.dy} は約+2のはず`)
})

test('T字路も交差点として扱われ、合流部付近へ補正される', () => {
  // 横帯 = 行15〜25 全幅 + 縦帯 = 列15〜25 の下半分のみ（T字の合流部は (20,20)〜(20,25) 付近）
  const g = grid((x, y) => ((y >= 15 && y <= 25) || (x >= 15 && x <= 25 && y > 25) ? ROAD : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'intersection')
  assert.ok(Math.abs(r.dx) <= 2, `dx=${r.dx} は約0のはず`)
  assert.ok(r.dy >= -1 && r.dy <= 8, `dy=${r.dy} は合流部方向（0〜+8）のはず`)
})

test('市街地の細街路網: クリック近傍の街路中心へ補正される（網全体の重心へ飛ばない）', () => {
  // 4px幅の街路が12px間隔で格子状に走る（実タイル検証で誤検出した密集市街地を模擬）。
  // 街路 = 6〜9, 18〜21, 30〜33。クリック(20,20)は街路交点（中心19.5）の上
  const isStreet = (v: number) => (v + 6) % 12 < 4
  const g = grid((x, y) => (isStreet(x) || isStreet(y) ? ROAD : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  // 補正先はクリック直近の街路交点付近に収まること（網全体の重心のような遠方へ飛ばない）
  assert.notEqual(r.kind, 'none')
  assert.ok(Math.hypot(r.dx, r.dy) <= 3, `変位 (${r.dx.toFixed(1)}, ${r.dy.toFixed(1)}) は3px以内のはず`)
})

test('道路上の注記・記号ノイズは穴埋めされて中心検出できる', () => {
  // 道路 = 行12〜22（中心17）に、文字を模した IGNORE 塊（行15〜18 × 列14〜27）が被る
  const g = grid((x, y) => {
    if (y >= 15 && y <= 18 && x >= 14 && x <= 27) return IGNORE
    return y >= 12 && y <= 22 ? ROAD : y === 11 || y === 23 ? EDGE : BG
  })
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'road')
  assert.ok(Math.abs(r.dy - -3) <= 1, `dy=${r.dy} は約-3のはず`)
})

test('道路外クリック（全面背景）はフォールバック', () => {
  const r = analyzePatch(grid(() => BG), PATCH_SIZE)
  assert.equal(r.kind, 'none')
})

test('全面が道路色（広場・パッチ超過道路）はフォールバック', () => {
  const r = analyzePatch(grid(() => ROAD), PATCH_SIZE)
  assert.equal(r.kind, 'none')
})

test('パッチ内で完結する白い塊（建物等）はフォールバック', () => {
  // 外周に接しない 13×13 の塊（クリック位置を含む）
  const g = grid((x, y) => (x >= 14 && x <= 26 && y >= 14 && y <= 26 ? ROAD : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'none')
})

test('道路端が見えない幅広の白領域（片側のみ縁）はフォールバック', () => {
  // 行8以降すべて道路色（下端まで到達）→ 中心を確定できない
  const g = grid((_x, y) => (y >= 8 ? ROAD : BG))
  const r = analyzePatch(g, PATCH_SIZE)
  assert.equal(r.kind, 'none')
})
