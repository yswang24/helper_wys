import { useEffect, useState } from 'react'
import type { OverlayMode } from '../../../shared/ipc'

// Reflects the main-process passthrough/interactive mode (display-only badge).
export function useOverlayMode(): OverlayMode {
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('passthrough')
  useEffect(() => window.electronAPI.onOverlayMode(setOverlayMode), [])
  return overlayMode
}
