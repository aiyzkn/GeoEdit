import { useEffect } from 'react'
import { useUiStore } from '@/stores/uiStore'
import AppLayout from '@/components/layout/AppLayout'

export default function App() {
  const { theme, setTheme } = useUiStore()

  useEffect(() => {
    setTheme(theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (useUiStore.getState().theme === 'system') {
        setTheme('system')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return <AppLayout />
}
