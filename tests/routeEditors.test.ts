// routeEditors.ts のユニットテスト（要件定義書 4.2 / 6.x）。
// このモジュールは編集ロジックの中核。E2E は「UI導線がつながっているか」を見るのに対し、
// ここでは各純粋関数の入出力を境界値込みで検証する。
// '@/lib/geometry' 値インポートを含むため tests/register-alias.mjs のフックで解決される。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRouteNameTaken,
  makeUniqueRouteName,
  dedupeConsecutivePoints,
  deleteRange,
  splitTrack,
  reverseTrack,
  thinOut,
  thinOutByDistance,
  convertRouteKind,
  redistributeTime,
  redistributeTimeWithRange,
  shiftTime,
  mergeRoutesUnified,
  mergeRoutesChronological,
  mergeRoutesSimple,
  extractPartialEditRange,
  nearestSegmentInsertIndex,
  trackToNameLine,
  parseTrackNameLine,
  interpolateMissingElevations,
} from '../src/lib/editors/routeEditors.ts'
import type { RouteData, Track, TrackPoint } from '../src/types/route.ts'

// ── テストヘルパー ─────────────────────────────────────────────────────
const p = (lat: number, lng: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({ lat, lng, ...extra })

function route(over: Partial<RouteData> = {}): RouteData {
  return {
    id: 'r1',
    name: 'route',
    sourceFormat: 'gpx',
    sourceFileName: 'route.gpx',
    kind: 'track',
    tracks: [],
    standaloneWaypoints: [],
    ...over,
  }
}

// ── isRouteNameTaken ───────────────────────────────────────────────────
test('isRouteNameTaken: 同名が存在すれば true', () => {
  const routes = [route({ id: 'a', name: 'A' }), route({ id: 'b', name: 'B' })]
  assert.equal(isRouteNameTaken(routes, 'A'), true)
  assert.equal(isRouteNameTaken(routes, 'C'), false)
})

test('isRouteNameTaken: 前後空白はトリムして比較', () => {
  const routes = [route({ id: 'a', name: 'A' })]
  assert.equal(isRouteNameTaken(routes, '  A  '), true)
})

test('isRouteNameTaken: excludeId で自分自身は除外', () => {
  const routes = [route({ id: 'a', name: 'A' })]
  assert.equal(isRouteNameTaken(routes, 'A', 'a'), false)
  assert.equal(isRouteNameTaken(routes, 'A', 'other'), true)
})

// ── makeUniqueRouteName ────────────────────────────────────────────────
test('makeUniqueRouteName: 重複しなければそのまま（トリムのみ）', () => {
  const routes = [route({ id: 'a', name: 'A' })]
  assert.equal(makeUniqueRouteName(routes, 'B'), 'B')
  assert.equal(makeUniqueRouteName(routes, '  B  '), 'B')
})

test('makeUniqueRouteName: 重複すれば (2) を付ける', () => {
  const routes = [route({ id: 'a', name: 'A' })]
  assert.equal(makeUniqueRouteName(routes, 'A'), 'A (2)')
})

test('makeUniqueRouteName: (2) も埋まっていれば空き番まで進める', () => {
  const routes = [
    route({ id: 'a', name: 'A' }),
    route({ id: 'b', name: 'A (2)' }),
    route({ id: 'c', name: 'A (3)' }),
  ]
  assert.equal(makeUniqueRouteName(routes, 'A'), 'A (4)')
})

test('makeUniqueRouteName: 既存の (n) 表記は剥がさず末尾に追加する', () => {
  const routes = [route({ id: 'a', name: 'Trip (2019)' })]
  assert.equal(makeUniqueRouteName(routes, 'Trip (2019)'), 'Trip (2019) (2)')
})

test('makeUniqueRouteName: excludeId で自分自身は衝突扱いしない', () => {
  const routes = [route({ id: 'a', name: 'A' })]
  assert.equal(makeUniqueRouteName(routes, 'A', 'a'), 'A')
})

// ── dedupeConsecutivePoints ────────────────────────────────────────────
test('dedupeConsecutivePoints: 連続する同一座標・同一時刻を除去', () => {
  const t = new Date('2026-01-01T00:00:00Z')
  const pts = [p(0, 0, { time: t }), p(0, 0, { time: t }), p(0, 1, { time: t })]
  const r = dedupeConsecutivePoints(pts)
  assert.equal(r.length, 2)
})

test('dedupeConsecutivePoints: 同座標でも時刻が違えば残す', () => {
  const pts = [
    p(0, 0, { time: new Date('2026-01-01T00:00:00Z') }),
    p(0, 0, { time: new Date('2026-01-01T00:00:01Z') }),
  ]
  assert.equal(dedupeConsecutivePoints(pts).length, 2)
})

test('dedupeConsecutivePoints: 非連続の同一座標は往復とみなし保持', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 0)]
  assert.equal(dedupeConsecutivePoints(pts).length, 3)
})

test('dedupeConsecutivePoints: 空配列はそのまま', () => {
  assert.deepEqual(dedupeConsecutivePoints([]), [])
})

// ── deleteRange ────────────────────────────────────────────────────────
test('deleteRange: 指定区間（両端含む）を削除', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 2), p(0, 3), p(0, 4)]
  const r = deleteRange(pts, 1, 3)
  assert.equal(r.length, 2)
  assert.deepEqual(r.map((x) => x.lng), [0, 4])
})

test('deleteRange: start > end でも min/max で正規化', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 2), p(0, 3)]
  assert.deepEqual(deleteRange(pts, 3, 1).map((x) => x.lng), [0])
})

test('deleteRange: 単一点削除', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 2)]
  assert.deepEqual(deleteRange(pts, 1, 1).map((x) => x.lng), [0, 2])
})

// ── splitTrack ─────────────────────────────────────────────────────────
test('splitTrack: 分割点は両セグメントに含まれる', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 2), p(0, 3), p(0, 4)]
  const [before, after] = splitTrack(pts, 2)
  assert.deepEqual(before.map((x) => x.lng), [0, 1, 2])
  assert.deepEqual(after.map((x) => x.lng), [2, 3, 4])
})

test('splitTrack: 先頭で分割すると before は1点', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 2)]
  const [before, after] = splitTrack(pts, 0)
  assert.equal(before.length, 1)
  assert.equal(after.length, 3)
})

// ── reverseTrack ───────────────────────────────────────────────────────
test('reverseTrack: 順序を反転する', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 2)]
  assert.deepEqual(reverseTrack(pts).map((x) => x.lng), [2, 1, 0])
})

test('reverseTrack: 時刻データは除去される（逆行防止・要件6.10）', () => {
  const pts = [
    p(0, 0, { time: new Date('2026-01-01T00:00:00Z') }),
    p(0, 1, { time: new Date('2026-01-01T00:01:00Z') }),
  ]
  const r = reverseTrack(pts)
  assert.ok(r.every((x) => x.time === undefined))
})

test('reverseTrack: 標高等の時刻以外の属性は保持', () => {
  const pts = [p(0, 0, { ele: 10 }), p(0, 1, { ele: 20 })]
  const r = reverseTrack(pts)
  assert.deepEqual(r.map((x) => x.ele), [20, 10])
})

// ── thinOut（n点ごと） ─────────────────────────────────────────────────
test('thinOut: step ごとに残し始点・終点は必ず残す', () => {
  const pts = Array.from({ length: 10 }, (_, i) => p(0, i))
  const r = thinOut(pts, 3)
  // 0, 3, 6, 9(終点)
  assert.deepEqual(r.map((x) => x.lng), [0, 3, 6, 9])
})

test('thinOut: step<=1 や2点以下はそのまま', () => {
  const pts = [p(0, 0), p(0, 1), p(0, 2)]
  assert.equal(thinOut(pts, 1).length, 3)
  assert.equal(thinOut([p(0, 0), p(0, 1)], 5).length, 2)
})

// ── thinOutByDistance（累積距離） ──────────────────────────────────────
test('thinOutByDistance: しきい値が全長より大きいと始点・終点のみ', () => {
  const pts = [p(0, 0), p(0, 0.0001), p(0, 0.0002), p(0, 0.0003)]
  const r = thinOutByDistance(pts, 100_000)
  assert.equal(r.length, 2)
})

test('thinOutByDistance: ウェイポイント付きポイントは常に残す', () => {
  const pts = [
    p(0, 0),
    p(0, 0.0001, { waypoint: { name: 'wp' } }),
    p(0, 0.0002),
    p(0, 0.0003),
  ]
  const r = thinOutByDistance(pts, 100_000)
  // 始点・終点に加えてウェイポイント点も残る
  assert.ok(r.some((x) => x.waypoint?.name === 'wp'))
  assert.equal(r.length, 3)
})

test('thinOutByDistance: 2点以下はそのまま', () => {
  const pts = [p(0, 0), p(0, 1)]
  assert.equal(thinOutByDistance(pts, 10).length, 2)
})

// ── convertRouteKind ───────────────────────────────────────────────────
test('convertRouteKind: track→route は種別のみ変更（データ移動なし）', () => {
  const r = route({ kind: 'track', tracks: [{ points: [p(0, 0), p(0, 1)] }] })
  const c = convertRouteKind(r, 'route')
  assert.equal(c.kind, 'route')
  assert.equal(c.tracks.length, 1)
  assert.equal(c.standaloneWaypoints.length, 0)
})

test('convertRouteKind: track→waypoint は全点を standaloneWaypoints へ平坦化', () => {
  const r = route({
    kind: 'track',
    tracks: [{ points: [p(1, 1, { ele: 10 }), p(2, 2)] }, { points: [p(3, 3)] }],
  })
  const c = convertRouteKind(r, 'waypoint')
  assert.equal(c.kind, 'waypoint')
  assert.equal(c.tracks.length, 0)
  assert.equal(c.standaloneWaypoints.length, 3)
  assert.equal(c.standaloneWaypoints[0].ele, 10)
})

test('convertRouteKind: waypoint→track は wpt を1本のトラックへ昇格', () => {
  const r = route({
    kind: 'waypoint',
    tracks: [],
    standaloneWaypoints: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
  })
  const c = convertRouteKind(r, 'track')
  assert.equal(c.kind, 'track')
  assert.equal(c.tracks.length, 1)
  assert.equal(c.tracks[0].points.length, 2)
  assert.equal(c.standaloneWaypoints.length, 0)
})

test('convertRouteKind: 同一種別はそのまま返す', () => {
  const r = route({ kind: 'track' })
  assert.equal(convertRouteKind(r, 'track'), r)
})

test('convertRouteKind: waypoint→track で名前付きwptは waypoint メタを保持', () => {
  const r = route({
    kind: 'waypoint',
    tracks: [],
    standaloneWaypoints: [{ lat: 1, lng: 1, name: 'A', cmt: 'c' }],
  })
  const c = convertRouteKind(r, 'track')
  assert.equal(c.tracks[0].points[0].waypoint?.name, 'A')
})

// ── redistributeTime ───────────────────────────────────────────────────
test('redistributeTime: 先頭は開始時刻、以降は単調増加', () => {
  const start = new Date('2026-01-01T00:00:00Z')
  const pts = [p(35.0, 139.0, { ele: 0 }), p(35.001, 139.0, { ele: 0 }), p(35.002, 139.0, { ele: 0 })]
  const r = redistributeTime(pts, start)
  assert.equal(r[0].time!.getTime(), start.getTime())
  assert.ok(r[1].time!.getTime() > r[0].time!.getTime())
  assert.ok(r[2].time!.getTime() > r[1].time!.getTime())
})

test('redistributeTime: 空配列はそのまま', () => {
  assert.deepEqual(redistributeTime([], new Date()), [])
})

// ── redistributeTimeWithRange ──────────────────────────────────────────
test('redistributeTimeWithRange: 終点が指定 endTime に一致する', () => {
  const start = new Date('2026-01-01T00:00:00Z')
  const end = new Date('2026-01-01T01:00:00Z')
  const pts = [p(35.0, 139.0, { ele: 0 }), p(35.005, 139.0, { ele: 0 }), p(35.01, 139.0, { ele: 0 })]
  const r = redistributeTimeWithRange(pts, start, end)
  assert.equal(r[0].time!.getTime(), start.getTime())
  assert.equal(r[r.length - 1].time!.getTime(), end.getTime())
})

// ── shiftTime ──────────────────────────────────────────────────────────
test('shiftTime: 開始時刻の変更で全点が同じオフセットだけ移動', () => {
  const pts = [
    p(0, 0, { time: new Date('2026-01-01T09:00:00') }),
    p(0, 1, { time: new Date('2026-01-01T09:10:00') }),
  ]
  const r = shiftTime(pts, undefined, '10:00')
  assert.equal(r[0].time!.getHours(), 10)
  // 相対間隔（10分）は保持
  assert.equal(r[1].time!.getTime() - r[0].time!.getTime(), 10 * 60 * 1000)
})

test('shiftTime: 日付変更で年月日がシフトし相対間隔は保持', () => {
  const pts = [
    p(0, 0, { time: new Date('2026-01-01T09:00:00') }),
    p(0, 1, { time: new Date('2026-01-01T09:05:00') }),
  ]
  const r = shiftTime(pts, '2026-03-15', undefined)
  assert.equal(r[0].time!.getMonth(), 2) // 3月=2
  assert.equal(r[0].time!.getDate(), 15)
  assert.equal(r[1].time!.getTime() - r[0].time!.getTime(), 5 * 60 * 1000)
})

test('shiftTime: 時刻データが無ければそのまま', () => {
  const pts = [p(0, 0), p(0, 1)]
  assert.equal(shiftTime(pts, '2026-03-15', '10:00'), pts)
})

// ── merge 3方式 ────────────────────────────────────────────────────────
const T = (iso: string) => new Date(iso)

test('mergeRoutesSimple: 順序を保って単純連結（時刻不要）', () => {
  const a: Track[] = [{ points: [p(0, 0), p(0, 1)] }]
  const b: Track[] = [{ points: [p(0, 2)] }]
  const r = mergeRoutesSimple(a, b)
  assert.equal(r.length, 2)
})

test('mergeRoutesUnified: 全点を1トラックに統合し時系列ソート', () => {
  const a: Track[] = [{ points: [p(0, 0, { time: T('2026-01-01T00:02:00Z') })] }]
  const b: Track[] = [{ points: [p(0, 1, { time: T('2026-01-01T00:01:00Z') })] }]
  const r = mergeRoutesUnified(a, b)
  assert.equal(r.length, 1)
  assert.equal(r[0].points.length, 2)
  // 時刻昇順（b が先）
  assert.equal(r[0].points[0].lng, 1)
  assert.equal(r[0].points[1].lng, 0)
})

test('mergeRoutesChronological: トラック単位を保ち開始時刻順に並べる', () => {
  const later: Track[] = [{ name: 'later', points: [p(0, 0, { time: T('2026-01-01T02:00:00Z') })] }]
  const earlier: Track[] = [{ name: 'earlier', points: [p(0, 1, { time: T('2026-01-01T01:00:00Z') })] }]
  const r = mergeRoutesChronological(later, earlier)
  assert.equal(r.length, 2)
  assert.equal(r[0].name, 'earlier')
  assert.equal(r[1].name, 'later')
})

// ── extractPartialEditRange ────────────────────────────────────────────
test('extractPartialEditRange: 601点以下は全体を返す（startIndex=0）', () => {
  const pts = Array.from({ length: 100 }, (_, i) => p(0, i))
  const r = extractPartialEditRange(pts, 50)
  assert.equal(r.startIndex, 0)
  assert.equal(r.points.length, 100)
})

test('extractPartialEditRange: 601点超は中心±300を抽出', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => p(0, i))
  const r = extractPartialEditRange(pts, 500)
  assert.equal(r.startIndex, 200)
  assert.equal(r.points.length, 601) // 200..800 inclusive
})

test('extractPartialEditRange: 端付近では境界でクランプ', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => p(0, i))
  const r = extractPartialEditRange(pts, 10)
  assert.equal(r.startIndex, 0)
  assert.equal(r.points.length, 311) // 0..310
})

// ── nearestSegmentInsertIndex ──────────────────────────────────────────
test('nearestSegmentInsertIndex: 最も近いセグメント直後のインデックスを返す', () => {
  const pts = [p(0, 0), p(0, 10), p(0, 20)]
  // (0, 15) は 2番目のセグメント(10→20)の中点(15)に最も近い → index 2
  assert.equal(nearestSegmentInsertIndex(pts, 0, 15), 2)
  // (0, 5) は 1番目のセグメント(0→10)の中点(5) → index 1
  assert.equal(nearestSegmentInsertIndex(pts, 0, 5), 1)
})

// ── trackToNameLine / parseTrackNameLine ───────────────────────────────
test('trackToNameLine: 名前と番号を書式化', () => {
  assert.equal(trackToNameLine({ name: 'trk', number: 3, points: [] }), '<name>trk<number>3')
  assert.equal(trackToNameLine({ points: [] }), '<name><number>')
})

test('parseTrackNameLine: 書式から名前・番号を復元', () => {
  assert.deepEqual(parseTrackNameLine('<name>trk<number>3'), { name: 'trk', number: 3 })
})

test('parseTrackNameLine: ブランクは undefined', () => {
  assert.deepEqual(parseTrackNameLine('<name><number>'), { name: undefined, number: undefined })
})

test('trackToNameLine ⇄ parseTrackNameLine: ラウンドトリップ', () => {
  const t: Track = { name: 'My Track', number: 12, points: [] }
  const parsed = parseTrackNameLine(trackToNameLine(t))
  assert.equal(parsed.name, 'My Track')
  assert.equal(parsed.number, 12)
})

test('parseTrackNameLine: 不正な番号は undefined 扱い', () => {
  assert.deepEqual(parseTrackNameLine('<name>a<number>abc'), { name: 'a', number: undefined })
})

// ── interpolateMissingElevations ───────────────────────────────────────
test('interpolateMissingElevations: 前後の取得値から距離比で内挿', () => {
  const points = [p(0, 0), p(0, 0.001), p(0, 0.002)]
  const elevs = [0, null, 100]
  const r = interpolateMissingElevations(points, elevs)
  // 中点はほぼ中央 → 約50
  assert.ok(r[1] != null && Math.abs(r[1]! - 50) < 1, `mid=${r[1]}`)
})

test('interpolateMissingElevations: 端の欠損は最寄り値で水平外挿', () => {
  const points = [p(0, 0), p(0, 0.001), p(0, 0.002)]
  const r = interpolateMissingElevations(points, [null, 30, null])
  assert.equal(r[0], 30)
  assert.equal(r[2], 30)
})

test('interpolateMissingElevations: 全欠損は null のまま', () => {
  const points = [p(0, 0), p(0, 1)]
  assert.deepEqual(interpolateMissingElevations(points, [null, null]), [null, null])
})
