import { useState } from 'react'
import Modal from '@/components/common/Modal'
import { useEditorStore } from '@/stores/editorStore'
import { DEFAULT_ROUTING_SETTINGS, LIMITS, presetParams, type ClassWeights, type PriorityPreset } from '@/lib/routing/settings'

interface Props {
  onClose: (changed: boolean) => void
}

const PRESETS: { value: PriorityPreset; label: string; desc: string }[] = [
  { value: 'strong', label: '強い', desc: '上位の道路へ大きく回り込む' },
  { value: 'standard', label: '標準', desc: '高速 ＞ 有料 ＞ 国道 ＞ 県道 ＞ 市区町村道 ＞ 里道 を優先し、抜け道を通らない' },
  { value: 'weak', label: '弱い', desc: '少しだけ上位の道路を好む' },
  { value: 'shortest', label: '最短', desc: '道路の種類を見ず、道のりが最短' },
  { value: 'custom', label: 'カスタム', desc: '重みと抜け道の罰則を自分で決める' },
]

const CLASS_LABELS = ['里道', '市区町村道', '県道', '国道', '有料道路', '高速道路']

/** 数値の入力欄。入力を確定したとき（blur・Enter）に範囲へ丸めて保存する */
function NumberField({ label, value, min, max, step, unit, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onCommit: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (prev !== value) { setPrev(value); setText(String(value)) }
  const commit = () => {
    const v = Number(text)
    if (text.trim() === '' || !Number.isFinite(v)) { setText(String(value)); return }
    onCommit(v)
  }
  return (
    <label className="flex items-center gap-2">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="number"
        aria-label={label}
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        className="w-24 px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-[var(--color-fg)]"
      />
      {unit && <span className="text-[var(--color-muted)]">{unit}</span>}
    </label>
  )
}

/** 経路探索の設定（利用者ごと。designs/経路探索詳細設計書.md §11.2） */
export default function RoutingSettingsDialog({ onClose }: Props) {
  const settings = useEditorStore((s) => s.routingSettings)
  const setRoutingSettings = useEditorStore((s) => s.setRoutingSettings)
  const [opened] = useState(() => JSON.stringify(useEditorStore.getState().routingSettings))

  const close = () => onClose(JSON.stringify(useEditorStore.getState().routingSettings) !== opened)

  const choosePreset = (preset: PriorityPreset) => {
    if (preset === 'custom' && settings.preset !== 'custom') {
      // カスタムに切り替えたときは、いまのプリセットの値から始める
      const base = presetParams(settings.preset)
      setRoutingSettings({ preset, weights: [...base.weights] as ClassWeights, valleyPenaltyM: base.valleyPenaltyM })
    } else {
      setRoutingSettings({ preset })
    }
  }

  const setWeight = (i: number, v: number) => {
    const w = [...settings.weights] as ClassWeights
    w[i] = v
    setRoutingSettings({ weights: w })
  }

  return (
    <Modal
      title={<h2 className="text-sm font-semibold">経路探索の設定</h2>}
      onClose={close}
      footer="設定はこのブラウザに保存されます。変えた設定は、これから引く区間に使われます（引いた区間は「引き直す」で反映）。"
    >
      <div className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="font-semibold mb-1">使う道路</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.avoidMotorway || settings.avoidToll}
              disabled={settings.avoidToll}
              onChange={(e) => setRoutingSettings({ avoidMotorway: e.target.checked })} />
            高速道路を使わない
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.avoidToll}
              onChange={(e) => setRoutingSettings({ avoidToll: e.target.checked })} />
            有料道路を使わない（高速道路も使わない）
          </label>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="font-semibold mb-1">上位の道路を優先する強さ</legend>
          {PRESETS.map((p) => (
            <label key={p.value} className="flex items-start gap-2">
              <input type="radio" name="routing-preset" checked={settings.preset === p.value} onChange={() => choosePreset(p.value)} className="mt-0.5" />
              <span><span className="font-medium">{p.label}</span><span className="text-[var(--color-muted)]"> — {p.desc}</span></span>
            </label>
          ))}
          {settings.preset === 'custom' && (
            <div className="mt-2 ml-5 space-y-1">
              <div className="text-[var(--color-muted)]">道のりにかける重み（小さいほど優先。{LIMITS.weight.min}〜{LIMITS.weight.max}）</div>
              {CLASS_LABELS.map((label, i) => (
                <NumberField key={label} label={label} value={settings.weights[i]} min={LIMITS.weight.min} max={LIMITS.weight.max} step={0.1}
                  onCommit={(v) => setWeight(i, v)} />
              ))}
              <NumberField label="抜け道の罰則" value={settings.valleyPenaltyM} min={LIMITS.valleyPenaltyM.min} max={LIMITS.valleyPenaltyM.max} step={100} unit="m 相当 / 段"
                onCommit={(v) => setRoutingSettings({ valleyPenaltyM: v })} />
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="font-semibold mb-1">通過点を道路へ寄せる</legend>
          <NumberField label="寄せる距離" value={settings.snapRadiusM} min={LIMITS.snapRadiusM.min} max={LIMITS.snapRadiusM.max} step={5} unit="m 以内"
            onCommit={(v) => setRoutingSettings({ snapRadiusM: v })} />
          <NumberField label="高速・トンネル" value={settings.snapMotorwayBiasM} min={LIMITS.snapMotorwayBiasM.min} max={LIMITS.snapMotorwayBiasM.max} step={5} unit="m 遠いものとして比べる"
            onCommit={(v) => setRoutingSettings({ snapMotorwayBiasM: v })} />
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="font-semibold mb-1">地図画像に合わせる</legend>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={settings.laneMatch} onChange={(e) => setRoutingSettings({ laneMatch: e.target.checked })} className="mt-0.5" />
            <span>
              分離帯のある道路の線を、地理院地図（標準地図）の画像に合わせる
              <span className="block text-[var(--color-muted)]">分離帯が描かれている所は進む向きの左側（左側通行）の車道の中心へ、描かれていない所は道路全体の中心へ寄せます。表示中の背景地図に関係なく、標準地図の画像（最大ズーム）を取得します</span>
            </span>
          </label>
        </fieldset>

        <div className="flex justify-between">
          <button
            onClick={() => setRoutingSettings({ ...DEFAULT_ROUTING_SETTINGS, enabled: settings.enabled, weights: [...DEFAULT_ROUTING_SETTINGS.weights] as ClassWeights })}
            className="px-2 py-1 bg-[var(--color-border)] rounded hover:opacity-80"
          >
            既定に戻す
          </button>
          <button onClick={close} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500">閉じる</button>
        </div>
      </div>
    </Modal>
  )
}
