import { describe, it, expect, vi } from 'vitest'

// Fakes for the electron/node boundaries so captureRegionNative's finally-unlink is testable.
const unlinkMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })
  },
  desktopCapturer: { getSources: () => Promise.resolve([]) }
}))
vi.mock('child_process', () => ({
  // screencapture "succeeds" (writes nothing); nativeImage.isEmpty() then throws.
  execFile: (_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null)
}))
vi.mock('fs/promises', () => ({ unlink: unlinkMock }))

import { computeNativeRect, computeCropRect, captureRegionNative } from './capture'

const fakeDisplay = {
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  scaleFactor: 1
} as unknown as Electron.Display

// Characterization tests: lock the exact alignment math (currently untested and user-visible)
// before the capture module moves in Step 2.2.
describe('computeNativeRect', () => {
  it('rescales selector-viewport coords to display bounds (2x)', () => {
    // bounds 2000x1000 vs viewport 1000x500 → sx=sy=2. origin offset applied.
    const r = computeNativeRect(
      { x: 100, y: 0, width: 2000, height: 1000 },
      { x: 50, y: 25, w: 200, h: 100, vw: 1000, vh: 500 }
    )
    expect(r).toEqual({ gx: 200, gy: 50, gw: 400, gh: 200 })
  })

  it('defaults vw/vh to the display bounds (scale 1) and adds the bounds origin', () => {
    const r = computeNativeRect(
      { x: 300, y: 40, width: 1440, height: 900 },
      { x: 10, y: 20, w: 30, h: 40 }
    )
    expect(r).toEqual({ gx: 310, gy: 60, gw: 30, gh: 40 })
  })

  it('maps a complete secondary display with a negative global origin', () => {
    const r = computeNativeRect(
      { x: -1728, y: 0, width: 1728, height: 1117 },
      { x: 0, y: 0, w: 1728, h: 1117, vw: 1728, vh: 1117 }
    )
    expect(r).toEqual({ gx: -1728, gy: 0, gw: 1728, gh: 1117 })
  })

  it('floors width/height to at least 1', () => {
    const r = computeNativeRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, w: 0, h: 0 })
    expect(r.gw).toBe(1)
    expect(r.gh).toBe(1)
  })
})

describe('computeCropRect', () => {
  it('maps viewport coords to thumbnail pixels and clamps inside the thumbnail', () => {
    // thumbnail 2000x1000, viewport 1000x500 → scale 2.
    const r = computeCropRect(
      { width: 2000, height: 1000 },
      { width: 1000, height: 500 },
      { x: 50, y: 25, w: 200, h: 100, vw: 1000, vh: 500 }
    )
    expect(r).toEqual({ cx: 100, cy: 50, cw: 400, ch: 200 })
  })

  it('clamps a crop that would exceed the thumbnail edge', () => {
    const r = computeCropRect(
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { x: 80, y: 80, w: 50, h: 50 }
    )
    expect(r).toEqual({ cx: 80, cy: 80, cw: 20, ch: 20 })
  })

  it('falls back to display bounds for vw/vh', () => {
    const r = computeCropRect(
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { x: 10, y: 10, w: 20, h: 20 }
    )
    expect(r).toEqual({ cx: 10, cy: 10, cw: 20, ch: 20 })
  })
})

describe('captureRegionNative cleanup', () => {
  it('unlinks the temp PNG even when capture fails (empty image)', async () => {
    unlinkMock.mockClear()
    await expect(captureRegionNative(fakeDisplay, { x: 0, y: 0, w: 10, h: 10 })).rejects.toThrow()
    expect(unlinkMock).toHaveBeenCalledOnce()
  })
})
