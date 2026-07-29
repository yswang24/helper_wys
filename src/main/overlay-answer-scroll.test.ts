import { describe, expect, it, vi } from 'vitest'
import { EVENT } from '../shared/ipc'
import {
  createOverlayAnswerScrollDispatcher,
  createOverlayAnswerScrollModeDispatcher
} from './overlay-answer-scroll'

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

  it('dispatches scroll-mode status to the current overlay window', () => {
    const overlay = fakeOverlay()
    const dispatchMode = createOverlayAnswerScrollModeDispatcher(() => overlay)

    dispatchMode(true)
    dispatchMode(false)

    expect(overlay.webContents.send).toHaveBeenNthCalledWith(
      1,
      EVENT.overlayAnswerScrollMode,
      true
    )
    expect(overlay.webContents.send).toHaveBeenNthCalledWith(
      2,
      EVENT.overlayAnswerScrollMode,
      false
    )
  })

  it('does not dispatch either event when the overlay or its web contents is unavailable', () => {
    const missing = createOverlayAnswerScrollDispatcher(() => null)
    expect(() => missing('up')).not.toThrow()
    const missingMode = createOverlayAnswerScrollModeDispatcher(() => null)
    expect(() => missingMode(true)).not.toThrow()

    const destroyedWindow = fakeOverlay({ windowDestroyed: true })
    createOverlayAnswerScrollDispatcher(() => destroyedWindow)('up')
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled()
    const destroyedWindowMode = fakeOverlay({ windowDestroyed: true })
    createOverlayAnswerScrollModeDispatcher(() => destroyedWindowMode)(true)
    expect(destroyedWindowMode.webContents.send).not.toHaveBeenCalled()

    const destroyedContents = fakeOverlay({ contentsDestroyed: true })
    createOverlayAnswerScrollDispatcher(() => destroyedContents)('down')
    expect(destroyedContents.webContents.send).not.toHaveBeenCalled()
    const destroyedContentsMode = fakeOverlay({ contentsDestroyed: true })
    createOverlayAnswerScrollModeDispatcher(() => destroyedContentsMode)(false)
    expect(destroyedContentsMode.webContents.send).not.toHaveBeenCalled()
  })
})
