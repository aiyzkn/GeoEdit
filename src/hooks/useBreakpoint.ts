import { useEffect, useState } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

function calc(): Breakpoint {
  const w = window.innerWidth
  if (w < 768) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

/** 基本設計書16.1のブレークポイント（<768px モバイル / 768〜1024px タブレット / >=1024px PC）を判定する。 */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(calc)

  useEffect(() => {
    const mqMobile = window.matchMedia('(max-width: 767px)')
    const mqTablet = window.matchMedia('(min-width: 768px) and (max-width: 1023px)')
    const handler = () => setBp(calc())
    mqMobile.addEventListener('change', handler)
    mqTablet.addEventListener('change', handler)
    return () => {
      mqMobile.removeEventListener('change', handler)
      mqTablet.removeEventListener('change', handler)
    }
  }, [])

  return bp
}
