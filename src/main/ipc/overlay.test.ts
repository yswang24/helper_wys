import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the ipcMain handlers so we can drive them directly.
const handlers = new Map<string, (...a: unknown[]) => void>()
vi.mock('electron', () => ({
  ipcMain: {
    on: (ch: string, h: (...a: unknown[]) => void) => handlers.set(ch, h),
    handle: (ch: string, h: (...a: unknown[]) => void) => handlers.set(ch, h)
  }
}))

import { registerOverlayIpc, type OverlayDragStart } from './overlay'
import { SEND } from '../../shared/ipc'

function setup() {
  handlers.clear()
  let drag: OverlayDragStart | null = null
  const setPosition = vi.fn()
  const persistOverlayPos = vi.fn()
  const win = { isDestroyed: () => false, getPosition: () => [100, 50], setPosition }
  registerOverlayIpc({
    getOverlayWindow: () => win as unknown as Electron.BrowserWindow,
    isInteractive: () => false,
    applyOverlayMode: vi.fn(),
    getDragStart: () => drag,
    setDragStart: (d) => {
      drag = d
    },
    persistOverlayPos
  })
  const fire = (ch: string, payload?: unknown) => handlers.get(ch)!({}, payload)
  return { fire, setPosition, persistOverlayPos, getDrag: () => drag }
}

describe('overlay drag', () => {
  beforeEach(() => handlers.clear())

  it('ignores sub-3px movement (click), then moves once threshold is crossed (sticky)', () => {
    const { fire, setPosition } = setup()
    fire(SEND.overlayDragStart, { x: 200, y: 100 })
    fire(SEND.overlayDragMove, { x: 202, y: 102 }) // dx=2,dy=2 → click, no move
    expect(setPosition).not.toHaveBeenCalled()
    fire(SEND.overlayDragMove, { x: 206, y: 106 }) // dx=6 → move to (100+6, 50+6)
    expect(setPosition).toHaveBeenCalledWith(106, 56)
    fire(SEND.overlayDragMove, { x: 201, y: 101 }) // dx=1 but moved is sticky → still moves
    expect(setPosition).toHaveBeenLastCalledWith(101, 51)
  })

  it('persists position on drag-end ONLY if it actually moved', () => {
    const a = setup()
    a.fire(SEND.overlayDragStart, { x: 200, y: 100 })
    a.fire(SEND.overlayDragEnd)
    expect(a.persistOverlayPos).not.toHaveBeenCalled() // pure click, no persist

    const b = setup()
    b.fire(SEND.overlayDragStart, { x: 200, y: 100 })
    b.fire(SEND.overlayDragMove, { x: 220, y: 120 })
    b.fire(SEND.overlayDragEnd)
    expect(b.persistOverlayPos).toHaveBeenCalledWith(100, 50)
    expect(b.getDrag()).toBeNull() // cleared on end
  })
})
