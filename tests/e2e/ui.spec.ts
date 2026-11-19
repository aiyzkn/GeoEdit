/**
 * UI 全般のテスト。
 *   - テーマ切替（ライト/ダーク）
 *   - ヘルプ / バージョン情報ダイアログ
 *   - 地名検索（ジオコーディングAPIをモック: 成功・0件）
 *   - キーボードショートカット（Ctrl+O でファイル選択、Escape でモード解除）
 */
import { test, expect, setup, openFilesViaButton, selectMode, fixture } from './helpers'

test.beforeEach(async ({ page }) => {
  await setup(page)
})

test('テーマを切り替えられる（ダーク⇄ライト）', async ({ page }) => {
  const html = page.locator('html')

  // Playwright の既定 colorScheme は light。初期はダーククラスなし
  await expect(html).not.toHaveClass(/dark/)

  await page.getByRole('button', { name: 'ダーク' }).click()
  await expect(html).toHaveClass(/dark/)

  await page.getByRole('button', { name: 'ライト' }).click()
  await expect(html).not.toHaveClass(/dark/)
})

test('ヘルプダイアログを開閉できる', async ({ page }) => {
  await page.getByRole('button', { name: 'ヘルプ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'ヘルプ' })).toBeVisible()
  await expect(dialog.getByText('基本操作')).toBeVisible()
  await expect(dialog.getByText('編集機能')).toBeVisible()

  // ヘッダーの閉じるボタン（X アイコン、Modal 内）で閉じる
  await dialog.getByRole('button').first().click()
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('バージョン情報ダイアログを開ける', async ({ page }) => {
  await page.getByRole('button', { name: /バージョン情報/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'GeoJSON / GPX / KML Editor' })).toBeVisible()
  // "v1.0.0" はタイトルと変更履歴の両方に出るため first() でタイトル側に限定する
  await expect(dialog.getByText('v1.0.0').first()).toBeVisible()
  await expect(dialog.getByText('技術スタック')).toBeVisible()
  await expect(dialog.getByText('変更履歴')).toBeVisible()
})

test('地名検索: 結果が表示されジャンプできる（APIモック）', async ({ page }) => {
  // beforeEach の既定モックより後に登録して msearch 応答を差し替える（後勝ち）
  await page.route(/msearch\.gsi\.go\.jp/, async (route) => {
    await route.fulfill({
      json: [
        {
          geometry: { type: 'Point', coordinates: [139.767, 35.681] },
          properties: { title: '東京駅', addressCode: '13101' },
        },
      ],
    })
  })

  await page.getByPlaceholder('地名・住所を検索').fill('東京駅')
  await page.getByRole('button', { name: '検索' }).click()

  // 結果リストに候補が出る
  const result = page.getByRole('button', { name: '東京駅' })
  await expect(result).toBeVisible()
  // クリックしてジャンプ（例外なく閉じることを確認）
  await result.click()
  await expect(result).toBeHidden()
})

test('地名検索: 0件のときは通知トーストを表示する', async ({ page }) => {
  // 既定モックが msearch へ空配列を返す
  await page.getByPlaceholder('地名・住所を検索').fill('存在しない地名XYZ')
  await page.getByRole('button', { name: '検索' }).click()
  await expect(page.getByText('該当する地名が見つかりませんでした')).toBeVisible()
})

test('Ctrl+O でファイル選択ダイアログが開く', async ({ page }) => {
  // Ctrl+O は open-files カスタムイベント経由で input.click() を発火する
  const chooserPromise = page.waitForEvent('filechooser')
  await page.keyboard.press('Control+o')
  const chooser = await chooserPromise
  await chooser.setFiles(fixture('sample.gpx'))
  await expect(page.getByText('読み込み完了: sample.gpx')).toBeVisible()
})

test('Escape で編集モードを解除できる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()

  // 逆順モードに入るとパネルにボタンが出る
  await selectMode(page, '逆ルート')
  await expect(page.getByRole('button', { name: '逆ルートにする' })).toBeVisible()

  // Escape でモード解除 → パネルが消える
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '逆ルートにする' })).toBeHidden()
})

test('Enter で、いまのモードの実行ボタンと同じ処理をする（逆ルート）', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await selectMode(page, '逆ルート')
  await page.locator('.leaflet-container').click({ position: { x: 20, y: 300 } }) // フォーカスをボタンから外す
  await page.keyboard.press('Enter')
  await expect(page.getByText('逆ルートにしました')).toBeVisible()
})

test('Enter: モーダルが開いている間は、全体の確定は動かない。Escape でモーダルが閉じる', async ({ page }) => {
  await openFilesViaButton(page, 'sample.gpx')
  await expect(page.getByText('5 pts · 1 trk')).toBeVisible()
  await selectMode(page, '逆ルート')
  await page.getByRole('button', { name: '出力', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('heading').click() // フォーカスをボタンから外す
  await page.keyboard.press('Enter')
  await expect(page.getByText('逆ルートにしました')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  // モーダルを閉じても、モードは残る（Escape はモーダルだけを閉じる）
  await expect(page.getByRole('button', { name: '逆ルートにする' })).toBeVisible()
})

test('リサイズハンドルは矢印キーでも動く', async ({ page }) => {
  const sep = page.getByRole('separator', { name: '下側のタイムラインの高さ' })
  const before = Number(await sep.getAttribute('aria-valuenow'))
  await sep.focus()
  await page.keyboard.press('ArrowUp')
  await expect(sep).toHaveAttribute('aria-valuenow', String(before + 16))
})

test('モバイル: ヘッダーのボタンで、ルートなどのパネルが下からのシートで開く', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await openFilesViaButton(page, 'sample.gpx')
  await page.getByRole('button', { name: '右側のパネルを開く' }).click()
  const sheet = page.getByRole('region', { name: 'ルート・レイヤー・属性・統計' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('sample', { exact: false }).first()).toBeVisible()
  await sheet.getByRole('button', { name: '閉じる' }).click()
  await expect(sheet).toBeHidden()
})
