import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANSWER_SCROLL_MODE_SHORTCUTS,
  ANSWER_SCROLL_MODE_TIMEOUT_MS,
  createAnswerScrollMode,
  type AnswerScrollMode,
  type AnswerScrollModeDeps
} from './answer-scroll-mode'

type BareArrowShortcut =
  | typeof ANSWER_SCROLL_MODE_SHORTCUTS.plainUp
  | typeof ANSWER_SCROLL_MODE_SHORTCUTS.plainDown

interface Harness {
  controller: AnswerScrollMode
  handlers: Map<BareArrowShortcut, () => void>
  register: ReturnType<typeof vi.fn>
  unregister: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
  broadcast: ReturnType<typeof vi.fn>
}

interface RegistrationFailure {
  shortcut: BareArrowShortcut
  behavior: 'false' | 'throw'
}

function createHarness(failure: RegistrationFailure | null = null): Harness {
  const handlers = new Map<BareArrowShortcut, () => void>()
  const register = vi.fn((accelerator: string, handler: () => void) => {
    if (accelerator === failure?.shortcut) {
      if (failure.behavior === 'throw') throw new Error(`${accelerator} unavailable`)
      return false
    }
    handlers.set(accelerator as BareArrowShortcut, handler)
    return true
  })
  const unregister = vi.fn((accelerator: string) => {
    handlers.delete(accelerator as BareArrowShortcut)
  })
  const dispatch = vi.fn()
  const broadcast = vi.fn()
  const deps: AnswerScrollModeDeps = {
    register,
    unregister,
    dispatch,
    broadcast,
    setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
    clearTimeout: (handle) => clearTimeout(handle)
  }
  return {
    controller: createAnswerScrollMode(deps),
    handlers,
    register,
    unregister,
    dispatch,
    broadcast
  }
}

describe('AnswerScrollMode', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('exports bare arrow accelerators', () => {
    expect(ANSWER_SCROLL_MODE_SHORTCUTS).toEqual({
      plainUp: 'Up',
      plainDown: 'Down'
    })
  })

  it('atomically captures bare arrows without scrolling and renews the 30s timeout', () => {
    const harness = createHarness()

    harness.controller.toggle()

    expect(harness.register).toHaveBeenNthCalledWith(1, 'Up', expect.any(Function))
    expect(harness.register).toHaveBeenNthCalledWith(2, 'Down', expect.any(Function))
    expect(harness.broadcast).toHaveBeenCalledWith(true)
    expect(harness.dispatch).not.toHaveBeenCalled()
    expect(harness.controller.isActive()).toBe(true)

    vi.advanceTimersByTime(20_000)
    harness.broadcast.mockClear()
    harness.handlers.get('Down')?.()
    expect(harness.dispatch).toHaveBeenLastCalledWith('down')
    expect(harness.broadcast).toHaveBeenCalledOnce()
    expect(harness.broadcast).toHaveBeenCalledWith(true)

    vi.advanceTimersByTime(ANSWER_SCROLL_MODE_TIMEOUT_MS - 1)
    expect(harness.controller.isActive()).toBe(true)

    vi.advanceTimersByTime(1)
    expect(harness.controller.isActive()).toBe(false)
    expect(harness.unregister).toHaveBeenCalledWith('Up')
    expect(harness.unregister).toHaveBeenCalledWith('Down')
    expect(harness.broadcast).toHaveBeenLastCalledWith(false)
  })

  it('uses a second toggle invocation to close without performing another scroll', () => {
    const harness = createHarness()
    harness.controller.toggle()
    harness.dispatch.mockClear()

    harness.controller.toggle()

    expect(harness.dispatch).not.toHaveBeenCalled()
    expect(harness.controller.isActive()).toBe(false)
    expect(harness.broadcast).toHaveBeenLastCalledWith(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each<[BareArrowShortcut, RegistrationFailure['behavior']]>([
    ['Up', 'false'],
    ['Up', 'throw'],
    ['Down', 'false'],
    ['Down', 'throw']
  ])(
    'rolls back atomically when %s registration returns/does %s',
    (failedShortcut, behavior) => {
      const harness = createHarness({ shortcut: failedShortcut, behavior })

      harness.controller.toggle()

      const successfulShortcut = failedShortcut === 'Up' ? 'Down' : 'Up'
      const expectedUnregisterCount = failedShortcut === 'Down' ? 1 : 0
      expect(harness.unregister).toHaveBeenCalledTimes(expectedUnregisterCount)
      if (expectedUnregisterCount > 0) {
        expect(harness.unregister).toHaveBeenCalledWith(successfulShortcut)
      }
      expect(harness.dispatch).not.toHaveBeenCalled()
      expect(harness.broadcast).not.toHaveBeenCalled()
      expect(harness.controller.isActive()).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('deactivate clears the timer and registrations and makes queued arrow callbacks inert', () => {
    const harness = createHarness()
    harness.controller.toggle()
    const queuedUpHandler = harness.handlers.get('Up')
    harness.dispatch.mockClear()

    harness.controller.deactivate()
    queuedUpHandler?.()

    expect(harness.dispatch).not.toHaveBeenCalled()
    expect(harness.unregister).toHaveBeenCalledWith('Up')
    expect(harness.unregister).toHaveBeenCalledWith('Down')
    expect(harness.broadcast).toHaveBeenLastCalledWith(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
