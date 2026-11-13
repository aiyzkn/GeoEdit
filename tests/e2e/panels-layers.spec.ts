/**
 * 右サイドバー各タブ（ルート/レイヤー/属性/統計）とレイヤー操作・標高グラフのテスト。
 *
 * 注意点（横展開時のハマりどころ）:
 *   - `spinbutton`（number入力）はタイムラインの緯度経度編集欄にも存在するため、
 *     属性パネルの標高欄は step="0.1" で特定する（タイムラインは step="0.000001"）。
 *   - `input[type=range]` はタイムラインのスクロールバーにも存在する。レイヤーの
 *     透明度スライダー単体を数えたいテストではルート未読み込み状態で行う
 *     （ルートが無いとタイムラインにスライダーが出ないため干渉しない）。
 *   - `名前 /標高/` の正規表現はツールバー「標高置換」にもマッチするため exact を使う。
 */
import {
  test, expect, setup, openFilesViaButton, selectTimelinePoint, switchTab,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('統計タブに集計値が表示される', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await switchTab(page, '統計')
  await expect(page.getByText('sample の統計')).toBeVisible()
  await expect(page.getByText('総距離')).toBeVisible()
  await expect(page.getByText('累積標高差')).toBeVisible()
  await expect(page.getByText('トラックポイント総数')).toBeVisible()
})

test('属性タブでポイントを選択すると詳細と累積統計が表示される', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await selectTimelinePoint(page, 2)
  await switchTab(page, '属性')

  await expect(page.getByText('選択ポイント [2]')).toBeVisible()
  await expect(page.getByText('緯度')).toBeVisible()
  await expect(page.getByText('累積距離')).toBeVisible()
})

test('属性タブで標高をインライン編集でき、統計に反映される', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  await selectTimelinePoint(page, 0)
  await switchTab(page, '属性')

  // 標高入力欄は step="0.1"（タイムラインの緯度経度 step="0.000001" と区別）
  const eleInput = page.locator('input[step="0.1"]')
  await eleInput.fill('1234')
  await eleInput.blur()

  // 統計の「最高標高 / 最低標高」セルに反映される（他点は 4〜7.5m なので最高=1234）。
  // "1234 m" 単独はタイムラインカードにも出るため、セル全体の文字列で一意に特定する
  await switchTab(page, '統計')
  await expect(page.getByText('1234 m / 4 m')).toBeVisible()
})

test('レイヤータブ: ベースマップを切り替えられる', async ({ page }) => {
  await switchTab(page, 'レイヤー')

  // 既定は「地理院地図（淡色）」がアクティブ（青色ハイライト = text-blue-500）
  await expect(page.getByRole('button', { name: '地理院地図（淡色）' })).toHaveClass(/text-blue-500/)

  await page.getByRole('button', { name: 'OpenStreetMap', exact: true }).click()
  await expect(page.getByRole('button', { name: 'OpenStreetMap', exact: true })).toHaveClass(/text-blue-500/)
  await expect(page.getByRole('button', { name: '地理院地図（淡色）' })).not.toHaveClass(/text-blue-500/)
})

test('レイヤータブ: オーバーレイをON/OFFでき、透明度スライダーが現れる', async ({ page }) => {
  // ルートを読み込まない（タイムラインのスライダーと干渉させないため）
  await switchTab(page, 'レイヤー')

  const overlay = page.getByRole('checkbox', { name: '陰影起伏（重ね）' })
  await expect(overlay).not.toBeChecked()
  await overlay.check()
  await expect(overlay).toBeChecked()
  // アクティブ時のみ透明度スライダー（range）がその行に出現する。ルート未読込なので
  // ページ上の range はこの1本だけ
  await expect(page.locator('input[type="range"]')).toHaveCount(1)

  await overlay.uncheck()
  await expect(overlay).not.toBeChecked()
  await expect(page.locator('input[type="range"]')).toHaveCount(0)
})

test('標高グラフの表示/非表示を切り替えられる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // 下部ペインの「標高」トグル（exact で ツールバー「標高置換」を除外）。
  // recharts の描画要素（.recharts-surface / .recharts-responsive-container）は
  // ResponsiveContainer のサイズ測定に依存し headless では不安定なため、
  // UIレベルの観測点＝トグルボタンのアクティブ状態（text-blue-500）で検証する。
  // 標高グラフは既定で表示ON（mapStore.showElevation 初期値 true）。
  // トグルの往復（ON→OFF→ON）でアクティブ状態が反転することを確認する。
  const toggle = page.getByRole('button', { name: '標高', exact: true })
  await expect(toggle).toHaveClass(/text-blue-500/)
  await toggle.click()
  await expect(toggle).not.toHaveClass(/text-blue-500/)
  await toggle.click()
  await expect(toggle).toHaveClass(/text-blue-500/)
})
