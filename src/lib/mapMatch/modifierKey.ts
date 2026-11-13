/**
 * マップマッチング一時無効化用の修飾キー（Ctrl / macOS の Cmd）押下状態トラッカー。
 * クリック時は LeafletMouseEvent.originalEvent から直接取れるが、
 * マーカーの dragend には修飾キー情報がないため window でグローバルに追跡する。
 */

let pressed = false

if (typeof window !== 'undefined') {
  const update = (e: KeyboardEvent) => {
    pressed = e.ctrlKey || e.metaKey
  }
  window.addEventListener('keydown', update)
  window.addEventListener('keyup', update)
  // タブ切替や OS ショートカットで keyup を取り逃がした場合のリセット
  window.addEventListener('blur', () => {
    pressed = false
  })
}

export function isMatchModifierPressed(): boolean {
  return pressed
}
