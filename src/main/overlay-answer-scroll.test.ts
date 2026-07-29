import { describe, expect, it, vi } from 'vitest'
import { EVENT } from '../shared/ipc'
import { createOverlayAnswerScrollDispatcher } from './overlay-answer-scroll'

function fakeOverlay(overrides: { windowDestroyed?: boolean; contentsDestroyed?: boolean } = {}) {
  return {
    isDestroyed: () => overrides.windowDestroyed ?? false,
    webContents: {
      isDestroyed: () => overrides.contentsDestroyed ?? false,
      send: vi.fn()
    }
  }
}

describe('createOverlayAnswerScrollDispatcher', () => {
  it('dispatches typed directions to the current overlay window', () => {
    const overlay = fakeOverlay()
    const dispatch = createOverlayAnswerScrollDispatcher(() => overlay)

    dispatch('up')
    dispatch('down')

    expect(overlay.webContents.send).toHaveBeenNthCalledWith(1, EVENT.overlayAnswerScroll, 'up')
    expect(overlay.webContents.send).toHaveBeenNthCalledWith(2, EVENT.overlayAnswerScroll, 'down')
  })

  it('does nothing when the overlay or its web contents is unavailable', () => {
    const missing = createOverlayAnswerScrollDispatcher(() => null)
    expect(() => missing('up')).not.toThrow()

    const destroyedWindow = fakeOverlay({ windowDestroyed: true })
    createOverlayAnswerScrollDispatcher(() => destroyedWindow)('up')
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled()

    const destroyedContents = fakeOverlay({ contentsDestroyed: true })
    createOverlayAnswerScrollDispatcher(() => destroyedContents)('down')
    expect(destroyedContents.webContents.send).not.toHaveBeenCalled()
  })
})
