// 探索の試作を実データで動かす: 国道上の 2 点の組で、重みだけ / 重み + 谷の罰則 を比べる
import { loadBlock, lngLatToTile } from './lib.mjs'
import { buildGraph, components } from './graph.mjs'
import { search, summarize, nodeLL, DEFAULTS } from './search.mjs'
import { haversine } from './lib.mjs'

const [name, lng, lat, half, clsArg, nArg, seedArg] = process.argv.slice(2)
const z = 14
const t = lngLatToTile(+lng, +lat, z)
const cx = Math.floor(t.x), cy = Math.floor(t.y), h = +half
const t0 = performance.now()
const { lines, bytes, tiles } = await loadBlock(z, cx - h, cy - h, cx + h, cy + h)
const t1 = performance.now()
const g = buildGraph(lines, z, { tol: 1 })
const t2 = performance.now()
const { comp, sizes } = components(g)
const big = sizes.indexOf(Math.max(...sizes))
console.log(`${name}: ${tiles} tiles ${(bytes / 1048576).toFixed(1)} MB load ${(t1 - t0).toFixed(0)}ms build ${(t2 - t1).toFixed(0)}ms nodes ${g.nodes.length} edges ${g.edges.length}`)
const cls = +(clsArg ?? 4)
const cand = []
g.edges.forEach((e) => { if ((cls === 0 || e.cls === cls) && comp[e.a] === big) cand.push(e.a) })
let seed = +(seedArg ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const variants = {
  shortest: { weight: [0, 1, 1, 1, 1, 1, 1], valley: 0 },
  weights: { valley: 0 },
  'w+valley': {},
  'rim2k': { mode: 'rim' },
  'rim2k-rev': { mode: 'rim', rev: true },
}
const agg = {}
let done = 0
const N = +(nArg ?? 12)
while (done < N) {
  const a = cand[Math.floor(rnd() * cand.length)], b = cand[Math.floor(rnd() * cand.length)]
  const d = haversine(nodeLL((g.ll ??= [], g), a), nodeLL(g, b))
  if (d < 3000) continue
  done++
  console.log(`--- pair ${done}: straight ${(d / 1000).toFixed(1)} km`)
  for (const [vn, opt] of Object.entries(variants)) {
    const s0 = performance.now()
    const r = opt.rev ? search(g, b, a, opt) : search(g, a, b, opt)
    const ms = performance.now() - s0
    if (!r) { console.log(vn, 'no route'); continue }
    const s = summarize(g, r)
    const A = (agg[vn] ??= { ms: 0, km: 0, low: 0, n: 0, exp: 0 })
    A.ms += ms; A.km += r.dist / 1000; A.n++; A.exp += r.expanded
    console.log(`${vn.padEnd(11)} ${s.km} km  share(里/市/県/国/有/高)=${s.share}  valleys=${s.valleys} exp=${s.expanded} ${ms.toFixed(0)}ms\n     ${s.seq.length > 400 ? s.seq.slice(0, 400) + ' …' : s.seq}`)
  }
}
console.log(JSON.stringify(agg))
