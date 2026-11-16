// 検証 1・2: 属性の分布、座標の範囲（バッファ）、タイル境界の端点の一致、連結成分
import { loadBlock, lngLatToTile, count, EXTENT } from './lib.mjs'

const [name, lng, lat, half] = process.argv.slice(2)
const z = 14
const t = lngLatToTile(+lng, +lat, z)
const cx = Math.floor(t.x), cy = Math.floor(t.y), h = +half
const { lines, bytes, tiles } = await loadBlock(z, cx - h, cy - h, cx + h, cy + h)
console.log(`== ${name} z${z} ${tiles} tiles ${(bytes / 1024).toFixed(0)} KB, ${lines.length} lines`)
for (const k of ['ftCode', 'rdCtg', 'motorway', 'tollSect', 'rnkWidth', 'lvOrder', 'medSect', 'orgGILvl'])
  console.log(k, JSON.stringify(count(lines, (l) => l.props[k])))
console.log('ftCode x rdCtg', JSON.stringify(count(lines, (l) => `${l.props.ftCode}/${l.props.rdCtg}`)))
console.log('rdCtg x rnkWidth', JSON.stringify(count(lines, (l) => `${l.props.rdCtg}/${l.props.rnkWidth}`)))
console.log('rdCtg x motorway x toll', JSON.stringify(count(lines, (l) => `${l.props.rdCtg}/${l.props.motorway}/${l.props.tollSect}`)))
console.log('keys', JSON.stringify(count(lines.flatMap((l) => Object.keys(l.props)), (k) => k)))

// 座標の範囲
let minL = Infinity, maxL = -Infinity, outside = 0, nonInt = 0, npts = 0
for (const l of lines) for (const [a, b] of l.local) {
  npts++
  minL = Math.min(minL, a, b); maxL = Math.max(maxL, a, b)
  if (a < 0 || b < 0 || a > EXTENT || b > EXTENT) outside++
  if (!Number.isInteger(a) || !Number.isInteger(b)) nonInt++
}
console.log(`local range ${minL}..${maxL}, outside tile: ${outside}/${npts}, nonInt ${nonInt}`)

// 端点
const key = (p) => p[0] + ',' + p[1]
const deg = new Map()
for (const l of lines) for (const p of [l.pts[0], l.pts[l.pts.length - 1]]) deg.set(key(p), (deg.get(key(p)) || 0) + 1)
// 途中の点が、ほかの線の端点と一致しているか（T 字で切れていない線）
let midHit = 0, mids = 0
const midKeys = new Map()
for (const l of lines) for (let i = 1; i < l.pts.length - 1; i++) {
  mids++
  const k = key(l.pts[i])
  if (deg.has(k)) midHit++
  midKeys.set(k, (midKeys.get(k) || 0) + 1)
}
let midShared = 0
for (const v of midKeys.values()) if (v > 1) midShared++
console.log(`endpoints nodes ${deg.size}, deg`, JSON.stringify(count([...deg.values()], (v) => v)))
console.log(`interior vertices ${mids}, coincide with some endpoint: ${midHit}, interior vertices shared by 2+ lines: ${midShared}`)

// 境界: 端点がタイルの縁（local 0 or 4096）にあるもの
const onEdge = (l, i) => { const [a, b] = l.local[i]; return a <= 0 || b <= 0 || a >= EXTENT || b >= EXTENT }
let edgeEnds = 0, edgeMatched = 0, edgeAlone = 0, innerBlock = 0
const X0 = (cx - h) * EXTENT, X1 = (cx + h + 1) * EXTENT, Y0 = (cy - h) * EXTENT, Y1 = (cy + h + 1) * EXTENT
const alone = []
for (const l of lines) for (const i of [0, l.pts.length - 1]) {
  if (!onEdge(l, i)) continue
  const p = l.pts[i]
  // ブロックの外周は相手のタイルが無いので除く
  if (p[0] <= X0 || p[0] >= X1 || p[1] <= Y0 || p[1] >= Y1) continue
  edgeEnds++
  if (deg.get(key(p)) >= 2) edgeMatched++
  else { edgeAlone++; alone.push({ p, l }) }
}
console.log(`edge endpoints (inner boundaries) ${edgeEnds}, matched exactly ${edgeMatched}, alone ${edgeAlone}`)
// alone の端点から、最寄りのほかの端点までの距離
const ends = [...deg.keys()].map((k) => k.split(',').map(Number))
const dists = []
for (const a of alone.slice(0, 300)) {
  let best = Infinity
  for (const e of ends) {
    if (e[0] === a.p[0] && e[1] === a.p[1]) continue
    const d = Math.hypot(e[0] - a.p[0], e[1] - a.p[1])
    if (d < best) best = d
  }
  dists.push(Math.round(best))
}
console.log('alone → nearest other endpoint (grid units) ', JSON.stringify(count(dists, (d) => d <= 4 ? d : d <= 16 ? '5-16' : d <= 64 ? '17-64' : '65+')))

// 連結成分（端点の完全一致だけ）
const parent = new Map()
const find = (k) => { let r = k; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n } return r }
for (const k of deg.keys()) parent.set(k, k)
for (const l of lines) { const a = find(key(l.pts[0])), b = find(key(l.pts[l.pts.length - 1])); if (a !== b) parent.set(a, b) }
const comp = new Map()
for (const l of lines) { const r = find(key(l.pts[0])); comp.set(r, (comp.get(r) || 0) + 1) }
const sizes = [...comp.values()].sort((a, b) => b - a)
console.log(`components ${sizes.length}, largest ${sizes.slice(0, 6).join(', ')}, lines in largest ${(100 * sizes[0] / lines.length).toFixed(1)}%`)
