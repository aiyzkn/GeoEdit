// 地理院地図（標準地図）の画像タイルを取って画素を読む（ブラウザ・Worker 用。§13）。
// 表示中の背景地図に関係なく取る（方針の設計書 §10.2 の Q2）。CORS は許可されている（マップマッチングで読めている）。

import type { RasterSource } from './lane.ts'

export const STD_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'

/** OffscreenCanvas と createImageBitmap が使えるとき（ブラウザ・Worker）だけ使える。使えなければ null */
export function browserStdRaster(): RasterSource | null {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null
  return async (z, x, y, signal) => {
    const url = STD_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const bmp = await createImageBitmap(await res.blob())
    try {
      const canvas = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bmp, 0, 0)
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height)
      return { width: img.width, height: img.height, data: img.data }
    } finally {
      bmp.close()
    }
  }
}
