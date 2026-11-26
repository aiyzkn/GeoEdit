// 地理院地図（標準地図）の画像の色の付いた道（高速の緑・国道の赤・県道の黄）から、道の骨格を取り出してグラフにする
// （経路の元の選択設計書 §2.3・§3.2・§3.3）。経路の探索・ベクトルのグラフへの足し込みは、このモジュールの外で行う。
//
// 手順:
//   1. 画素を道の種類に分ける（classifyRoadImage）。白い一般道は地の色と同じなので、色では取り出さない（設計書 §2.4）。
//      地図画像のみ（raster）のときだけ、markOutlineRoads で灰色の縁（輪郭）から一般道を取り出す（§9）
//   2. 道に重なる小さな注記・記号（番号の盾など）を、接している道に吸収する
//   3. 種類の層ごと（高速 / 国道・県道）に、色の付いた画素の連結成分を、外接矩形が近いものどうしでまとめ、
//      まとまりの外接矩形の中だけで、小さな切れ目をふさぎ（closing）、細線化する（Zhang–Suen）。全面の配列で繰り返さない（§3.3）
//   4. 骨格の画素を、端点・分岐点を節点、そのあいだを辺とするグラフにする
//   5. 番号の盾・注記・跨ぐ道で切れた所へ、端点から進む向きの先にある別の骨格へ橋を架ける
//
// 高速の層と国道・県道の層は、骨格どうしではつながない（立体交差で跨ぐ道へ曲がらないため。§3.2）。
// 層をまたぐのは、端点からの短い橋（ランプの端など）だけ。
// 座標はすべて画像の画素（左上が 0, 0）。世界座標・緯度経度への変換は呼ぶ側で行う。
// 単体テストから直接 import できるよう、'@/' エイリアスを使わない。

import { classifyPixel } from '../mapMatch/palette.ts'
import { IGNORE, ROAD } from '../mapMatch/types.ts'

/** 画素の種類（RasterRoadImage.kind の値） */
export const RK_NONE = 0
/** 高速道路の緑 #64c373 */
export const RK_MOTORWAY = 1
/** 国道の赤 #ff7a7a */
export const RK_NATIONAL = 2
/** 都道府県道の黄 #ffff00 */
export const RK_PREFECTURAL = 3
/** 注記・記号（道に重なっていれば、その道に吸収する候補） */
export const RK_SYMBOL = 4
/** 白い一般道（灰色の縁に挟まれた細い白の帯と、1 本の灰色の線。markOutlineRoads で付ける。地図画像のみのときだけ） */
export const RK_GENERAL = 5

export type RoadKind = typeof RK_MOTORWAY | typeof RK_NATIONAL | typeof RK_PREFECTURAL | typeof RK_GENERAL

const isColored = (v: number) => v >= RK_MOTORWAY && v <= RK_PREFECTURAL
const isRoadKind = (v: number) => isColored(v) || v === RK_GENERAL

export interface RasterRoadImage {
  width: number
  height: number
  /** 画素ごとの種類（RK_*）。長さ width × height */
  kind: Uint8Array
}

/** 標準地図の 1 画素を、色の付いた道の種類に分ける（色は mapMatch/palette.ts の実測値に従う） */
export function classifyRoadPixel(r: number, g: number, b: number): number {
  // 金茶（法面・崖のハッチ、行政界の破線）は注記として道に吸収しない。帯に接するハッチを吸収すると、帯が法面の側へ太り、骨格が寄る
  if (isGold(r, g, b)) return RK_NONE
  const c = classifyPixel('gsi-std', r, g, b)
  if (c === IGNORE) return RK_SYMBOL
  if (c !== ROAD) return RK_NONE
  if (Math.min(r, g, b) >= 240) return RK_NONE // 一般道の白（地の色と同じ）
  if (r >= 230 && g >= 230 && b <= 90) return RK_PREFECTURAL
  if ((r - 255) ** 2 + (g - 122) ** 2 + (b - 122) ** 2 <= 35 ** 2) return RK_NATIONAL
  return RK_MOTORWAY // palette の ROAD のうち、白・黄・赤でないものは高速の緑
}

/** RGBA の画素の並び（タイルを並べたもの）を、道の種類の画像にする */
export function classifyRoadImage(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): RasterRoadImage {
  const kind = new Uint8Array(width * height)
  for (let p = 0, o = 0; p < kind.length; p++, o += 4) {
    if (rgba[o + 3] === 0) continue // 透明（タイルが無い所）
    kind[p] = classifyRoadPixel(rgba[o], rgba[o + 1], rgba[o + 2])
  }
  return { width, height, kind }
}

/** 法面のハッチ・行政界の金茶（palette.ts の行政界 #c8a03c と同じ許容） */
function isGold(r: number, g: number, b: number): boolean {
  return (r - 200) ** 2 + (g - 160) ** 2 + (b - 60) ** 2 <= 45 ** 2
}

/** 道の縁などの灰色（palette.ts の EDGE と同じ範囲。注記の黒は含めない） */
function isEdgeGray(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return mx - mn <= 16 && lum > 95 && lum <= 190
}

export interface OutlineOptions {
  /** 道の帯とみなす白の幅の半分の上限（画素）。これより広い白は地。既定 5（z17 で約 10 m の幅まで） */
  stripPx?: number
  /** 高速の緑の帯からこの距離（画素）以内は、帯の縁（z17 では帯と縁の灰色の線の間に 2〜3 画素の隙間がある）なので道にしない。既定 5 */
  motorwayCasingPx?: number
  /** 外接矩形の長い辺がこれより短い一般道の連結成分（画素）は捨てる（荒地・針葉樹などの記号）。既定 24 */
  minSpanPx?: number
  /** 破線の道の切れ目をふさぐ半径（画素。灰色の線の closing）。既定 2 */
  dashGapPx?: number
}

/**
 * 白い一般道を、輪郭（灰色の縁）から取り出し、kind の RK_NONE の画素に RK_GENERAL を付ける（その場で書き換える）。
 * 標準地図の白い道は地の色と同じなので、色では取り出せない（設計書 §2.4）。そこで
 *   - 灰色の縁に挟まれた細い白の帯（白の領域から、半径 stripPx の opening で残る広い所を除いたもの）
 *   - 灰色の線そのもの（幅の狭い道は 1 本の灰色の線で描かれる。帯の縁も含めて、帯と一緒に細線化する）
 * を道とする。灰色以外の線（等高線・法面・水涯線・建物の縁）と注記は、縁として扱わない（帯を切らない）。
 * タイル 1 枚ごとに呼んでよい（タイルの外は縁が無いものとして扱うので、境目で広い地が細い帯に見えることはない）
 */
export function markOutlineRoads(rgba: Uint8Array | Uint8ClampedArray, kind: Uint8Array, width: number, height: number, options: OutlineOptions = {}): void {
  const R = options.stripPx ?? 5
  const casing = options.motorwayCasingPx ?? 5
  const minSpan = options.minSpanPx ?? 24
  const gap = options.dashGapPx ?? 2
  const N = width * height
  let edge = new Uint8Array(N)
  for (let p = 0, o = 0; p < N; p++, o += 4) {
    if (rgba[o + 3] !== 0 && kind[p] === RK_NONE && isEdgeGray(rgba[o], rgba[o + 1], rgba[o + 2])) edge[p] = 1
  }
  // 破線（徒歩道・庭園路）の切れ目をふさぐ（closing）。色の付いた道の上には広げない
  if (gap > 0) {
    const dEdge0 = chamfer(width, height, (p) => edge[p] === 1)
    const dOut = chamfer(width, height, (p) => dEdge0[p] > gap)
    const closed = new Uint8Array(N)
    for (let p = 0; p < N; p++) if (kind[p] === RK_NONE && (edge[p] || dOut[p] > gap)) closed[p] = 1
    edge = closed
  }
  // 高速の帯の縁の灰色は道にしない（帯に沿う偽の一般道になるため）
  const nearMotorway = chamfer(width, height, (p) => kind[p] === RK_MOTORWAY)
  // 地（縁でも色の付いた道でもない所）のうち、縁・色の付いた道から R 以上離れた所を中心に、R だけ広げた所 = 広い地
  const dEdge = chamfer(width, height, (p) => edge[p] === 1 || isColored(kind[p]))
  const dCenter = chamfer(width, height, (p) => dEdge[p] >= R)
  const mark = new Uint8Array(N)
  // 帯の切れ目（白い道が帯の上を跨ぐ所）の白: 縦・横・斜めのどれかの向きで、両側 crossPx 以内に帯がある
  const crossPx = 8
  const isMw = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && kind[y * width + x] === RK_MOTORWAY
  const inBandGap = (p: number): boolean => {
    const x = p % width
    const y = (p - x) / width
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let a = false
      let b = false
      for (let s = 1; s <= crossPx && !(a && b); s++) {
        if (!a && isMw(x + dx * s, y + dy * s)) a = true
        if (!b && isMw(x - dx * s, y - dy * s)) b = true
      }
      if (a && b) return true
    }
    return false
  }
  for (let p = 0; p < N; p++) {
    if (kind[p] !== RK_NONE) continue
    // 帯の縁（灰色の線・帯との間の白）は道にしない。ただし帯の切れ目の白（帯を跨ぐ道）は残す
    if (nearMotorway[p] <= casing && (edge[p] || !inBandGap(p))) continue
    if (edge[p] || (dEdge[p] > 0 && dCenter[p] > R)) mark[p] = 1
  }
  // 小さな連結成分（記号の中の白・短い灰色の切れ端）を捨てる
  const seen = new Uint8Array(N)
  const stack: number[] = []
  const comp: number[] = []
  for (let p = 0; p < N; p++) {
    if (!mark[p] || seen[p]) continue
    comp.length = 0
    stack.push(p)
    seen[p] = 1
    while (stack.length) {
      const q = stack.pop()!
      comp.push(q)
      const x = q % width
      const y = (q - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const r = ny * width + nx
          if (mark[r] && !seen[r]) { seen[r] = 1; stack.push(r) }
        }
      }
    }
    // 小さな成分（地図記号）を捨てる。タイルの端に掛かる成分は、隣のタイルへ続くので残す
    let x0 = width, y0 = height, x1 = -1, y1 = -1
    for (const q of comp) { const x = q % width, y = (q - x) / width; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    const touchesBorder = x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1
    if (Math.max(x1 - x0, y1 - y0) + 1 >= minSpan || touchesBorder) for (const q of comp) kind[q] = RK_GENERAL
  }
}

/** src(p) が真の画素からの距離（chamfer 3-4 を 3 で割った画素の単位）。src が無ければ大きな値 */
function chamfer(W: number, H: number, src: (p: number) => boolean): Float32Array {
  const INF = 1e9
  const d = new Float32Array(W * H)
  for (let p = 0; p < d.length; p++) d[p] = src(p) ? 0 : INF
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      let v = d[p]
      if (x > 0 && d[p - 1] + 3 < v) v = d[p - 1] + 3
      if (y > 0) {
        if (d[p - W] + 3 < v) v = d[p - W] + 3
        if (x > 0 && d[p - W - 1] + 4 < v) v = d[p - W - 1] + 4
        if (x < W - 1 && d[p - W + 1] + 4 < v) v = d[p - W + 1] + 4
      }
      d[p] = v
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x
      let v = d[p]
      if (x < W - 1 && d[p + 1] + 3 < v) v = d[p + 1] + 3
      if (y < H - 1) {
        if (d[p + W] + 3 < v) v = d[p + W] + 3
        if (x < W - 1 && d[p + W + 1] + 4 < v) v = d[p + W + 1] + 4
        if (x > 0 && d[p + W - 1] + 4 < v) v = d[p + W - 1] + 4
      }
      d[p] = v
    }
  }
  for (let p = 0; p < d.length; p++) d[p] /= 3
  return d
}

export interface SkeletonOptions {
  /** 切れ目をふさぐ半径（画素）。高速の帯の上の灰色の点・中央の線を埋める。既定 3（z16 で試した値） */
  closePx?: number
  /** 同じ種類の骨格へ架ける橋の長さの上限（画素）。既定 80 m 相当を呼ぶ側で換算する。既定 40 */
  bridgePx?: number
  /** 別の種類の骨格へ架ける橋の長さの上限（画素）。既定 12 */
  crossBridgePx?: number
  /** 同じ種類への橋で、端点の進む向きとの cos の下限。既定 0.85 */
  minCos?: number
  /** 別の種類への橋での cos の下限。既定 0.5 */
  crossMinCos?: number
  /** 道に吸収する注記の大きさの上限（画素数）。既定 400 */
  symbolMaxPx?: number
  /** これより小さい骨格のまとまり（画素数）は捨てる（ごみ）。既定 8 */
  minSkeletonPx?: number
  /** 一般道（RK_GENERAL）を含む層の切れ目をふさぐ半径（画素）。並んだ道どうしをつながないよう小さく。既定 1 */
  generalClosePx?: number
  /** 一般道どうしの橋の長さの上限（画素）。行き止まりの道が多いので短く。既定 10 */
  generalBridgePx?: number
  /**
   * 一般道があるとき（地図画像のみ）、高速の端から別の種類の道へ橋を架けるのは、端の帯の幅がこれ以下（画素）のときだけ（ランプの端）。
   * 本線の帯が跨道橋で切れた所から、跨ぐ道へ降りないため。既定 6（z17 で本線の帯 約 10〜11、ランプ 約 4）
   */
  rampMaxWidthPx?: number
  /** 向かい合う一般道の端どうし（高速の帯を跨ぐ所・注記で切れた所）へ架ける橋の長さの上限（画素）。既定 80 */
  generalAcrossPx?: number
  /** 一般道の、行き止まりの短い枝（ひげ。画素）を刈る長さ。跨道部の「⊃」の縁で骨格の端が Y 字に割れるため。既定 25 */
  spurPx?: number
}

export interface SkeletonNode {
  x: number
  y: number
}

export interface SkeletonEdge {
  a: number
  b: number
  kind: RoadKind
  /** 道のり（画素） */
  lengthPx: number
  /** 通る点の並び [x0, y0, x1, y1, …]。先頭が節点 a、末尾が節点 b */
  points: number[]
  /** 端点から架けた橋なら true（画像に描かれていない区間。呼ぶ側で重みを重くする） */
  bridge: boolean
}

export interface RoadSkeleton {
  nodes: SkeletonNode[]
  edges: SkeletonEdge[]
  stats: { groups: number; skeletonPx: number; bridges: number; symbolsAbsorbed: number }
}

const DEF = { closePx: 3, bridgePx: 40, crossBridgePx: 12, minCos: 0.85, crossMinCos: 0.5, symbolMaxPx: 400, minSkeletonPx: 8, generalClosePx: 1, generalBridgePx: 10, rampMaxWidthPx: 6, generalAcrossPx: 80, spurPx: 25 }

/** 画像から骨格のグラフを取り出す */
export function extractRoadSkeleton(img: RasterRoadImage, options: SkeletonOptions = {}): RoadSkeleton {
  const opt = { ...DEF, ...options }
  const { width: W, height: H } = img
  const k = img.kind.slice()
  const symbolsAbsorbed = absorbSymbols(k, W, H, opt.symbolMaxPx)

  const nodes: SkeletonNode[] = []
  const edges: SkeletonEdge[] = []
  let groups = 0
  let skeletonPx = 0
  // 一般道（地図画像のみのとき）は、国道・県道と同じ層（平面で交わることが多い）。高速とは層を分ける（§3.2）
  let hasGeneral = false
  for (let p = 0; p < k.length; p++) if (k[p] === RK_GENERAL) { hasGeneral = true; break }
  const layers: { kinds: readonly number[]; fallback: RoadKind; close: number }[] = [
    { kinds: [RK_MOTORWAY], fallback: RK_MOTORWAY, close: opt.closePx },
    hasGeneral
      ? { kinds: [RK_NATIONAL, RK_PREFECTURAL, RK_GENERAL], fallback: RK_GENERAL, close: opt.generalClosePx }
      : { kinds: [RK_NATIONAL, RK_PREFECTURAL], fallback: RK_NATIONAL, close: opt.closePx },
  ]
  for (const layer of layers) {
    const inLayer = (v: number) => layer.kinds.includes(v)
    for (const g of groupComponents(k, W, H, inLayer, layer.close)) {
      const sk = thinGroup(W, H, g, layer.close)
      if (sk.count < opt.minSkeletonPx) continue
      groups++
      skeletonPx += sk.count
      traceGraph(sk, k, W, layer.fallback, nodes, edges)
    }
  }
  // 高速の端の帯の幅（7 × 7 の窓の高速の画素の数 ÷ 7）。一般道があるときだけ、太い端（本線）から別の種類へ架けない
  const R = 3
  const narrowEnd = (n: number): boolean => {
    if (!hasGeneral) return true
    const { x, y } = nodes[n]
    let c = 0
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && k[yy * W + xx] === RK_MOTORWAY) c++
    }
    return c / (2 * R + 1) <= opt.rampMaxWidthPx
  }
  if (hasGeneral) pruneSpurs(nodes.length, edges, opt.spurPx)
  const bridges = addBridges(nodes, edges, opt, narrowEnd)
  return { nodes, edges, stats: { groups, skeletonPx, bridges, symbolsAbsorbed } }
}

// ── 2. 注記の吸収 ─────────────────────────────────────────

/**
 * 道に接する小さな注記の連結成分（4 近傍）を、接している画素の多い道の種類に塗る。塗った成分の数を返す。
 * 成分のまわりの画素のうち 25% 以上が道なら、道の上の注記とみなす（帯より大きい盾でも、左右が道なら吸収される）
 */
function absorbSymbols(k: Uint8Array, W: number, H: number, maxPx: number): number {
  const seen = new Uint8Array(W * H)
  const stack: number[] = []
  const comp: number[] = []
  let absorbed = 0
  for (let p = 0; p < k.length; p++) {
    if (k[p] !== RK_SYMBOL || seen[p]) continue
    stack.length = 0
    comp.length = 0
    stack.push(p)
    seen[p] = 1
    const touch = [0, 0, 0, 0, 0, 0]
    while (stack.length) {
      const q = stack.pop()!
      comp.push(q)
      const x = q % W
      const y = (q - x) / W
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0)
        const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0)
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const r = ny * W + nx
        const v = k[r]
        if (v === RK_SYMBOL) {
          if (!seen[r]) {
            seen[r] = 1
            stack.push(r)
          }
        } else if (isColored(v)) touch[v]++
        else touch[0]++
      }
    }
    const road = touch[1] + touch[2] + touch[3]
    if (comp.length > maxPx || road === 0 || road < (road + touch[0]) * 0.25) continue
    const kind = touch[1] >= touch[2] && touch[1] >= touch[3] ? RK_MOTORWAY : touch[2] >= touch[3] ? RK_NATIONAL : RK_PREFECTURAL
    for (const q of comp) k[q] = kind
    absorbed++
  }
  return absorbed
}

// ── 3. まとまりごとの closing と細線化 ───────────────────────

interface Group {
  x0: number
  y0: number
  x1: number
  y1: number
  /** このまとまりに属する連結成分の番号（labels の値） */
  ids: Set<number>
  labels: Int32Array
}

/** 層の画素の連結成分（8 近傍）を、外接矩形が 2 × closePx 以内で近いものどうしでまとめる */
function groupComponents(k: Uint8Array, W: number, H: number, inLayer: (v: number) => boolean, closePx: number): Group[] {
  const labels = new Int32Array(W * H).fill(-1)
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
  const stack: number[] = []
  for (let p = 0; p < k.length; p++) {
    if (labels[p] >= 0 || !inLayer(k[p])) continue
    const id = boxes.length
    const box = { x0: W, y0: H, x1: -1, y1: -1 }
    labels[p] = id
    stack.push(p)
    while (stack.length) {
      const q = stack.pop()!
      const x = q % W
      const y = (q - x) / W
      if (x < box.x0) box.x0 = x
      if (x > box.x1) box.x1 = x
      if (y < box.y0) box.y0 = y
      if (y > box.y1) box.y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          const r = ny * W + nx
          if (labels[r] < 0 && inLayer(k[r])) {
            labels[r] = id
            stack.push(r)
          }
        }
      }
    }
    boxes.push(box)
  }
  // 外接矩形が近いものを union-find でまとめる（x の始まりの順に掃く）
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  const m = 2 * closePx
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].x0 - boxes[b].x0)
  for (let ii = 0; ii < order.length; ii++) {
    const a = boxes[order[ii]]
    for (let jj = ii + 1; jj < order.length; jj++) {
      const b = boxes[order[jj]]
      if (b.x0 > a.x1 + m) break
      if (b.y0 <= a.y1 + m && a.y0 <= b.y1 + m) parent[find(order[ii])] = find(order[jj])
    }
  }
  const byRoot = new Map<number, Group>()
  boxes.forEach((b, i) => {
    const r = find(i)
    let g = byRoot.get(r)
    if (!g) {
      g = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ids: new Set(), labels }
      byRoot.set(r, g)
    }
    g.ids.add(i)
    g.x0 = Math.min(g.x0, b.x0)
    g.y0 = Math.min(g.y0, b.y0)
    g.x1 = Math.max(g.x1, b.x1)
    g.y1 = Math.max(g.y1, b.y1)
  })
  return [...byRoot.values()]
}

interface LocalSkeleton {
  /** 画像の中での左上 */
  ox: number
  oy: number
  w: number
  h: number
  /** 骨格の画素なら 1 */
  m: Uint8Array
  count: number
}

/** 1 つのまとまりの外接矩形の中で closing と細線化をする */
function thinGroup(W: number, H: number, g: Group, R: number): LocalSkeleton {
  const pad = R + 2
  const ox = Math.max(0, g.x0 - pad)
  const oy = Math.max(0, g.y0 - pad)
  const ex = Math.min(W - 1, g.x1 + pad)
  const ey = Math.min(H - 1, g.y1 + pad)
  const w = ex - ox + 1
  const h = ey - oy + 1
  let m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = (oy + y) * W + ox
    for (let x = 0; x < w; x++) if (g.ids.has(g.labels[row + x])) m[y * w + x] = 1
  }
  if (R > 0) {
    const dil = dilate(m, w, h, R, 1)
    const ero = dilate(dil, w, h, R, 0) // 地（0）を広げる = 縮める
    m = new Uint8Array(w * h)
    for (let p = 0; p < m.length; p++) m[p] = dil[p] && !ero[p] ? 1 : 0
  }
  // 外周は 0 にする（細線化の近傍を外へはみ出させない）
  for (let x = 0; x < w; x++) m[x] = m[(h - 1) * w + x] = 0
  for (let y = 0; y < h; y++) m[y * w] = m[y * w + w - 1] = 0
  const count = zhangSuen(m, w)
  return { ox, oy, w, h, m, count }
}

/** 値 val の画素を、正方形の半径 R で広げた印（1）を返す（行・列に分けて掃く） */
function dilate(src: Uint8Array, w: number, h: number, R: number, val: number): Uint8Array {
  const t = new Uint8Array(w * h)
  const o = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let last = -1e9
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] === val) last = x
      if (x - last <= R) t[y * w + x] = 1
    }
    last = 1e9
    for (let x = w - 1; x >= 0; x--) {
      if (src[y * w + x] === val) last = x
      if (last - x <= R) t[y * w + x] = 1
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9
    for (let y = 0; y < h; y++) {
      if (t[y * w + x]) last = y
      if (y - last <= R) o[y * w + x] = 1
    }
    last = 1e9
    for (let y = h - 1; y >= 0; y--) {
      if (t[y * w + x]) last = y
      if (last - y <= R) o[y * w + x] = 1
    }
  }
  return o
}

/** Zhang–Suen の細線化（その場で書き換える）。残った画素の数を返す。外周は 0 であること */
function zhangSuen(m: Uint8Array, w: number): number {
  // 近傍の順: P2(上) P3(右上) P4(右) P5(右下) P6(下) P7(左下) P8(左) P9(左上)
  const off = [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1]
  let cand: number[] = []
  for (let p = 0; p < m.length; p++) if (m[p]) cand.push(p)
  const n = new Uint8Array(8)
  const del: number[] = []
  for (let changed = true; changed; ) {
    changed = false
    for (let step = 0; step < 2; step++) {
      del.length = 0
      for (const p of cand) {
        if (!m[p]) continue
        let bn = 0
        for (let i = 0; i < 8; i++) bn += n[i] = m[p + off[i]]
        if (bn < 2 || bn > 6) continue
        let an = 0
        for (let i = 0; i < 8; i++) if (!n[i] && n[(i + 1) & 7]) an++
        if (an !== 1) continue
        if (step === 0 ? n[0] && n[2] && n[4] : n[0] && n[2] && n[6]) continue
        if (step === 0 ? n[2] && n[4] && n[6] : n[0] && n[4] && n[6]) continue
        del.push(p)
      }
      for (const p of del) m[p] = 0
      if (del.length) changed = true
    }
    cand = cand.filter((p) => m[p])
  }
  return cand.length
}

// ── 4. 骨格をグラフにする ──────────────────────────────────

const N8: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

/** m 隣接（斜めは、共有する縦・横の画素が両方とも無いときだけ隣とみなす）の隣の画素 */
function neighbors(sk: LocalSkeleton, p: number, out: number[]): number[] {
  const { w, m } = sk
  out.length = 0
  for (const [dx, dy] of N8) {
    const q = p + dy * w + dx
    if (!m[q]) continue
    if (dx !== 0 && dy !== 0 && (m[p + dx] || m[p + dy * w])) continue
    out.push(q)
  }
  return out
}

/** 骨格の画素の近くの元の画素から、道の種類を決める（closing で埋めた画素のため） */
function kindAt(k: Uint8Array, W: number, x: number, y: number, fallback: RoadKind): RoadKind {
  const c = [0, 0, 0, 0, 0, 0]
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const v = k[(y + dy) * W + x + dx]
      if (isRoadKind(v)) c[v]++
    }
  if (fallback === RK_MOTORWAY) return RK_MOTORWAY
  const colored = c[RK_NATIONAL] + c[RK_PREFECTURAL]
  // 一般道の層: 色の付いた画素が一般道の印より少なければ一般道（色の付いた道の縁の灰色にも一般道の印が付くため）
  if (colored === 0 || (fallback === RK_GENERAL && colored < c[RK_GENERAL])) return fallback
  return c[RK_NATIONAL] >= c[RK_PREFECTURAL] ? RK_NATIONAL : RK_PREFECTURAL
}

function traceGraph(sk: LocalSkeleton, k: Uint8Array, imgW: number, layerKind: RoadKind, nodes: SkeletonNode[], edges: SkeletonEdge[]): void {
  const { w, m, ox, oy } = sk
  const nodeAt = new Map<number, number>()
  const buf: number[] = []
  const deg = (p: number) => neighbors(sk, p, buf).length
  const pix: number[] = []
  for (let p = 0; p < m.length; p++) if (m[p]) pix.push(p)
  const gx = (p: number) => (p % w) + ox
  const gy = (p: number) => Math.floor(p / w) + oy
  const addNode = (p: number) => {
    let id = nodeAt.get(p)
    if (id === undefined) {
      id = nodes.length
      nodes.push({ x: gx(p), y: gy(p) })
      nodeAt.set(p, id)
    }
    return id
  }
  for (const p of pix) if (deg(p) !== 2) addNode(p)
  const used = new Set<string>() // 節点から出る一歩目（重複して辿らない）
  const visited = new Uint8Array(m.length)
  const walk = (start: number, first: number) => {
    const key = `${start}>${first}`
    if (used.has(key)) return
    const pts = [start]
    let prev = start
    let cur = first
    const nb: number[] = []
    while (!nodeAt.has(cur)) {
      visited[cur] = 1
      pts.push(cur)
      const ns = neighbors(sk, cur, nb).filter((q) => q !== prev)
      if (ns.length === 0) break
      prev = cur
      cur = ns[0]
    }
    if (!nodeAt.has(cur)) addNode(cur) // 行き止まり（ふつうは起きない）
    pts.push(cur)
    used.add(key)
    used.add(`${cur}>${pts[pts.length - 2]}`)
    edges.push(makeEdge(pts, nodeAt.get(start)!, nodeAt.get(cur)!))
  }
  const makeEdge = (pts: number[], a: number, b: number): SkeletonEdge => {
    const points: number[] = []
    let len = 0
    const c = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < pts.length; i++) {
      const x = gx(pts[i])
      const y = gy(pts[i])
      points.push(x, y)
      if (i > 0) len += Math.hypot(x - points[2 * i - 2], y - points[2 * i - 1])
      c[kindAt(k, imgW, x, y, layerKind)]++
    }
    const kind: RoadKind = layerKind === RK_MOTORWAY ? RK_MOTORWAY
      : c[RK_GENERAL] > c[RK_NATIONAL] + c[RK_PREFECTURAL] ? RK_GENERAL
        : c[RK_NATIONAL] >= c[RK_PREFECTURAL] ? RK_NATIONAL : RK_PREFECTURAL
    return { a, b, kind, lengthPx: len, points, bridge: false }
  }
  const nb0: number[] = []
  for (const [p] of nodeAt) for (const q of [...neighbors(sk, p, nb0)]) walk(p, q)
  // 節点の無い輪（環状の道）: 1 画素を節点にして辿る
  for (const p of pix) {
    if (visited[p] || nodeAt.has(p)) continue
    addNode(p)
    for (const q of [...neighbors(sk, p, nb0)]) walk(p, q)
  }
}

// ── 5. 端点の橋渡し ───────────────────────────────────────

/** 一般道の、片方の端が行き止まりで長さ spurPx 未満の辺（ひげ）を消す。分岐の残りが 2 本以上あるときだけ（道そのものの端は残す） */
function pruneSpurs(nodeCount: number, edges: SkeletonEdge[], spurPx: number): void {
  for (let pass = 0; pass < 2; pass++) {
    const degree = new Array<number>(nodeCount).fill(0)
    for (const e of edges) { degree[e.a]++; degree[e.b]++ }
    const drop = new Set<number>()
    const removedAt = new Array<number>(nodeCount).fill(0)
    edges.forEach((e, i) => {
      if (e.kind !== RK_GENERAL || e.lengthPx >= spurPx || e.a === e.b) return
      const tip = degree[e.a] === 1 ? e.a : degree[e.b] === 1 ? e.b : -1
      if (tip < 0) return
      const root = tip === e.a ? e.b : e.a
      // 分岐点に、ひげ以外の辺が 1 本は残ること
      if (degree[root] - removedAt[root] - 1 < 1 || degree[root] < 3) return
      drop.add(i)
      removedAt[root]++
    })
    if (drop.size === 0) return
    const kept = edges.filter((_, i) => !drop.has(i))
    edges.length = 0
    edges.push(...kept)
  }
}

/** 端点（次数 1 の節点）から、進む向きの先にある別の骨格へ橋を架ける。架けた数を返す */
function addBridges(nodes: SkeletonNode[], edges: SkeletonEdge[], opt: typeof DEF, narrowEnd: (n: number) => boolean = () => true): number {
  const reach = Math.max(opt.bridgePx, opt.crossBridgePx, opt.generalAcrossPx)
  if (reach <= 0 || edges.length === 0) return 0
  // 連結成分（橋を架ける前）
  const parent = nodes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  const degree = new Array<number>(nodes.length).fill(0)
  const firstEdge = new Array<number>(nodes.length).fill(-1)
  edges.forEach((e, i) => {
    parent[find(e.a)] = find(e.b)
    degree[e.a]++
    degree[e.b]++
    if (firstEdge[e.a] < 0) firstEdge[e.a] = i
    if (firstEdge[e.b] < 0) firstEdge[e.b] = i
  })
  // 骨格の点の格子の索引（格子の大きさ = reach）
  const cell = (x: number, y: number) => `${Math.floor(x / reach)},${Math.floor(y / reach)}`
  const grid = new Map<string, number[]>() // [辺の番号, 点の番号] を平らに
  edges.forEach((e, ei) => {
    for (let i = 0; i < e.points.length / 2; i++) {
      const key = cell(e.points[2 * i], e.points[2 * i + 1])
      let a = grid.get(key)
      if (!a) grid.set(key, (a = []))
      a.push(ei, i)
    }
  })

  interface Bridge { from: number; edge: number; at: number; d: number; kind: RoadKind }
  const found: Bridge[] = []
  // 端点の進む向き（単位ベクトル）: 端点から骨格を 10 点たどった点 → 端点
  const dir = new Map<number, [number, number]>()
  for (let n = 0; n < nodes.length; n++) {
    if (degree[n] !== 1) continue
    const e = edges[firstEdge[n]]
    const cnt = e.points.length / 2
    const back = Math.min(10, cnt - 1)
    const bi = e.a === n ? back : cnt - 1 - back
    const vx = nodes[n].x - e.points[2 * bi]
    const vy = nodes[n].y - e.points[2 * bi + 1]
    const vl = Math.hypot(vx, vy)
    if (vl >= 3) dir.set(n, [vx / vl, vy / vl])
  }
  for (let n = 0; n < nodes.length; n++) {
    if (degree[n] !== 1) continue
    const e = edges[firstEdge[n]]
    const { x, y } = nodes[n]
    const v = dir.get(n)
    if (!v) continue
    const [vx, vy] = v
    const vl = 1
    // 同じ種類への橋を先に選ぶ（跨ぐ道の切れ目で、交わる別の種類の道へ曲がらないため）。無いときだけ別の種類へ
    const best: (Bridge | null)[] = [null, null]
    const bestScore = [Infinity, Infinity]
    const cx = Math.floor(x / reach)
    const cy = Math.floor(y / reach)
    for (let gy = cy - 1; gy <= cy + 1; gy++)
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const a = grid.get(`${gx},${gy}`)
        if (!a) continue
        for (let j = 0; j < a.length; j += 2) {
          const te = edges[a[j]]
          if (find(te.a) === find(n)) continue // 同じ成分には架けない
          const tx = te.points[2 * a[j + 1]]
          const ty = te.points[2 * a[j + 1] + 1]
          const dx = tx - x
          const dy = ty - y
          const d = Math.hypot(dx, dy)
          if (d < 1) continue
          const c = (dx * vx + dy * vy) / (d * vl)
          // 同じ種類: 色の付いた道どうし（高速 / 国道・県道）、一般道どうし。一般道と色の付いた道の間は別の種類
          // 一般道の端から高速へは架けない（帯の縁・跨道橋で切れた所から高速へ乗らないため）。高速の端（ランプの端）からは架ける
          if (e.kind === RK_GENERAL && te.kind === RK_MOTORWAY) continue
          const general = e.kind === RK_GENERAL || te.kind === RK_GENERAL
          const same = general ? te.kind === e.kind : te.kind === e.kind || (te.kind !== RK_MOTORWAY && e.kind !== RK_MOTORWAY)
          let maxSame = general ? opt.generalBridgePx : opt.bridgePx
          if (general && same) {
            // 行き先が、こちらを向いた一般道の端なら、長めの橋を許す（帯を跨ぐ道・注記で切れた道）
            const ti = a[j + 1]
            const tn = ti === 0 ? te.a : ti === te.points.length / 2 - 1 ? te.b : -1
            const tv = tn >= 0 && degree[tn] === 1 ? dir.get(tn) : undefined
            if (tv && tv[0] * vx + tv[1] * vy <= -0.8) maxSame = opt.generalAcrossPx
          }
          if (same ? d > maxSame || c < opt.minCos : d > opt.crossBridgePx || c < opt.crossMinCos) continue
          const score = d * (2 - c)
          const s = same ? 0 : 1
          if (score < bestScore[s]) {
            bestScore[s] = score
            best[s] = { from: n, edge: a[j], at: a[j + 1], d, kind: e.kind }
          }
        }
      }
    const pick = best[0] ?? (e.kind === RK_MOTORWAY && best[1] && !narrowEnd(n) ? null : best[1])
    if (pick) found.push(pick)
  }
  if (found.length === 0) return 0

  // 橋の行き先が辺の途中なら、その点で辺を分けて節点を作る（同じ辺への行き先はまとめて分ける）
  const byEdge = new Map<number, Bridge[]>()
  for (const b of found) {
    let a = byEdge.get(b.edge)
    if (!a) byEdge.set(b.edge, (a = []))
    a.push(b)
  }
  const target = new Map<Bridge, number>()
  for (const [ei, list] of byEdge) {
    const e = edges[ei]
    const cnt = e.points.length / 2
    const cuts = [...new Set(list.map((b) => b.at))].sort((p, q) => p - q)
    const nodeOf = new Map<number, number>([[0, e.a], [cnt - 1, e.b]])
    for (const at of cuts) {
      if (nodeOf.has(at)) continue
      nodeOf.set(at, nodes.length)
      nodes.push({ x: e.points[2 * at], y: e.points[2 * at + 1] })
    }
    for (const b of list) target.set(b, nodeOf.get(b.at)!)
    const marks = [...nodeOf.keys()].sort((p, q) => p - q)
    if (marks.length > 2) {
      const pieces: SkeletonEdge[] = []
      for (let i = 1; i < marks.length; i++) {
        const pts = e.points.slice(2 * marks[i - 1], 2 * marks[i] + 2)
        let len = 0
        for (let j = 2; j < pts.length; j += 2) len += Math.hypot(pts[j] - pts[j - 2], pts[j + 1] - pts[j - 1])
        pieces.push({ a: nodeOf.get(marks[i - 1])!, b: nodeOf.get(marks[i])!, kind: e.kind, lengthPx: len, points: pts, bridge: false })
      }
      edges[ei] = pieces[0]
      edges.push(...pieces.slice(1))
    }
  }
  const seen = new Set<string>()
  let added = 0
  for (const b of found) {
    const t = target.get(b)!
    const key = b.from < t ? `${b.from}-${t}` : `${t}-${b.from}`
    if (seen.has(key)) continue // 両側の端点から架けた同じ橋
    seen.add(key)
    const p = nodes[b.from]
    const q = nodes[t]
    edges.push({ a: b.from, b: t, kind: b.kind, lengthPx: b.d, points: [p.x, p.y, q.x, q.y], bridge: true })
    added++
  }
  return added
}
