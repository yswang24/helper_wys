import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import { createStreamSafe } from './stream-safe'

// Mocks the INJECTED deps (not real llm.ts) — so this step has no hidden dependency on Phase 4.
const aliveWin = { isDestroyed: () => false } as unknown as BrowserWindow
const deadWin = { isDestroyed: () => true } as unknown as BrowserWindow

function makeDeps(over: Partial<Parameters<typeof createStreamSafe>[0]> = {}) {
  return {
    isCurrentlyStreaming: vi.fn(() => false),
    stopStreaming: vi.fn(),
    forceResetStreaming: vi.fn(),
    getOverlayWindow: vi.fn(() => aliveWin),
    ensureOverlayVisible: vi.fn(),
    ...over
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createStreamSafe', () => {
  it('starts immediately when nothing is streaming', () => {
    const deps = makeDeps()
    const run = vi.fn()
    createStreamSafe(deps).startStreamSafely(run)
    expect(deps.ensureOverlayVisible).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(aliveWin)
    expect(deps.stopStreaming).not.toHaveBeenCalled()
  })

  it('does not run into a destroyed overlay', () => {
    const deps = makeDeps({ getOverlayWindow: vi.fn(() => deadWin) })
    const run = vi.fn()
    createStreamSafe(deps).startStreamSafely(run)
    expect(run).not.toHaveBeenCalled()
  })

  it('force-disowns a HUNG previous stream after ~4s and still starts the new one (never awaits it)', () => {
    // isCurrentlyStreaming stays true forever → simulates a stuck stream whose promise never settles.
    const deps = makeDeps({ isCurrentlyStreaming: vi.fn(() => true) })
    const run = vi.fn()
    createStreamSafe(deps).startStreamSafely(run)
    expect(deps.stopStreaming).toHaveBeenCalledOnce()
    expect(run).not.toHaveBeenCalled() // still draining
    vi.advanceTimersByTime(80 * 50) // 4s of polling
    expect(deps.forceResetStreaming).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(aliveWin) // new stream started despite the hang
  })

  it('waitForStreamEnd calls back synchronously when idle', () => {
    const deps = makeDeps()
    const cb = vi.fn()
    createStreamSafe(deps).waitForStreamEnd(cb)
    expect(cb).toHaveBeenCalledOnce()
    expect(deps.forceResetStreaming).not.toHaveBeenCalled()
  })
})
