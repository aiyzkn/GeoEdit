import { useCallback, useState } from 'react'
import { useFileLoader } from './useFileLoader'

export function useDropZone() {
  const { loadFiles } = useFileLoader()
  const [isDragOver, setIsDragOver] = useState(false)

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      const files = e.dataTransfer.files
      if (files.length > 0) loadFiles(files)
    },
    [loadFiles]
  )

  return { isDragOver, onDragOver, onDragLeave, onDrop }
}
