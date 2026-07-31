import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake BrowserWindow whose method calls are recorded in `order`, so we can assert the exact
// call sequence that encodes the two-mode invariants (the reason this class exists).
let fake: ReturnType<typeof makeFake>
let order: string[]
let visible: boolean
let pos: [number, number]
const winEvents = new Map<string, (...a: unknown[]) => void>()
const wcEvents = new Map<string, (...a: unknown[]) => void>()

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(() => fake),
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 3000, height: 3000 } }) }
}))

import { OverlayController } from './overlay-controller'

function makeFake() {
  order = []
  const push = (n: string) => () => {
    order.push(n)
  }
  const send = vi.fn((...a: unknown[]) => order.push('send:' + a[0]))
  return {
    isDestroyed: () => false,
    isVisible: () => visible,
    getPosition: () => pos,
    setPosition: vi.fn((x: number, y: number) => {
      order.push('setPosition')
      pos = [x, y]
    }),
    setFocusable: vi.fn(push('setFocusable')),
    setIgnoreMouseEvents: vi.fn(push('setIgnoreMouseEvents')),
    setContentProtection: vi.fn(push('setContentProtection')),
    setAlwaysOnTop: vi.fn(push('setAlwaysOnTop')),
    showInactive: vi.fn(() => {
      order.push('showInactive')
      visible = true
    }),
    hide: vi.fn(push('hide')),
    show: vi.fn(push('show')),
    focus: vi.fn(push('focus')),
    blur: vi.fn(push('blur')),
    destroy: vi.fn(),
    getSize: () => [500, 680],
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    webContents: { on: (e: string, h: (...a: unknown[]) => void) => wcEvents.set(e, h), send },
    on: (e: string, h: (...a: unknown[]) => void) => winEvents.set(e, h)
  }
}

function makeController() {
  const onVisibilityChange = vi.fn()
  const c = new OverlayController({
    loadPersistedConfig: () => ({}),
    persistConfig: vi.fn(),
    hardenWebContents: vi.fn(),
    isQuitting: () => false,
    onVisibilityChange
  })
  c.create()
  return { c, onVisibilityChange }
}

beforeEach(() => {
  visible = true
  pos = [10, 20]
  winEvents.clear()
  wcEvents.clear()
  fake = makeFake()
})

describe('OverlayController.applyMode (two-mode invariants)', () => {
  it('interactive: setFocusable BEFORE setIgnoreMouseEvents, and never blur/show/focus', () => {
    const { c, onVisibilityChange } = makeController()
    order = []
    c.applyMode(true)
    expect(order.indexOf('setFocusable')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('setFocusable')).toBeLessThan(order.indexOf('setIgnoreMouseEvents'))
    expect(order).not.toContain('blur')
    expect(order).not.toContain('show')
    expect(order).not.toContain('focus')
    expect(fake.webContents.send).toHaveBeenCalledWith('overlay:mode', 'interactive')
    expect(onVisibilityChange).toHaveBeenCalled()
    expect(c.isInteractive()).toBe(true)
  })

  it('passthrough: setIgnoreMouseEvents BEFORE setFocusable, and never blur', () => {
    const { c } = makeController()
    order = []
    c.applyMode(false)
    expect(order.indexOf('setIgnoreMouseEvents')).toBeLessThan(order.indexOf('setFocusable'))
    expect(order).not.toContain('blur')
    expect(fake.webContents.send).toHaveBeenCalledWith('overlay:mode', 'passthrough')
  })

  it('restores the pre-switch position (mode switch must never move the window)', () => {
    const { c } = makeController()
    // Simulate the window having drifted during the setFocusable/ignoreMouse calls.
    let calls = 0
    fake.getPosition = () => (++calls <= 1 ? [10, 20] : [99, 99])
    order = []
    c.applyMode(true)
    expect(fake.setPosition).toHaveBeenCalledWith(10, 20)
  })
})

describe('OverlayController.ensureVisible', () => {
  it('is a no-op when already visible', () => {
    const { c, onVisibilityChange } = makeController()
    visible = true
    order = []
    onVisibilityChange.mockClear()
    c.ensureVisible()
    expect(order).not.toContain('showInactive')
    expect(onVisibilityChange).not.toHaveBeenCalled()
  })

  it('re-shows (showInactive) + re-asserts content protection when hidden', () => {
    const { c, onVisibilityChange } = makeController()
    visible = false
    order = []
    onVisibilityChange.mockClear()
    c.ensureVisible()
    expect(order).toContain('showInactive')
    expect(order).toContain('setContentProtection')
    expect(order).toContain('setAlwaysOnTop')
    expect(order).not.toContain('show')
    expect(onVisibilityChange).toHaveBeenCalled()
  })
})

describe('OverlayController initial load', () => {
  it('refreshes the app menu after the initially hidden overlay becomes visible', () => {
    visible = false
    const { c, onVisibilityChange } = makeController()
    onVisibilityChange.mockClear()

    wcEvents.get('did-finish-load')?.()

    expect(order).toContain('showInactive')
    expect(c.isVisible()).toBe(true)
    expect(onVisibilityChange).toHaveBeenCalledOnce()
  })
})
