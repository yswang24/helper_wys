import { describe, expect, it, vi } from 'vitest'
import {
  OVERLAY_MODE_SHORTCUT,
  OVERLAY_MODE_SHORTCUT_LABEL,
  registerOverlayModeShortcut
} from './overlay-mode-shortcut'

describe('registerOverlayModeShortcut', () => {
  it('registers Option+Command+X and dispatches the overlay mode action', () => {
    let handler: (() => void) | undefined
    const toggleOverlayMode = vi.fn()
    const onUnavailable = vi.fn()
    const register = vi.fn((accelerator: string, callback: () => void) => {
      handler = callback
      return true
    })

    expect(registerOverlayModeShortcut({ register, toggleOverlayMode, onUnavailable })).toBe(true)
    expect(OVERLAY_MODE_SHORTCUT).toBe('CommandOrControl+Alt+X')
    expect(OVERLAY_MODE_SHORTCUT_LABEL).toBe('Option+Command+X')
    expect(register).toHaveBeenCalledWith(OVERLAY_MODE_SHORTCUT, expect.any(Function))

    handler?.()
    expect(toggleOverlayMode).toHaveBeenCalledOnce()
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('reports a collision without running the action', () => {
    const toggleOverlayMode = vi.fn()
    const onUnavailable = vi.fn()

    expect(
      registerOverlayModeShortcut({
        register: () => false,
        toggleOverlayMode,
        onUnavailable
      })
    ).toBe(false)

    expect(toggleOverlayMode).not.toHaveBeenCalled()
    expect(onUnavailable).toHaveBeenCalledWith('可能被其他应用占用')
  })

  it('reports registration errors', () => {
    const onUnavailable = vi.fn()

    expect(
      registerOverlayModeShortcut({
        register: () => {
          throw new Error('registration failed')
        },
        toggleOverlayMode: vi.fn(),
        onUnavailable
      })
    ).toBe(false)

    expect(onUnavailable).toHaveBeenCalledWith('registration failed')
  })
})
