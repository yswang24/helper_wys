import type { AnswerScrollDirection } from '../shared/ipc'

export const ANSWER_SCROLL_MODE_SHORTCUTS = {
  plainUp: 'Up',
  plainDown: 'Down'
} as const

export const ANSWER_SCROLL_MODE_TIMEOUT_MS = 30_000

type TimerHandle = ReturnType<typeof setTimeout>

export interface AnswerScrollModeDeps {
  register: (accelerator: string, handler: () => void) => boolean
  unregister: (accelerator: string) => void
  dispatch: (direction: AnswerScrollDirection) => void
  broadcast: (active: boolean) => void
  setTimeout: (handler: () => void, delayMs: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
}

export interface AnswerScrollMode {
  toggle: () => void
  deactivate: () => void
  isActive: () => boolean
}

export function createAnswerScrollMode(deps: AnswerScrollModeDeps): AnswerScrollMode {
  let active = false
  let plainUpRegistered = false
  let plainDownRegistered = false
  let timeoutHandle: TimerHandle | null = null
  let timeoutGeneration = 0

  const clearPendingTimeout = (): void => {
    timeoutGeneration += 1
    const pending = timeoutHandle
    timeoutHandle = null
    if (pending === null) return
    try {
      deps.clearTimeout(pending)
    } catch {
      // Continue cleanup even if an injected timer implementation rejects the handle.
    }
  }

  const unregisterPlainArrows = (): void => {
    const unregisterUp = plainUpRegistered
    const unregisterDown = plainDownRegistered
    plainUpRegistered = false
    plainDownRegistered = false

    if (unregisterUp) {
      try {
        deps.unregister(ANSWER_SCROLL_MODE_SHORTCUTS.plainUp)
      } catch {
        // The state machine must still release its other owned shortcut.
      }
    }
    if (unregisterDown) {
      try {
        deps.unregister(ANSWER_SCROLL_MODE_SHORTCUTS.plainDown)
      } catch {
        // Local ownership is cleared even if the platform unregister call fails.
      }
    }
  }

  const deactivate = (): void => {
    if (!active && !plainUpRegistered && !plainDownRegistered && timeoutHandle === null) {
      return
    }

    active = false
    clearPendingTimeout()
    unregisterPlainArrows()
    deps.broadcast(false)
  }

  const resetTimeout = (): void => {
    clearPendingTimeout()
    const generation = timeoutGeneration
    try {
      timeoutHandle = deps.setTimeout(() => {
        if (!active || generation !== timeoutGeneration) return
        timeoutHandle = null
        deactivate()
      }, ANSWER_SCROLL_MODE_TIMEOUT_MS)
    } catch {
      deactivate()
    }
  }

  const onPlainArrow = (direction: AnswerScrollDirection): void => {
    if (!active) return
    deps.dispatch(direction)
    if (!active) return
    deps.broadcast(true)
    if (!active) return
    resetTimeout()
  }

  const registerPlainArrows = (): boolean => {
    try {
      if (!deps.register(ANSWER_SCROLL_MODE_SHORTCUTS.plainUp, () => onPlainArrow('up'))) {
        return false
      }
      plainUpRegistered = true

      if (!deps.register(ANSWER_SCROLL_MODE_SHORTCUTS.plainDown, () => onPlainArrow('down'))) {
        unregisterPlainArrows()
        return false
      }
      plainDownRegistered = true
      return true
    } catch {
      unregisterPlainArrows()
      return false
    }
  }

  const toggle = (): void => {
    if (active) {
      deactivate()
      return
    }

    if (!registerPlainArrows()) return

    active = true
    // Arm cleanup before calling renderer-facing dependencies. Even if an IPC send unexpectedly
    // throws, the globally captured bare arrows cannot remain registered indefinitely.
    resetTimeout()
    if (!active) return
    deps.broadcast(true)
  }

  return {
    toggle,
    deactivate,
    isActive: () => active
  }
}
