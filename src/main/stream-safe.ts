import type { BrowserWindow } from 'electron'

// Shared stream serialization used by the llm / asr / screenshot domains. Extracted verbatim so
// the drain-then-start guard lives in one place. NOTE: this polls isCurrentlyStreaming() on a
// timer — it NEVER awaits a (possibly hung) stream promise, so a stuck stream is force-disowned
// after ~4s rather than blocking the next one forever.

export interface StreamSafeDeps {
  isCurrentlyStreaming: () => boolean
  stopStreaming: () => void
  forceResetStreaming: () => void
  getOverlayWindow: () => BrowserWindow | null
  ensureOverlayVisible: () => void
}

export interface StreamSafe {
  waitForStreamEnd: (callback: () => void) => void
  startStreamSafely: (run: (win: BrowserWindow) => void) => void
}

export function createStreamSafe(deps: StreamSafeDeps): StreamSafe {
  function waitForStreamEnd(callback: () => void): void {
    if (!deps.isCurrentlyStreaming()) {
      callback()
      return
    }
    let checks = 0
    const tick = (): void => {
      if (!deps.isCurrentlyStreaming()) {
        callback()
        return
      }
      if (++checks > 80) {
        // 80 * 50ms = 4s max
        deps.forceResetStreaming()
        callback()
        return
      }
      setTimeout(tick, 50)
    }
    tick()
  }

  // Begin a new stream, first draining any in-flight one. `run` is re-guarded at call time because
  // waitForStreamEnd can defer it up to ~4s, by which point the overlay may have been destroyed —
  // streaming into a dead window would throw.
  function startStreamSafely(run: (win: BrowserWindow) => void): void {
    const start = (): void => {
      const overlayWindow = deps.getOverlayWindow()
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        deps.ensureOverlayVisible() // a hidden overlay would otherwise swallow the answer silently
        run(overlayWindow)
      }
    }
    if (deps.isCurrentlyStreaming()) {
      deps.stopStreaming()
      waitForStreamEnd(start)
    } else {
      start()
    }
  }

  return { waitForStreamEnd, startStreamSafely }
}
