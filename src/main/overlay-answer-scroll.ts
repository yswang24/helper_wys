import { EVENT } from '../shared/ipc'
import type { AnswerScrollDirection } from '../shared/ipc'

interface OverlayScrollTarget {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send(channel: typeof EVENT.overlayAnswerScroll, payload: AnswerScrollDirection): void
    send(channel: typeof EVENT.overlayAnswerScrollMode, payload: boolean): void
  }
}

/**
 * Creates a safe main-to-overlay dispatcher for the global answer-scroll shortcuts.
 *
 * The getter is intentionally resolved on every trigger because OverlayController can rebuild its
 * BrowserWindow after a renderer crash.
 */
export function createOverlayAnswerScrollDispatcher(
  getOverlayWindow: () => OverlayScrollTarget | null
): (direction: AnswerScrollDirection) => void {
  return (direction) => {
    const overlayWindow = getOverlayWindow()
    if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.webContents.isDestroyed()) {
      return
    }
    overlayWindow.webContents.send(EVENT.overlayAnswerScroll, direction)
  }
}

export function createOverlayAnswerScrollModeDispatcher(
  getOverlayWindow: () => OverlayScrollTarget | null
): (active: boolean) => void {
  return (active) => {
    const overlayWindow = getOverlayWindow()
    if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.webContents.isDestroyed()) {
      return
    }
    overlayWindow.webContents.send(EVENT.overlayAnswerScrollMode, active)
  }
}
