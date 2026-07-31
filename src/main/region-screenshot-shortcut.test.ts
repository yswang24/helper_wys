import { describe, expect, it, vi } from 'vitest'
import {
  REGION_SCREENSHOT_SHORTCUT,
  REGION_SCREENSHOT_SHORTCUT_LABEL,
  registerRegionScreenshotShortcut
} from './region-screenshot-shortcut'

describe('registerRegionScreenshotShortcut', () => {
  it('registers Option+Command+Z and toggles the selector', () => {
    let handler: (() => void) | undefined
    const toggleSelector = vi.fn()
    const onUnavailable = vi.fn()
    const register = vi.fn((accelerator: string, callback: () => void) => {
      handler = callback
      return true
    })

    expect(registerRegionScreenshotShortcut({ register, toggleSelector, onUnavailable })).toBe(true)
    expect(REGION_SCREENSHOT_SHORTCUT).toBe('CommandOrControl+Alt+Z')
    expect(REGION_SCREENSHOT_SHORTCUT_LABEL).toBe('Option+Command+Z')
    expect(register).toHaveBeenCalledWith(REGION_SCREENSHOT_SHORTCUT, expect.any(Function))

    handler?.()
    expect(toggleSelector).toHaveBeenCalledOnce()
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('reports an unavailable shortcut', () => {
    const onUnavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: () => false,
        toggleSelector: vi.fn(),
        onUnavailable
      })
    ).toBe(false)
    expect(onUnavailable).toHaveBeenCalledWith('可能被其他应用占用')
  })

  it('reports registration errors', () => {
    const onUnavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: () => {
          throw new Error('registration failed')
        },
        toggleSelector: vi.fn(),
        onUnavailable
      })
    ).toBe(false)
    expect(onUnavailable).toHaveBeenCalledWith('registration failed')
  })
})
