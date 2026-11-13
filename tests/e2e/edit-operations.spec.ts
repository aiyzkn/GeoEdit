/**
 * 編集操作の網羅テスト（EditModePanel / VirtualTimeline 経由）。
 *
 * ポイント選択が必要な操作（分割・区間削除）は地図canvasではなくタイムライン
 * カードのクリックで行う（helpers.selectTimelinePoint）。canvas上のポイントは
 * DOMセレクタで掴めないため。各操作の成否はトーストとルート一覧の点数表記で検証する。
 *
 * カバー範囲: 逆順 / 間引き / 時刻再計算 / 名前変更 / 分割 / 区間削除 /
 *           タイムライン複数選択削除 / ルート結合。
 * （create モードのマップクリック作成は create-route.spec.ts に分離）
 */
import {
  test, expect, setup, openFilesViaButton, selectMode, selectTimelinePoint, switchTab,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('逆順: トラックを反転し、時刻データが除去される', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // 反転前は時刻があるので統計に総所要時間が出る
  await switchTab(page, '統計')
  await expect(page.getByText(/総所要時間/)).toBeVisible()
  await expect(page.getByText('—（時刻データなし）')).toBeHidden()

  await selectMode(page, '逆順')
  await page.getByRole('button', { name: '逆順にする' }).click()
  await expect(page.getByText('トラックを逆順にしました')).toBeVisible()

  // 逆順は時刻を除去する（reverseTrack の仕様）→ 総所要時間が「—（時刻データなし）」に
  await switchTab(page, '統計')
  await expect(page.getByText('—（時刻データなし）')).toBeVisible()
})

test('間引き: 距離しきい値でポイントを削減する', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await selectMode(page, '間引き')
  // 全長より大きい距離(1000m)を指定 → 始点と終点のみ残る（累積距離が閾値に届かないため）
  const distInput = page.getByRole('spinbutton')
  await distInput.fill('1000')
  await page.getByRole('button', { name: '間引き実行' }).click()

  await expect(page.getByText(/間引き完了: \d+ ポイント削除/)).toBeVisible()
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()
})

test('時刻再計算: トーストが表示される', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await selectMode(page, '時刻編集')
  // 既定は「一括再計算」サブモード、開始日時はページ読込時刻で初期化済み。そのまま実行
  await page.getByRole('button', { name: '時刻再計算', exact: true }).click()
  await expect(page.getByText('時刻を再計算しました')).toBeVisible()
})

test('名前変更: ルート名を変更できる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('sample', { exact: true })).toBeVisible()

  await selectMode(page, '名前変更')
  // ルート名入力欄（現在名 'sample' がプリセットされている）
  const nameInput = page.getByRole('textbox').first()
  await expect(nameInput).toHaveValue('sample')
  await nameInput.fill('リネーム後ルート')
  await page.getByRole('button', { name: '変更', exact: true }).click()

  await expect(page.getByText('名前を変更しました')).toBeVisible()
  await expect(page.getByText('リネーム後ルート', { exact: true })).toBeVisible()
})

test('分割: 選択ポイントで2つのルートに分割する', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await selectMode(page, '分割')
  // タイムラインでポイント#2を選択（分割点は両セグメントに含まれる → 3点+3点）
  await selectTimelinePoint(page, 2)
  await page.getByRole('button', { name: '分割実行' }).click()

  await expect(page.getByText('ルートを2つに分割しました')).toBeVisible()
  // 元ルート 'sample'（3点）と 'sample (2)'（3点）の2ルートになる
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()
  await expect(page.getByText('sample (2)', { exact: true })).toBeVisible()
})

test('区間削除: タイムラインで開始・終了点を選び区間を削除する', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await selectMode(page, '区間削除')
  // #1 と #3 をクリック → 選択範囲 [1→3]
  await selectTimelinePoint(page, 1)
  await selectTimelinePoint(page, 3)
  // 範囲が確定すると「削除実行」ボタンが現れる
  await page.getByRole('button', { name: '削除実行' }).click()

  // インデックス1〜3の3点が削除され、5-3=2点になる
  await expect(page.getByText(/区間削除: 3 ポイント削除/)).toBeVisible()
  await expect(page.getByText('2 pts · 1 trk')).toBeVisible()
})

test('タイムライン複数選択削除: Ctrl+クリックで選んだ点を一括削除する', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // 選択モード（既定）のままタイムラインで Ctrl+クリック複数選択
  await selectTimelinePoint(page, 1, { modifiers: ['Control'] })
  await selectTimelinePoint(page, 2, { modifiers: ['Control'] })
  await expect(page.getByText('2 点選択中')).toBeVisible()

  await page.getByRole('button', { name: '選択したポイントを削除' }).click()
  await expect(page.getByText('2 点を削除しました')).toBeVisible()
  await expect(page.getByText('3 pts · 1 trk')).toBeVisible()
})

test('結合: 2つのルートを単純接続で1つにまとめる', async ({ page }) => {
  await openFilesViaButton(page, 'two-routes.geojson')
  await expect(page.getByText('2 ルート', { exact: true })).toBeVisible()

  await selectMode(page, '結合')
  // サイドバーでルートA・ルートBを順にクリックして結合対象に指定
  await page.getByText('ルートA', { exact: true }).click()
  await page.getByText('ルートB', { exact: true }).click()

  // 「単純接続」は時刻不要（2ルート選択時のみ有効化される）
  await page.getByRole('radio', { name: 'トラックの単純接続' }).check()
  await page.getByRole('button', { name: '結合実行' }).click()

  await expect(page.getByText('ルートA と ルートB を結合しました')).toBeVisible()
  // ルートBが吸収され1ルートに
  await expect(page.getByText('1 ルート', { exact: true })).toBeVisible()
})
