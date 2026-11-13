import { BG, ROAD, EDGE, IGNORE, type MatchOutcome } from './types.ts'

/**
 * 分類済みパッチの幾何解析（設計書 §6.3〜§6.4）。
 * DOM・Leaflet に依存しない純粋関数群。パッチ中心＝クリック位置とする。
 */

/** パッチ半径（要件「周囲20px程度」）とパッチ一辺 */
export const PATCH_RADIUS = 20
export const PATCH_SIZE = PATCH_RADIUS * 2 + 1

/** パッチ全体に占める道路画素の最低割合。下回ればフォールバック */
const MIN_ROAD_FRACTION = 0.05
/** クリック位置から道路画素を探すチェビシェフ距離 */
const SEED_RADIUS = 3
/** 外周アームとして数える連続道路画素の最小幅（px） */
const MIN_ARM_WIDTH = 3
/** 断面走査でクリック位置から許容する最寄り run までの距離（px、分離帯上クリック対応） */
const MAX_RUN_DISTANCE = 6
/** 注記穴埋め（クロージング）の反復回数と近傍半径 */
const FILL_ITERATIONS = 3
const FILL_RADIUS = 2
/** 外周の道路占有率がこれを超える場合は方向を決められない（広場・パッチ超過道路）としてフォールバック */
const MAX_BOUNDARY_ROAD_FRACTION = 0.9

const NONE: MatchOutcome = { dx: 0, dy: 0, kind: 'none' }

/**
 * 道路に被る注記文字・記号（IGNORE）を道路に吸収する（設計書 §6.3）。
 * 1) IGNORE を1px膨張し文字のアンチエイリアス縁（BGに分類される中間色）を取り込む
 * 2) 近傍に ROAD がある IGNORE を ROAD 化するクロージングを反復
 * BG は膨張の対象になるだけで直接 ROAD 化はしない（道路脇の背景が侵食されるのを防ぐ）。
 */
export function fillSymbolNoise(input: Uint8Array, size: number): Uint8Array {
  const dilated = Uint8Array.from(input)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (input[i] !== BG) continue
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
          if (input[ny * size + nx] === IGNORE) {
            dilated[i] = IGNORE
            break outer
          }
        }
      }
    }
  }

  let cur = dilated
  for (let iter = 0; iter < FILL_ITERATIONS; iter++) {
    const next = Uint8Array.from(cur)
    let changed = false
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x
        if (cur[i] !== IGNORE) continue
        outer: for (let dy = -FILL_RADIUS; dy <= FILL_RADIUS; dy++) {
          for (let dx = -FILL_RADIUS; dx <= FILL_RADIUS; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
            if (cur[ny * size + nx] === ROAD) {
              next[i] = ROAD
              changed = true
              break outer
            }
          }
        }
      }
    }
    cur = next
    if (!changed) break
  }
  return cur
}

/** クリック位置（cx,cy）に最も近い ROAD 画素をチェビシェフ距離 SEED_RADIUS 以内で探す */
function findSeed(cls: Uint8Array, size: number, cx: number, cy: number): number {
  for (let r = 0; r <= SEED_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const i = y * size + x
        if (cls[i] === ROAD) return i
      }
    }
  }
  return -1
}

/** シードを含む ROAD 連結成分（8近傍）をマスクとして返す */
function extractComponent(cls: Uint8Array, size: number, seed: number): { mask: Uint8Array; count: number } {
  const mask = new Uint8Array(size * size)
  const queue = new Int32Array(size * size)
  let head = 0
  let tail = 0
  queue[tail++] = seed
  mask[seed] = 1
  let count = 1
  while (head < tail) {
    const i = queue[head++]
    const x = i % size
    const y = (i - x) / size
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
        const ni = ny * size + nx
        if (mask[ni] || cls[ni] !== ROAD) continue
        mask[ni] = 1
        queue[tail++] = ni
        count++
      }
    }
  }
  return { mask, count }
}

/**
 * パッチ外周を時計回りに一周し、連結成分が外周に接する「アーム」を数える（設計書 §6.4(b)）。
 * 環状につながる先頭・末尾の run は1本に統合する。
 */
function countBoundaryArms(mask: Uint8Array, size: number): { arms: number; boundaryFraction: number } {
  const perimeter: number[] = []
  for (let x = 0; x < size; x++) perimeter.push(x) // 上辺 →
  for (let y = 1; y < size; y++) perimeter.push(y * size + (size - 1)) // 右辺 ↓
  for (let x = size - 2; x >= 0; x--) perimeter.push((size - 1) * size + x) // 下辺 ←
  for (let y = size - 2; y >= 1; y--) perimeter.push(y * size) // 左辺 ↑

  const member = perimeter.map((i) => mask[i] === 1)
  const memberCount = member.filter(Boolean).length
  const boundaryFraction = memberCount / perimeter.length

  const runs: number[] = []
  let runLen = 0
  for (const m of member) {
    if (m) {
      runLen++
    } else if (runLen > 0) {
      runs.push(runLen)
      runLen = 0
    }
  }
  if (runLen > 0) {
    // 末尾 run が先頭 run と環状につながる場合は統合
    if (member[0] && runs.length > 0 && member[member.length - 1]) {
      runs[0] += runLen
    } else {
      runs.push(runLen)
    }
  }
  const arms = runs.filter((len) => len >= MIN_ARM_WIDTH).length
  return { arms, boundaryFraction }
}

/**
 * ROAD マスクの距離変換（3-4チャンファー2パス近似）。値が大きいほど道路端から遠い。
 * パッチ外は非道路として扱う。交差点中心（道路内で最も開けた点）の探索に使う
 */
function distanceTransform(mask: Uint8Array, size: number): Int32Array {
  const INF = 1 << 20
  const d = new Int32Array(size * size)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : d[y * size + x])
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  }
  return d
}

interface Run {
  start: number
  end: number
}

/**
 * 断面サンプル列から ROAD の run を抽出する（設計書 §6.4(c)-3）。
 * EDGE（道路縁）は幅1pxでも必ず区切り。BG/IGNORE の1pxギャップは
 * アンチエイリアス由来とみなして連結し、2px以上は分離帯等の区切りとする。
 */
export function extractRuns(samples: Uint8Array): Run[] {
  const runs: Run[] = []
  const len = samples.length
  let i = 0
  while (i < len) {
    if (samples[i] !== ROAD) {
      i++
      continue
    }
    const start = i
    let end = i
    while (end + 1 < len) {
      const next = samples[end + 1]
      if (next === ROAD) {
        end++
        continue
      }
      if (next !== EDGE && end + 2 < len && samples[end + 2] === ROAD) {
        end += 2
        continue
      }
      break
    }
    runs.push({ start, end })
    i = end + 1
  }
  return runs
}

/** クリック位置を通る走査線上の run 探索結果 */
interface AxisScan {
  /** クリック位置を含む（または MAX_RUN_DISTANCE 以内の）run。無ければ null */
  run: Run | null
  /** run が走査線の端に達している＝そちらの方向は道路が途切れず境界が見えない */
  unbounded: boolean
}

/** クリック位置（パッチ中心）を通り方向 (nx,ny) の直線を走査し、最寄りの ROAD run を探す */
function scanAxis(cls: Uint8Array, size: number, nx: number, ny: number): AxisScan {
  const center = (size - 1) / 2
  const radius = Math.floor(size / 2)
  const samples = new Uint8Array(2 * radius + 1)
  for (let t = -radius; t <= radius; t++) {
    const x = Math.round(center + t * nx)
    const y = Math.round(center + t * ny)
    samples[t + radius] = x < 0 || y < 0 || x >= size || y >= size ? BG : cls[y * size + x]
  }
  const runs = extractRuns(samples)
  const clickIdx = radius
  let best: Run | null = null
  let bestDist = Infinity
  for (const run of runs) {
    const dist = clickIdx < run.start ? run.start - clickIdx : clickIdx > run.end ? clickIdx - run.end : 0
    if (dist < bestDist) {
      best = run
      bestDist = dist
    }
  }
  if (!best || bestDist > MAX_RUN_DISTANCE) return { run: null, unbounded: false }
  return { run: best, unbounded: best.start === 0 || best.end === samples.length - 1 }
}

/** run の中点への補正量 */
function midpointOutcome(run: Run, size: number, nx: number, ny: number): MatchOutcome {
  const radius = Math.floor(size / 2)
  const tMid = (run.start + run.end) / 2 - radius
  return { dx: tMid * nx, dy: tMid * ny, kind: 'road' }
}

/** 交差点中心の探索範囲（クリック位置からのチェビシェフ距離） */
const INTERSECTION_SEARCH_RADIUS = 12

/**
 * 走査方向（水平・垂直・両対角の固定4方向）。
 * 当初設計は成分モーメントの主方向に垂直な1本のみを走査していたが、
 * 対称な交差点でモーメントが縮退して方向が不定になるため、固定4方向を走査して
 * 構造を判定する方式に変更した（斜め方向の最大誤差22.5°は、直線道路の断面中点が
 * 走査角度によらず中心線上に乗る性質により補正精度へほぼ影響しない）
 */
const SCAN_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
]

/**
 * 分類済みパッチを解析し、クリック位置（パッチ中心）からの補正量を返す（設計書 §6.4）。
 * 判定不能な場合は kind: 'none'（呼び出し側でクリック座標にフォールバック）。
 *
 * 固定4方向の走査結果から構造を判定する:
 * - 道路が途切れない方向が2つ以上 → 交差点（距離変換の最大点＝最も開けた点へ）
 * - 両端の見える run がある → 単路部（最も幅の狭い run ＝道路断面の中点へ）
 * 当初設計の「外周アーム数≥3 → 交差点」は、市街地の細街路網がパッチ内に複数入ると
 * クリック位置と無関係に誤発火することが実タイル検証で判明したため、
 * アーム数は「道路がパッチ外へ続いているか」のガード（≤1で塊とみなす）にのみ使う。
 */
export function analyzePatch(input: Uint8Array, size: number): MatchOutcome {
  const cls = fillSymbolNoise(input, size)
  const center = (size - 1) / 2
  const radius = Math.floor(size / 2)

  let roadCount = 0
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === ROAD) roadCount++
  }
  if (roadCount / (size * size) < MIN_ROAD_FRACTION) return NONE

  const seed = findSeed(cls, size, center, center)
  if (seed < 0) return NONE

  const { mask } = extractComponent(cls, size, seed)
  const { arms, boundaryFraction } = countBoundaryArms(mask, size)
  // 全面が道路色（広場・パッチ超過道路）は方向を決められない
  if (boundaryFraction > MAX_BOUNDARY_ROAD_FRACTION) return NONE
  // パッチ内で完結する塊（建物・小さな広場等）は道路とみなさない
  if (arms <= 1) return NONE

  // 固定4方向を走査し、道路が途切れない方向数と最小幅の断面を求める
  let unboundedCount = 0
  let bestCross: { run: Run; nx: number; ny: number; width: number } | null = null
  for (const [nx, ny] of SCAN_DIRECTIONS) {
    const scan = scanAxis(cls, size, nx, ny)
    if (!scan.run) continue
    if (scan.unbounded) {
      unboundedCount++
      continue
    }
    const width = scan.run.end - scan.run.start + 1
    if (!bestCross || width < bestCross.width) {
      bestCross = { run: scan.run, nx, ny, width }
    }
  }

  let outcome: MatchOutcome = NONE
  if (unboundedCount >= 2) {
    // 複数方向で道路が途切れない → 交差点。クリック近傍で最も開けた点
    // （距離変換の最大点＝交差点領域の中心）へ補正する
    const dist = distanceTransform(mask, size)
    let bestI = -1
    let bestD = 0
    let bestNear = Infinity
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cheb = Math.max(Math.abs(x - center), Math.abs(y - center))
        if (cheb > INTERSECTION_SEARCH_RADIUS) continue
        const i = y * size + x
        if (!mask[i]) continue
        if (dist[i] > bestD || (dist[i] === bestD && cheb < bestNear)) {
          bestD = dist[i]
          bestNear = cheb
          bestI = i
        }
      }
    }
    if (bestI >= 0) {
      outcome = { dx: (bestI % size) - center, dy: Math.floor(bestI / size) - center, kind: 'intersection' }
    }
  } else if (bestCross) {
    // 単路部: 最も幅の狭い断面（＝道路をほぼ垂直に横切る走査）の中点＝道路中心へ
    outcome = midpointOutcome(bestCross.run, size, bestCross.nx, bestCross.ny)
  }

  if (outcome.kind === 'none') return NONE
  // 防御的ガード: 補正量はパッチ半径以内のはず
  if (Math.hypot(outcome.dx, outcome.dy) > radius) return NONE
  return outcome
}
