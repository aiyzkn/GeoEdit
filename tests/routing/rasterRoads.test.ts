// rasterRoads.ts（地図画像の色の付いた道の骨格の取り出し。経路の元の選択設計書 §2.3・§3.2・§3.3）の単体テスト。
// 合成の画像（道の種類の配列）に、高速の帯・番号の盾・中央の点・跨ぐ道を描いて確かめる（設計書 §7）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRoadPixel,
  classifyRoadImage,
  extractRoadSkeleton,
  RK_NONE,
  RK_MOTORWAY,
  RK_NATIONAL,
  RK_PREFECTURAL,
  RK_SYMBOL,
  type RasterRoadImage,
  type RoadSkeleton,
} from '../../src/lib/routing/rasterRoads.ts'

// ── 合成の画像 ───────────────────────────────────────────

function blank(w: number, h: number): RasterRoadImage {
  return { width: w, height: h, kind: new Uint8Array(w * h) }
}

/** 矩形 [x0, x1] × [y0, y1]（両端を含む）を塗る */
function rect(img: RasterRoadImage, x0: number, y0: number, x1: number, y1: number, kind: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) img.kind[y * img.width + x] = kind
}

/** 太さ th の線分を塗る */
function line(img: RasterRoadImage, ax: number, ay: number, bx: number, by: number, th: number, kind: number): void {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay))
  const r = th / 2
  for (let i = 0; i <= n; i++) {
    const cx = ax + ((bx - ax) * i) / n
    const cy = ay + ((by - ay) * i) / n
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (Math.hypot(x - cx, y - cy) <= r && x >= 0 && y >= 0 && x < img.width && y < img.height) img.kind[y * img.width + x] = kind
  }
}

// ── グラフの検査の補助 ─────────────────────────────────────

/** (x, y) にいちばん近い節点 */
function nearestNode(sk: RoadSkeleton, x: number, y: number): number {
  let best = -1
  let bd = Infinity
  sk.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.y - y)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** 節点 a から b への最短の道のり（画素）。つながっていなければ Infinity */
function shortest(sk: RoadSkeleton, a: number, b: number): number {
  const adj = new Map<number, [number, number][]>()
  for (const e of sk.edges) {
    if (!adj.has(e.a)) adj.set(e.a, [])
    if (!adj.has(e.b)) adj.set(e.b, [])
    adj.get(e.a)!.push([e.b, e.lengthPx])
    adj.get(e.b)!.push([e.a, e.lengthPx])
  }
  const dist = new Map<number, number>([[a, 0]])
  const open = new Set([a])
  while (open.size) {
    let u = -1
    let du = Infinity
    for (const v of open) if (dist.get(v)! < du) du = dist.get((u = v))!
    open.delete(u)
    if (u === b) return du
    for (const [v, w] of adj.get(u) ?? []) {
      if (du + w < (dist.get(v) ?? Infinity)) {
        dist.set(v, du + w)
        open.add(v)
      }
    }
  }
  return Infinity
}

function connected(sk: RoadSkeleton, ax: number, ay: number, bx: number, by: number): boolean {
  return Number.isFinite(shortest(sk, nearestNode(sk, ax, ay), nearestNode(sk, bx, by)))
}

// ── 画素の分類 ───────────────────────────────────────────

test('classifyRoadPixel: 色の付いた道だけを道とし、白い一般道・道路縁は道としない', () => {
  assert.equal(classifyRoadPixel(0x64, 0xc3, 0x73), RK_MOTORWAY)
  assert.equal(classifyRoadPixel(0xff, 0x7a, 0x7a), RK_NATIONAL)
  assert.equal(classifyRoadPixel(0xff, 0xff, 0x00), RK_PREFECTURAL)
  assert.equal(classifyRoadPixel(0xff, 0xff, 0xff), RK_NONE) // 一般道の白 = 地の色
  assert.equal(classifyRoadPixel(0x64, 0x64, 0x64), RK_NONE) // 道路縁
  assert.equal(classifyRoadPixel(0xff, 0x87, 0x4b), RK_NONE) // 市街地の塗り（国道と近い色）
  assert.equal(classifyRoadPixel(0x00, 0x00, 0x00), RK_SYMBOL) // 注記
  assert.equal(classifyRoadPixel(0x14, 0x5a, 0xff), RK_SYMBOL) // 青い記号・線
})

test('classifyRoadImage: 透明な画素（タイルが無い所）は道としない', () => {
  const rgba = Uint8Array.from([0x64, 0xc3, 0x73, 255, 0x64, 0xc3, 0x73, 0])
  assert.deepEqual([...classifyRoadImage(rgba, 2, 1).kind], [RK_MOTORWAY, RK_NONE])
})

// ── 骨格 ─────────────────────────────────────────────

test('高速の帯 1 本: 端から端まで 1 本の骨格になり、種類は高速', () => {
  const img = blank(220, 60)
  rect(img, 10, 25, 209, 33, RK_MOTORWAY)
  const sk = extractRoadSkeleton(img)
  const d = shortest(sk, nearestNode(sk, 10, 29), nearestNode(sk, 209, 29))
  assert.ok(d > 180 && d < 205, `道のり ${d}`)
  assert.ok(sk.edges.every((e) => e.kind === RK_MOTORWAY))
  assert.equal(sk.stats.bridges, 0)
})

test('帯の中央の灰色の点・線（道でない画素）は closing でふさがり、骨格は 1 本', () => {
  const img = blank(220, 60)
  rect(img, 10, 25, 209, 33, RK_MOTORWAY)
  for (let x = 12; x < 208; x += 4) rect(img, x, 29, x + 1, 29, RK_NONE)
  const sk = extractRoadSkeleton(img)
  assert.ok(connected(sk, 10, 29, 209, 29))
  // 骨格は帯の中ほどを通る（上下の 2 本にならない）
  const ys = sk.edges.flatMap((e) => e.points.filter((_, i) => i % 2 === 1 && e.points[i - 1] > 40 && e.points[i - 1] < 180))
  assert.ok(ys.every((y) => y >= 27 && y <= 31), `y の範囲 ${Math.min(...ys)}〜${Math.max(...ys)}`)
})

test('帯を横切る番号の盾（注記）は道に吸収され、骨格はつながる', () => {
  const img = blank(220, 60)
  rect(img, 10, 25, 209, 33, RK_MOTORWAY)
  rect(img, 100, 23, 112, 35, RK_SYMBOL) // 帯より少し大きい盾
  const sk = extractRoadSkeleton(img)
  assert.ok(connected(sk, 10, 29, 209, 29))
  assert.equal(sk.stats.symbolsAbsorbed, 1)
})

test('帯の切れ目（20 画素）には、進む向きの先へ橋が架かる', () => {
  const img = blank(240, 60)
  rect(img, 10, 25, 109, 33, RK_MOTORWAY)
  rect(img, 130, 25, 229, 33, RK_MOTORWAY)
  const sk = extractRoadSkeleton(img)
  assert.ok(connected(sk, 10, 29, 229, 29))
  assert.equal(sk.edges.filter((e) => e.bridge).length, 1)
})

test('橋は進む向きの先にしか架けない: 横に並んだ別の道へは架けない', () => {
  const img = blank(240, 120)
  rect(img, 10, 25, 109, 33, RK_MOTORWAY)
  rect(img, 60, 55, 229, 63, RK_MOTORWAY) // 30 画素下に並ぶ別の道（端点の向きの先には無い）
  const sk = extractRoadSkeleton(img)
  assert.equal(connected(sk, 10, 29, 229, 59), false)
  assert.equal(sk.stats.bridges, 0)
})

test('橋の上限より遠い切れ目には架けない', () => {
  const img = blank(300, 60)
  rect(img, 10, 25, 109, 33, RK_MOTORWAY)
  rect(img, 170, 25, 289, 33, RK_MOTORWAY) // 切れ目 60 画素 > 既定 40
  const sk = extractRoadSkeleton(img)
  assert.equal(connected(sk, 10, 29, 289, 29), false)
  assert.ok(connected(extractRoadSkeleton(img, { bridgePx: 70 }), 10, 29, 289, 29))
})

test('立体交差: 高速の下をくぐる国道は、高速とつながらず、国道どうしが橋でつながる', () => {
  const img = blank(200, 200)
  rect(img, 95, 10, 101, 189, RK_NATIONAL) // 縦の国道
  rect(img, 10, 94, 189, 104, RK_MOTORWAY) // 横の高速（上に描かれ、国道を切る）
  const sk = extractRoadSkeleton(img)
  assert.ok(connected(sk, 98, 10, 98, 189), '国道の上下')
  assert.ok(connected(sk, 10, 99, 189, 99), '高速の左右')
  assert.equal(connected(sk, 98, 10, 10, 99), false, '国道と高速はつながらない')
  // 国道の道のりは、まっすぐの長さに近い（高速へ回り道しない）
  const d = shortest(sk, nearestNode(sk, 98, 10), nearestNode(sk, 98, 189))
  assert.ok(d < 200, `国道の道のり ${d}`)
})

test('平面で交わる国道と県道は、同じ層なので骨格でつながる', () => {
  const img = blank(200, 200)
  rect(img, 95, 10, 101, 189, RK_NATIONAL)
  rect(img, 10, 96, 189, 102, RK_PREFECTURAL)
  const sk = extractRoadSkeleton(img)
  assert.ok(connected(sk, 98, 10, 10, 99))
  const kinds = new Set(sk.edges.map((e) => e.kind))
  assert.ok(kinds.has(RK_NATIONAL) && kinds.has(RK_PREFECTURAL))
  assert.ok(!kinds.has(RK_MOTORWAY))
})

test('ランプ: 高速の緑の端が国道に接していれば、短い橋で国道へつながる', () => {
  const img = blank(200, 200)
  rect(img, 10, 40, 189, 50, RK_MOTORWAY) // 本線
  line(img, 120, 50, 150, 130, 6, RK_MOTORWAY) // ランプ（本線から下へ）
  rect(img, 10, 131, 189, 137, RK_NATIONAL) // ランプの先の国道
  const sk = extractRoadSkeleton(img)
  assert.ok(connected(sk, 10, 45, 10, 134), '本線 → ランプ → 国道')
  assert.ok(sk.edges.some((e) => e.bridge && e.kind === RK_MOTORWAY))
})

test('斜めの道・曲がった道でも、骨格は 1 本につながる', () => {
  const img = blank(300, 300)
  line(img, 20, 280, 150, 150, 9, RK_MOTORWAY)
  line(img, 150, 150, 280, 40, 9, RK_MOTORWAY)
  const sk = extractRoadSkeleton(img)
  const d = shortest(sk, nearestNode(sk, 20, 280), nearestNode(sk, 280, 40))
  const straight = Math.hypot(130, 130) + Math.hypot(130, 110)
  assert.ok(d > straight * 0.9 && d < straight * 1.15, `道のり ${d}（線の長さ ${straight.toFixed(0)}）`)
})

test('環状の道（端点も分岐も無い輪）も辺になる', () => {
  const img = blank(120, 120)
  rect(img, 20, 20, 99, 99, RK_NATIONAL)
  rect(img, 27, 27, 92, 92, RK_NONE)
  const sk = extractRoadSkeleton(img)
  assert.ok(sk.edges.length >= 1)
  const total = sk.edges.reduce((a, e) => a + e.lengthPx, 0)
  assert.ok(total > 230 && total < 300, `輪の長さ ${total}`)
})

test('小さなごみ（色の付いた数画素）は捨てる', () => {
  const img = blank(100, 100)
  rect(img, 50, 50, 51, 51, RK_NATIONAL)
  const sk = extractRoadSkeleton(img)
  assert.equal(sk.edges.length, 0)
  assert.equal(sk.nodes.length, 0)
})

test('広い画像でも、道の無い所に手間を掛けない（3000 × 3000 に道 3 本）', () => {
  const img = blank(3000, 3000)
  rect(img, 100, 1500, 2899, 1510, RK_MOTORWAY)
  rect(img, 1500, 100, 1507, 2899, RK_NATIONAL)
  line(img, 200, 200, 2800, 2800, 6, RK_PREFECTURAL)
  const t0 = performance.now()
  const sk = extractRoadSkeleton(img)
  const ms = performance.now() - t0
  assert.ok(connected(sk, 100, 1505, 2899, 1505))
  assert.ok(connected(sk, 1503, 100, 1503, 2899))
  assert.ok(ms < 10000, `${ms.toFixed(0)} ms`)
})
