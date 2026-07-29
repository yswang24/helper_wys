import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureMocks = vi.hoisted(() => ({
  capture: vi.fn()
}))

const displayMocks = vi.hoisted(() => {
  const pointerDisplay = {
    id: 7,
    bounds: { x: -1728, y: 0, width: 1728, height: 1117 },
    scaleFactor: 2
  }
  return {
    pointerDisplay,
    getCursorScreenPoint: vi.fn(() => ({ x: -800, y: 400 })),
    getDisplayNearestPoint: vi.fn(() => pointerDisplay)
  }
})

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn() },
  screen: {
    getAllDisplays: () => [],
    getPrimaryDisplay: () => ({ id: 1 }),
    getCursorScreenPoint: displayMocks.getCursorScreenPoint,
    getDisplayNearestPoint: displayMocks.getDisplayNearestPoint
  },
  systemPreferences: {
    getMediaAccessStatus: () => 'granted'
  }
}))

vi.mock('./capture', () => ({
  captureRegionNative: captureMocks.capture,
  captureRegionDesktop: captureMocks.capture
}))

import {
  captureFullScreenAndSubmit,
  createFullScreenCaptureTrigger,
  type ScreenshotDeps
} from './index'

describe('full-screen screenshot shortcut', () => {
  beforeEach(() => {
    captureMocks.capture.mockReset()
    displayMocks.getCursorScreenPoint.mockClear()
    displayMocks.getDisplayNearestPoint.mockClear()
  })

  function fullScreenDeps(overrides: Partial<ScreenshotDeps> = {}): ScreenshotDeps {
    const overlay = {
      webContents: {
        send: vi.fn()
      }
    }
    return {
      getOverlayWindow: () => overlay as unknown as Electron.BrowserWindow,
      getSelectorWindow: () => null,
      getSelectorDisplayId: () => null,
      ensureOverlayVisible: vi.fn(),
      startStreamSafely: vi.fn((run: (win: Electron.BrowserWindow) => void) =>
        run(overlay as unknown as Electron.BrowserWindow)
      ),
      streamImageAnswer: vi.fn(),
      extractImageText: vi.fn(),
      loadPersistedConfig: vi.fn(() => ({ screenshotMode: 'ocr' })),
      ...overrides
    }
  }

  it('captures the negative-origin display under the pointer and forces direct mode', async () => {
    captureMocks.capture.mockResolvedValue('full-screen-base64')
    const closeSelector = vi.fn()
    const ensureOverlayVisible = vi.fn()
    const deps = fullScreenDeps({
      getSelectorWindow: () =>
        ({
          close: closeSelector
        }) as unknown as Electron.BrowserWindow,
      ensureOverlayVisible
    })

    await captureFullScreenAndSubmit(deps)

    expect(displayMocks.getCursorScreenPoint).toHaveBeenCalledOnce()
    expect(displayMocks.getDisplayNearestPoint).toHaveBeenCalledWith({ x: -800, y: 400 })
    expect(ensureOverlayVisible).toHaveBeenCalledOnce()
    expect(closeSelector).toHaveBeenCalledOnce()
    expect(ensureOverlayVisible.mock.invocationCallOrder[0]).toBeLessThan(
      captureMocks.capture.mock.invocationCallOrder[0]
    )
    expect(closeSelector.mock.invocationCallOrder[0]).toBeLessThan(
      captureMocks.capture.mock.invocationCallOrder[0]
    )
    expect(captureMocks.capture).toHaveBeenCalledWith(displayMocks.pointerDisplay, {
      x: 0,
      y: 0,
      w: 1728,
      h: 1117,
      vw: 1728,
      vh: 1117
    })
    expect(deps.extractImageText).not.toHaveBeenCalled()
    expect(deps.loadPersistedConfig).not.toHaveBeenCalled()
    expect(deps.streamImageAnswer).toHaveBeenCalledWith('full-screen-base64', expect.any(Object))
  })

  it('coalesces repeated callbacks until the current capture finishes', async () => {
    let finishCapture!: (image: string) => void
    captureMocks.capture.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishCapture = resolve
        })
    )
    const deps = fullScreenDeps()
    const trigger = createFullScreenCaptureTrigger(deps)

    trigger()
    trigger()
    await vi.waitFor(() => expect(captureMocks.capture).toHaveBeenCalledTimes(1))

    finishCapture('first-image')
    await vi.waitFor(() => expect(deps.streamImageAnswer).toHaveBeenCalledTimes(1))

    captureMocks.capture.mockResolvedValue('second-image')
    trigger()
    await vi.waitFor(() => expect(captureMocks.capture).toHaveBeenCalledTimes(2))
  })
})
