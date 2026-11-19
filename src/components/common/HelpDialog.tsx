import { useUiStore } from '@/stores/uiStore'
import Modal from './Modal'

export default function HelpDialog() {
  const { showHelp, setShowHelp } = useUiStore()
  if (!showHelp) return null

  return (
    <Modal title={<h2 className="text-base font-semibold">ヘルプ</h2>} onClose={() => setShowHelp(false)} widthClassName="w-[480px]">
      <div className="space-y-4">
        <section>
          <h3 className="font-semibold mb-2 text-sm">基本操作</h3>
          <table className="w-full">
            <tbody className="divide-y divide-[var(--color-border)]">
              {[
                ['ファイルを開く', 'ツールバー「開く」ボタン / ドラッグ＆ドロップ / Ctrl+O（Mac: Cmd+O）'],
                ['ファイル形式', 'GeoJSON, GPX, KML に対応'],
                ['元に戻す', 'Ctrl+Z（Mac: Cmd+Z）'],
                ['やり直し', 'Ctrl+Y / Ctrl+Shift+Z（Mac: Cmd+Shift+Z）'],
                ['地図を広げる', 'ヘッダーの右端のボタンで、下側のタイムラインと右側のパネルを折りたたむ／開く（状態はブラウザに残る）'],
                ['モードキャンセル', 'Escape'],
                ['確定・実行', 'Enter（いまのモードの確定・実行ボタンと同じ。入力欄・ボタンにフォーカスがあるときは、その欄・ボタンの動き）'],
              ].map(([k, v]) => (
                <tr key={k} className="py-1">
                  <td className="pr-4 py-1 text-[var(--color-muted)] whitespace-nowrap">{k}</td>
                  <td className="py-1">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="font-semibold mb-2 text-sm">編集機能</h3>
          <table className="w-full">
            <tbody className="divide-y divide-[var(--color-border)]">
              {[
                ['ルート作成', '地図をクリックして通過点を追加し、確定で新規ルートを作成。「経路探索」が ON なら、通過点の間を道路に沿って自動で結ぶ（上位の道路を優先。強さや高速・有料の利用は歯車の設定で変更）。通過点はドラッグで移動、クリックで削除。Ctrl（⌘）+ クリックの区間は直線。「作成先」で既存ルートの末尾・先頭への追記も選べる'],
                ['分割', '地図またはタイムラインでポイントを選択して2つのルートに分割'],
                ['部分削除', '開始・終了ポイントを選択して区間を削除'],
                ['道なり補正', '開始・終了ポイントを選択して「引き直す」で、その間を道路に沿って引き直す（両端の点は残る。間のウェイポイント・心拍などの拡張データは消える）'],
                ['部分編集', 'ポイントをドラッグして位置を修正'],
                ['間引き', '道のりの間隔、または形を保つ方式（カーブの頂点を残し、元の線からのずれを許容以内に）でポイントを間引き'],
                ['時間変更', '徒歩（傾斜を考慮）または一定の速度で時刻を再計算（一括再計算）、または全体をずらす（シフト）'],
                ['逆ルート', 'トラックのポイント順を逆にする（始点と終点を入れ替える）'],
                ['標高置換', '国土地理院APIから標高データを取得して置換'],
              ].map(([k, v]) => (
                <tr key={k} className="py-1">
                  <td className="pr-4 py-1 text-[var(--color-muted)] whitespace-nowrap">{k}</td>
                  <td className="py-1">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="font-semibold mb-2 text-sm">出力形式</h3>
          <ul className="space-y-1 text-[var(--color-muted)]">
            <li>• GPX（オリジナル / 最小 × ウェイポイント有無）</li>
            <li>• GeoJSON</li>
            <li>• KML</li>
          </ul>
        </section>
      </div>
    </Modal>
  )
}
