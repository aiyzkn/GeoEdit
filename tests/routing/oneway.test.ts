// 一方通行の推定と、高速道路のランプの向き（詳細設計書 §14）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { search } from '../../src/lib/routing/search.ts'
import { ONEWAY } from '../../src/lib/routing/graph.ts'
import { makeTile, graphOf, posAt, STANDARD } from './helpers.ts'

// 東西に走る、上下線が別々の線の国道（分離帯あり。20 格子 ≒ 10 m 離れている）。東の端でつながっている
const DUAL = [
  { cls: 4, med: 1, pts: [[0, 1990], [4000, 1990]] as [number, number][] }, // 北の線
  { cls: 4, med: 1, pts: [[0, 2010], [4000, 2010]] as [number, number][] }, // 南の線
  { cls: 4, pts: [[4000, 1990], [4000, 2010]] as [number, number][] },
]

test('上下線が別々の線なら、左側通行の向きだけ通れる（東行き = 北の線、西行き = 南の線）', () => {
  const g = graphOf(makeTile(DUAL))
  // 辺 0 = 北の線（a = 西）。東行き（a → b）だけ
  assert.equal(g.oneway(0), 1)
  // 辺 1 = 南の線（a = 西）。西行き（b → a）だけ
  assert.equal(g.oneway(1), -1)
  // つなぎの短い線は決めない
  assert.equal(g.oneway(2), 0)
})

test('相手の線が無い・分離帯の無い線は、両方向', () => {
  const single = graphOf(makeTile([{ cls: 4, med: 1, pts: [[0, 2000], [4000, 2000]] }]))
  assert.equal(single.oneway(0), 0)
  const noMed = graphOf(makeTile([
    { cls: 2, pts: [[0, 1990], [4000, 1990]] },
    { cls: 2, pts: [[0, 2010], [4000, 2010]] },
  ]))
  assert.equal(noMed.oneway(0), 0)
})

test('探索は一方通行を逆走しない', () => {
  const g = graphOf(makeTile(DUAL))
  const east = search(g, posAt(g, 1000, 1990), posAt(g, 3000, 1990), STANDARD)!
  assert.equal(east.steps.length, 1) // 北の線をそのまま東へ
  // 北の線を西へは戻れない（ほかに道が無いので経路なし）
  assert.equal(search(g, posAt(g, 3000, 1990), posAt(g, 1000, 1990), STANDARD), null)
  // 北の線 → 東の端で折り返し → 南の線を西へ、は通れる
  const round = search(g, posAt(g, 3000, 1990), posAt(g, 1000, 2010), STANDARD)!
  assert.ok(round.distance > 1000 * 0.4)
})

// 高速の本線（1 本の線。分離帯あり）が東西に走り、(2000, 2000) から北東（左）と南東（右）へランプが出る
const IC = [
  { cls: 6, med: 1, pts: [[0, 2000], [2000, 2000]] as [number, number][] },      // 0 本線（西）
  { cls: 6, med: 1, pts: [[2000, 2000], [4000, 2000]] as [number, number][] },   // 1 本線（東）
  { cls: 6, pts: [[2000, 2000], [2400, 1900]] as [number, number][] },           // 2 北東へのランプ（東行きの左）
  { cls: 6, pts: [[2000, 2000], [2400, 2100]] as [number, number][] },           // 3 南東へのランプ（東行きの右）
]

test('高速のランプ: 左への浅い分岐は 0、右への分岐は罰則、鋭い折り返しは進めない', () => {
  const g = graphOf(makeTile(IC))
  // 東行き（辺 0 を a → b）から
  assert.equal(g.turnCost(0, 0, 1, 0), 0) // 本線を直進
  assert.equal(g.turnCost(0, 0, 2, 0), 0) // 左のランプへ
  assert.equal(g.turnCost(0, 0, 3, 0), ONEWAY.wrongSideRampM) // 右のランプへ
  // 西行き（辺 1 を b → a）から、東向きに出ているランプへは鋭い折り返し
  assert.equal(g.turnCost(1, 1, 2, 0), Infinity)
  assert.equal(g.turnCost(1, 1, 3, 0), Infinity)
  // 同じ辺を折り返せない
  assert.equal(g.turnCost(0, 0, 0, 1), Infinity)
  // ランプから本線へ: 北東のランプを逆に来て（b → a）西行きに合流するのは、西行きから見て右からの合流 → 罰則
  assert.equal(g.turnCost(2, 1, 0, 1), ONEWAY.wrongSideRampM)
  // 南東のランプを逆に来て西行きに合流するのは、西行きの左から → 0
  assert.equal(g.turnCost(3, 1, 0, 1), 0)
})

test('高速でない道どうしには、曲がり方の制限をかけない', () => {
  const g = graphOf(makeTile([
    { cls: 4, pts: [[0, 2000], [2000, 2000]] },
    { cls: 4, pts: [[2000, 2000], [100, 2100]] },
  ]))
  assert.equal(g.turnCost(0, 0, 1, 0), 0)
  assert.equal(g.turnCost(0, 0, 0, 1), 0)
})

test('探索は、反対向きの車線のランプより、左のランプを選ぶ', () => {
  // 東行きの本線から、北（左）の一般道へ出たい。右のランプは近いが罰則、左のランプは少し先
  const g = graphOf(makeTile([
    { cls: 6, med: 1, pts: [[0, 2000], [2000, 2000]] },
    { cls: 6, med: 1, pts: [[2000, 2000], [2600, 2000]] },
    { cls: 6, med: 1, pts: [[2600, 2000], [4000, 2000]] },
    { cls: 6, pts: [[2000, 2000], [2400, 2100], [2400, 2400]] },   // 右のランプ（南へ）
    { cls: 6, pts: [[2600, 2000], [3000, 1900], [3000, 1600]] },   // 左のランプ（北へ）
    { cls: 3, pts: [[2400, 2400], [3600, 2400]] },
    { cls: 3, pts: [[3000, 1600], [3600, 1600]] },
    { cls: 3, pts: [[3600, 2400], [3600, 1600]] },
  ]))
  // 終点は東の県道の上（右のランプ経由のほうが少し近い）
  const r = search(g, posAt(g, 500, 2000), posAt(g, 3600, 2100), STANDARD)!
  assert.ok(r)
  assert.ok(r.steps.some((s) => s.edge === 4), '左のランプを通る')
  assert.ok(!r.steps.some((s) => s.edge === 3), '右のランプは通らない')
})

// ── 2026-11-16 の追加（詳細設計書 §14.6） ──────────────────────────

test('高速のランプの対（並んで走る出口と入口）は、弱い一方通行（±2）。逆向きは罰則つきで通れる', () => {
  // 東西に並ぶ 2 本のランプ（分離帯なし。20 格子 ≒ 10 m 離れている）
  const g = graphOf(makeTile([
    { cls: 6, pts: [[0, 1990], [4000, 1990]] }, // 北の線
    { cls: 6, pts: [[0, 2010], [4000, 2010]] }, // 南の線
  ]))
  assert.equal(g.oneway(0), 2) // 東行き（a → b）が正しい向き
  assert.equal(g.oneway(1), -2)
  // 北の線を西へ（逆向き）: 通れるが、罰則の分だけコストが増える
  const fwd = search(g, posAt(g, 1000, 1990), posAt(g, 3000, 1990), STANDARD)!
  const back = search(g, posAt(g, 3000, 1990), posAt(g, 1000, 1990), STANDARD)!
  assert.ok(back)
  assert.ok(Math.abs(fwd.distance - back.distance) < 1)
  // 始点の辺は、逆向きでも罰則なし（置いた点からは、どちらへも出られる）。別の辺へ入るときに足す
  const g2 = graphOf(makeTile([
    { cls: 6, pts: [[0, 1990], [2000, 1990]] },
    { cls: 6, pts: [[2000, 1990], [4000, 1990]] },
    { cls: 6, pts: [[0, 2010], [4000, 2010]] },
  ]))
  const f2 = search(g2, posAt(g2, 1000, 1990), posAt(g2, 3000, 1990), STANDARD)!
  const b2 = search(g2, posAt(g2, 3000, 1990), posAt(g2, 1000, 1990), STANDARD)!
  assert.ok(Math.abs(b2.cost - f2.cost - ONEWAY.softWrongWayM) < 1, `cost ${f2.cost} ${b2.cost}`)
})

test('探索は、いま通った辺をそのまま引き返さない（行き止まりを除く）', () => {
  // 東行きの国道から、(2000, 2000) で北の県道へ。北へ曲がるのに大きなコストがかかっても、
  // 「先の交差点 (3000, 2000) まで行って戻る」経路にはならない
  const g = graphOf(makeTile([
    { cls: 4, pts: [[0, 2000], [2000, 2000]] },
    { cls: 4, pts: [[2000, 2000], [3000, 2000]] },
    { cls: 4, pts: [[3000, 2000], [4000, 2000]] },
    { cls: 3, pts: [[2000, 2000], [2000, 0]] },
  ]))
  const r = search(g, posAt(g, 500, 2000), posAt(g, 2000, 1000), STANDARD)!
  assert.deepEqual(r.steps.map((s) => s.edge), [0, 3])
  // 行き止まりからは引き返せる（終点が手前にあるとき、始点の辺を両方向へ出る形で扱うので、ここでは経路があることだけ確かめる）
  assert.ok(search(g, posAt(g, 3500, 2000), posAt(g, 500, 2000), STANDARD))
})

test('ランプから一般道へ: 鋭い折り返し（100° 超）には罰則。直角・浅い角度は 0', () => {
  const g = graphOf(makeTile([
    { cls: 6, pts: [[0, 2400], [1000, 2400], [2000, 2000]] },   // 0 東北東へ進んで国道へ合流するランプ
    { cls: 4, med: 1, pts: [[2000, 2000], [4000, 2000]] },      // 1 国道（東）
    { cls: 4, med: 1, pts: [[0, 2000], [2000, 2000]] },         // 2 国道（西）
    { cls: 6, pts: [[2000, 3000], [2000, 2000]] },              // 3 真南から直角に来るランプ
  ]))
  assert.equal(g.turnCost(0, 0, 1, 0), 0) // そのまま東へ
  assert.equal(g.turnCost(0, 0, 2, 1), ONEWAY.wrongSideRampM) // 西へ折り返す
  assert.equal(g.turnCost(3, 0, 1, 0), 0) // 直角は右折も左折も 0
  assert.equal(g.turnCost(3, 0, 2, 1), 0)
})
