// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  syncAutoFollowFromScroll,
  useResumeStreamingAutoFollow
} from './useResumeStreamingAutoFollow'

describe('useResumeStreamingAutoFollow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('immediately returns to the live tail when scroll mode exits during streaming', () => {
    const stickToBottomRef = { current: false }
    const resumeLiveTailRef = { current: false }
    const liveTailRef = { current: { scrollIntoView: vi.fn() } }
    const { rerender } = renderHook(
      ({ active, streaming }) =>
        useResumeStreamingAutoFollow(
          active,
          streaming,
          stickToBottomRef,
          resumeLiveTailRef,
          liveTailRef
        ),
      { initialProps: { active: true, streaming: true } }
    )

    rerender({ active: false, streaming: true })

    expect(stickToBottomRef.current).toBe(true)
    expect(resumeLiveTailRef.current).toBe(true)
    expect(liveTailRef.current.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' })
  })

  it('ignores a late non-bottom scroll event until the resumed viewport reaches the tail', () => {
    const stickToBottomRef = { current: true }
    const resumeLiveTailRef = { current: true }

    syncAutoFollowFromScroll(
      { scrollTop: 300, scrollHeight: 1_200, clientHeight: 300 },
      stickToBottomRef,
      resumeLiveTailRef
    )
    expect(stickToBottomRef.current).toBe(true)
    expect(resumeLiveTailRef.current).toBe(true)

    syncAutoFollowFromScroll(
      { scrollTop: 900, scrollHeight: 1_200, clientHeight: 300 },
      stickToBottomRef,
      resumeLiveTailRef
    )
    expect(stickToBottomRef.current).toBe(true)
    expect(resumeLiveTailRef.current).toBe(false)

    syncAutoFollowFromScroll(
      { scrollTop: 500, scrollHeight: 1_200, clientHeight: 300 },
      stickToBottomRef,
      resumeLiveTailRef
    )
    expect(stickToBottomRef.current).toBe(false)
  })

  it('still resumes when the final chunk finishes just before scroll mode exits', () => {
    const stickToBottomRef = { current: false }
    const resumeLiveTailRef = { current: false }
    const liveTailRef = { current: { scrollIntoView: vi.fn() } }
    const { rerender } = renderHook(
      ({ active, streaming }) =>
        useResumeStreamingAutoFollow(
          active,
          streaming,
          stickToBottomRef,
          resumeLiveTailRef,
          liveTailRef
        ),
      { initialProps: { active: true, streaming: true } }
    )

    rerender({ active: true, streaming: false })
    rerender({ active: false, streaming: false })

    expect(stickToBottomRef.current).toBe(true)
    expect(liveTailRef.current.scrollIntoView).toHaveBeenCalledOnce()
  })

  it('preserves the reviewed position when no answer streamed while the mode was active', () => {
    const stickToBottomRef = { current: false }
    const resumeLiveTailRef = { current: false }
    const liveTailRef = { current: { scrollIntoView: vi.fn() } }
    const { rerender } = renderHook(
      ({ active, streaming }) =>
        useResumeStreamingAutoFollow(
          active,
          streaming,
          stickToBottomRef,
          resumeLiveTailRef,
          liveTailRef
        ),
      { initialProps: { active: true, streaming: false } }
    )

    rerender({ active: false, streaming: false })

    expect(stickToBottomRef.current).toBe(false)
    expect(liveTailRef.current.scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not change an existing manual position without an active-to-inactive transition', () => {
    const stickToBottomRef = { current: false }
    const resumeLiveTailRef = { current: false }
    const liveTailRef = { current: { scrollIntoView: vi.fn() } }
    renderHook(() =>
      useResumeStreamingAutoFollow(
        false,
        true,
        stickToBottomRef,
        resumeLiveTailRef,
        liveTailRef
      )
    )

    expect(stickToBottomRef.current).toBe(false)
    expect(liveTailRef.current.scrollIntoView).not.toHaveBeenCalled()
  })

  it('releases the protective lock after a bounded fallback interval', () => {
    const stickToBottomRef = { current: false }
    const resumeLiveTailRef = { current: false }
    const liveTailRef = { current: { scrollIntoView: vi.fn() } }
    const { rerender } = renderHook(
      ({ active }) =>
        useResumeStreamingAutoFollow(
          active,
          true,
          stickToBottomRef,
          resumeLiveTailRef,
          liveTailRef
        ),
      { initialProps: { active: true } }
    )

    rerender({ active: false })
    expect(resumeLiveTailRef.current).toBe(true)

    act(() => vi.runAllTimers())
    expect(resumeLiveTailRef.current).toBe(false)
  })
})
