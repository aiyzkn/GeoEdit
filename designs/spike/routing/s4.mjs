// 向きの対称性と、規則ごとの違い
import { loadBlock, lngLatToTile, haversine } from './lib.mjs'
import { buildGraph, components } from './graph.mjs'
import { search, summarize, nodeLL } from './search.mjs'
const [name, lng, lat, half, nArg, seedArg] = process.argv.slice(2)
const z = 14, t = lngLatToTile(+lng, +lat, z), cx = Math.floor(t.x), cy = Math.floor(t.y), h = +half
const { lines } = await loadBlock(z, cx - h, cy - h, cx + h, cy + h)
const g = buildGraph(lines, z, { tol: 1 }); g.ll = []
const { comp, sizes } = components(g); const big = sizes.indexOf(Math.max(...sizes))
const cand = []; g.edges.forEach((e) => { if (comp[e.a] === big) cand.push(e.a) })
let seed = +(seedArg ?? 1); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const rules = { rimFree300: { mode: 'rim' }, rimNoFree: { mode: 'rim', freeRadius: 0 }, rimFloor2: { mode: 'rim', freeRadius: 0, floor: 2 }, phase: {} }
const out = {}
for (const k in rules) out[k] = { asym: 0, km: 0, ms: 0, valleys: 0, maxAsym: 0 }
let n = 0; const N = +nArg; const diffs = []
while (n < N) {
  const a = cand[Math.floor(rnd() * cand.length)], b = cand[Math.floor(rnd() * cand.length)]
  const d = haversine(nodeLL(g, a), nodeLL(g, b)); if (d < 1500) continue
  n++
  const res = {}
  for (const [k, o] of Object.entries(rules)) {
    const t0 = performance.now(); const f = search(g, a, b, o); out[k].ms += performance.now() - t0
    const r = search(g, b, a, o)
    out[k].km += f.dist / 1000; out[k].valleys += f.valleys
    const da = Math.abs(f.cost - r.cost)
    if (da > 1) { out[k].asym++; out[k].maxAsym = Math.max(out[k].maxAsym, Math.round(da)) }
    res[k] = f
  }
  if (Math.abs(res.rimFloor2.dist - res.phase.dist) > 50 && diffs.length < 6) diffs.push(`d=${(d/1000).toFixed(1)}km\n  phase    ${JSON.stringify(summarize(g, res.phase))}\n  rimFloor2 ${JSON.stringify(summarize(g, res.rimFloor2))}`)
}
console.log(name, N, JSON.stringify(out, (k, v) => typeof v === 'number' ? Math.round(v) : v))
console.log(diffs.join('\n'))
