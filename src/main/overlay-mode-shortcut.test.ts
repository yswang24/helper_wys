import { describe, expect, it, vi } from 'vitest'
import { OVERLAY_MODE_SHORTCUT, registerOverlayModeShortcut } from './overlay-mode-shortcut'

describe('registerOverlayModeShortcut', () => {
  it('registers Option+Command+X and routes it to the existing mode action', () => {
    let handler: (() => void) | undefined
    const toggleOverlayMode = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerOverlayModeShortcut({
        register: (accelerator, callback) => {
          expect(accelerator).toBe('CommandOrControl+Alt+X')
          handler = callback
          return true
        },
        toggleOverlayMode,
        onUnavailable: unavailable
      })
    ).toBe(true)

    expect(OVERLAY_MODE_SHORTCUT).toBe('CommandOrControl+Alt+X')
    handler?.()
    expect(toggleOverlayMode).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('reports registration rejection without changing overlay mode', () => {
    const toggleOverlayMode = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerOverlayModeShortcut({
        register: () => false,
        toggleOverlayMode,
        onUnavailable: unavailable
      })
    ).toBe(false)

    expect(toggleOverlayMode).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledWith('可能被其他应用占用')
  })

  it('reports a registration exception without changing overlay mode', () => {
    const toggleOverlayMode = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerOverlayModeShortcut({
        register: () => {
          throw new Error('registration denied')
        },
        toggleOverlayMode,
        onUnavailable: unavailable
      })
    ).toBe(false)

    expect(toggleOverlayMode).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledWith('registration denied')
  })
})
