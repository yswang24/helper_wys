import { describe, expect, it, vi } from 'vitest'
import {
  REGION_SCREENSHOT_SHORTCUT,
  REGION_SCREENSHOT_SHORTCUT_LABEL,
  registerRegionScreenshotShortcut
} from './region-screenshot-shortcut'

describe('registerRegionScreenshotShortcut', () => {
  it('registers Option+Command+Z and routes it to the existing selector action', () => {
    let handler: (() => void) | undefined
    const toggleSelector = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: (accelerator, callback) => {
          expect(accelerator).toBe('CommandOrControl+Alt+Z')
          handler = callback
          return true
        },
        toggleSelector,
        onUnavailable: unavailable
      })
    ).toBe(true)

    expect(REGION_SCREENSHOT_SHORTCUT).toBe('CommandOrControl+Alt+Z')
    expect(REGION_SCREENSHOT_SHORTCUT_LABEL).toBe('Option+Command+Z')
    handler?.()
    expect(toggleSelector).toHaveBeenCalledOnce()
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('reports registration rejection without opening the selector', () => {
    const toggleSelector = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: () => false,
        toggleSelector,
        onUnavailable: unavailable
      })
    ).toBe(false)

    expect(toggleSelector).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledWith('可能被其他应用占用')
  })

  it('reports a registration exception without opening the selector', () => {
    const toggleSelector = vi.fn()
    const unavailable = vi.fn()

    expect(
      registerRegionScreenshotShortcut({
        register: () => {
          throw new Error('registration denied')
        },
        toggleSelector,
        onUnavailable: unavailable
      })
    ).toBe(false)

    expect(toggleSelector).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledWith('registration denied')
  })
})
