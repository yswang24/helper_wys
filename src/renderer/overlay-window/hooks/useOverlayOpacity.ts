import { useEffect, useState } from 'react'

// Overlay background opacity, hydrated from getPublicConfig (secret-free) and kept in sync via
// the overlay:opacity event. Moved verbatim from the overlay App.
export function useOverlayOpacity(): number {
  const [bgOpacity, setBgOpacity] = useState(0.94)
  useEffect(() => {
    window.electronAPI.getPublicConfig().then((cfg) => {
      if (cfg.overlayOpacity !== undefined) setBgOpacity(cfg.overlayOpacity)
    })
    const un = window.electronAPI.onOverlayOpacity((opacity) => setBgOpacity(opacity))
    return un
  }, [])
  return bgOpacity
}
