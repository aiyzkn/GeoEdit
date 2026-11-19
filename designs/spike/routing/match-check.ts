// トラックのマップマッチング（Router.matchTrack）を、実際の KML と実タイルで確かめる（トラックのマップマッチング設計書 §7）。
// 使い方: node match-check.ts <KML> [出力フォルダ]   （Node 22.6 以上。アプリの src/ を読み込む）
//   - 標準出力: 線（LineString）ごとの点の数・長さ・道に合わせた割合・元の点を残した割合・元の点から合わせた線までの距離・時間
//   - 出力フォルダを渡すと、線ごとに z17 の標準地図へ「元の線（赤）」と「合わせた線（青。元の点を残した区間は橙）」を重ねた PNG を書き出す
//   - 環境変数 ONLY=番号（その線だけ）、Z=ズーム（画像のズームを固定。既定は 17 から収まるまで下げる）、SCALE=倍率（画像の拡大）
// KML は Placemark の LineString だけを読む（簡易。アプリの読み込みは @tmcw/togeojson）。個人の記録の KML はリポジトリに置かない。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const SRC = new URL('../../../src/lib/routing/', import.meta.url).href
const { Router } = await import(SRC + 'index.ts')
const { resolveRoutingOptions, DEFAULT_ROUTING_SETTINGS } = await import(SRC + 'settings.ts')
const { distanceLL } = await import(SRC + 'geo.ts')
const CACHE = new URL('./cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.mkdirSync(CACHE, { recursive: true })

type P = { lat: number; lng: number }
async function get(url: string, f: string): Promise<Buffer | null> {
  if (fs.existsSync(f)) { const b = fs.readFileSync(f); return b.length ? b : null }
  const r = await fetch(url); const b = r.ok ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0)
  fs.writeFileSync(f, b); return b.length ? b : null
}
let PNG: any = null
try { PNG = require('pngjs').PNG } catch { /* pngjs が無ければ、車線合わせと画像の書き出しをしない */ }
const raster = PNG ? async (z: number, x: number, y: number) => {
  const b = await get(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`, `${CACHE}std_${z}_${x}_${y}.png`)
  if (!b) return null
  const p = PNG.sync.read(b); return { width: p.width, height: p.height, data: p.data }
} : null
const vec = (z: number) => async (x: number, y: number) => { const b = await get(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`, `${CACHE}${z}_${x}_${y}.pbf`); return b ? new Uint8Array(b).buffer : null }

const [kmlPath, outDir] = process.argv.slice(2)
if (!kmlPath) { console.error('使い方: node match-check.ts <KML> [出力フォルダ]'); process.exit(1) }
const text = fs.readFileSync(kmlPath, 'utf8')
const lines: P[][] = [...text.matchAll(/<LineString>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/g)]
  .map((m) => m[1].trim().split(/\s+/).map((c) => { const [lng, lat] = c.split(',').map(Number); return { lat, lng } }))
  .filter((l) => l.length >= 2)
if (outDir) fs.mkdirSync(outDir, { recursive: true })

const router = new Router(vec(14), { coarseLoader: vec(12), raster })
const opts = resolveRoutingOptions(DEFAULT_ROUTING_SETTINGS)
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
function distToLine(p: P, line: P[]): number {
  let best = Infinity
  const kx = 111_320 * Math.cos(p.lat * Math.PI / 180), ky = 110_574
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1].lng - p.lng) * kx, ay = (line[i - 1].lat - p.lat) * ky
    const bx = (line[i].lng - p.lng) * kx, by = (line[i].lat - p.lat) * ky
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy
    let f = L2 ? -(ax * dx + ay * dy) / L2 : 0; f = Math.max(0, Math.min(1, f))
    best = Math.min(best, Math.hypot(ax + f * dx, ay + f * dy))
  }
  return best
}
const pathLen = (l: P[]) => l.reduce((a, p, i) => (i ? a + distanceLL(l[i - 1], p) : a), 0)

console.log('線 | 点 | 長さ(km) | 道に合わせた観測 | 元の点を残した点 | 元の点→合わせた線（m）中央値 / 90% / 99% | 合わせた線の長さ(km) | 時間(s)')
let sumObs = 0, sumMatched = 0, sumKept = 0, sumPts = 0
const allRes: number[] = []
for (let li = 0; li < lines.length; li++) {
  if (process.env.ONLY && +process.env.ONLY !== li) continue
  const pts = lines[li]
  const t0 = performance.now()
  const r = await router.matchTrack(pts, opts)
  const t = (performance.now() - t0) / 1000
  if (!r) { console.log(`${li} | ${pts.length} | ${(pathLen(pts) / 1000).toFixed(1)} | （タイルを取れない）`); continue }
  const kept = r.sections.filter((s: any) => s.kind === 'kept').reduce((a: number, s: any) => a + s.input[1] - s.input[0] + 1, 0)
  const res: number[] = []
  for (const s of r.sections) if (s.kind === 'matched') for (let i = s.input[0]; i <= s.input[1]; i++) res.push(distToLine(pts[i], s.points))
  allRes.push(...res)
  sumObs += r.observed; sumMatched += r.matched; sumKept += kept; sumPts += pts.length
  console.log(`${li} | ${pts.length} | ${(pathLen(pts) / 1000).toFixed(1)} | ${r.matched}/${r.observed} | ${kept}（区間 ${r.sections.filter((s: any) => s.kind === 'kept').length}） | ${pct(res, 0.5).toFixed(1)} / ${pct(res, 0.9).toFixed(1)} / ${pct(res, 0.99).toFixed(1)} | ${(pathLen(r.points) / 1000).toFixed(1)} | ${t.toFixed(1)}`)
  if (outDir && PNG) await render(pts, r, path.join(outDir, `line-${String(li).padStart(2, '0')}.png`))
}
console.log(`合計: 道に合わせた観測 ${sumMatched}/${sumObs}（${(sumMatched / sumObs * 100).toFixed(1)}%）・元の点を残した点 ${sumKept}/${sumPts}（${(sumKept / sumPts * 100).toFixed(1)}%）・元の点→合わせた線 中央値 ${pct(allRes, 0.5).toFixed(1)} m / 90% ${pct(allRes, 0.9).toFixed(1)} m / 99% ${pct(allRes, 0.99).toFixed(1)} m`)

async function render(orig: P[], r: any, file: string) {
  const all = [...orig, ...r.points]
  let z = process.env.Z ? +process.env.Z : 17
  const W = (zz: number) => 256 * 2 ** zz
  const px = (p: P, zz: number) => [(p.lng + 180) / 360 * W(zz), (1 - Math.log(Math.tan(p.lat * Math.PI / 180) + 1 / Math.cos(p.lat * Math.PI / 180)) / Math.PI) / 2 * W(zz)]
  // 画像の幅が 1600 px に収まるまでズームを下げる（z15 まで）
  for (; !process.env.Z && z > 15; z--) { const xs = all.map((p) => px(p, z)); const w = Math.max(...xs.map((q) => q[0])) - Math.min(...xs.map((q) => q[0])), h = Math.max(...xs.map((q) => q[1])) - Math.min(...xs.map((q) => q[1])); if (w < 1500 && h < 1500) break }
  const xs = all.map((p) => px(p, z))
  const x0 = Math.floor(Math.min(...xs.map((q) => q[0]))) - 40, y0 = Math.floor(Math.min(...xs.map((q) => q[1]))) - 40
  const Wd = Math.min(1600, Math.ceil(Math.max(...xs.map((q) => q[0]))) + 40 - x0), Ht = Math.min(1600, Math.ceil(Math.max(...xs.map((q) => q[1]))) + 40 - y0)
  const img = new PNG({ width: Wd, height: Ht })
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + Ht) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + Wd) / 256); tx++) {
    const t = await raster!(z, tx, ty); if (!t) continue
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const X = tx * 256 + i - x0, Y = ty * 256 + j - y0; if (X < 0 || Y < 0 || X >= Wd || Y >= Ht) continue; const o = (j * 256 + i) * 4, d = (Y * Wd + X) * 4; for (let c = 0; c < 4; c++) img.data[d + c] = t.data[o + c] }
  }
  const draw = (pts: P[], rgb: number[], wdt: number) => {
    for (let q = 1; q < pts.length; q++) {
      const [ax, ay] = px(pts[q - 1], z), [bx, by] = px(pts[q], z); const n = Math.ceil(Math.hypot(bx - ax, by - ay)) + 1
      for (let s = 0; s <= n; s++) for (let ox = 0; ox < wdt; ox++) for (let oy = 0; oy < wdt; oy++) {
        const X = Math.round(ax + (bx - ax) * s / n) - x0 + ox, Y = Math.round(ay + (by - ay) * s / n) - y0 + oy
        if (X < 0 || Y < 0 || X >= Wd || Y >= Ht) continue
        const d = (Y * Wd + X) * 4; img.data[d] = rgb[0]; img.data[d + 1] = rgb[1]; img.data[d + 2] = rgb[2]; img.data[d + 3] = 255
      }
    }
  }
  draw(orig, [255, 0, 0], 2)
  for (const s of r.sections) draw(s.points, s.kind === 'matched' ? [0, 60, 255] : [255, 140, 0], 2)
  fs.writeFileSync(file, PNG.sync.write(img))
}
