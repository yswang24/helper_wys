// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useResumeStreamingAutoFollow } from './useResumeStreamingAutoFollow'

describe('useResumeStreamingAutoFollow', () => {
  it('re-enables live-tail following when scroll mode exits during streaming', () => {
    const stickToBottomRef = { current: false }
    const { rerender } = renderHook(
      ({ active, streaming }) =>
        useResumeStreamingAutoFollow(active, streaming, stickToBottomRef),
      { initialProps: { active: true, streaming: true } }
    )

    rerender({ active: false, streaming: true })

    expect(stickToBottomRef.current).toBe(true)
  })

  it('preserves the reviewed position when the answer has already finished', () => {
    const stickToBottomRef = { current: false }
    const { rerender } = renderHook(
      ({ active, streaming }) =>
        useResumeStreamingAutoFollow(active, streaming, stickToBottomRef),
      { initialProps: { active: true, streaming: false } }
    )

    rerender({ active: false, streaming: false })

    expect(stickToBottomRef.current).toBe(false)
  })

  it('does not change an existing manual position without an active-to-inactive transition', () => {
    const stickToBottomRef = { current: false }
    renderHook(() => useResumeStreamingAutoFollow(false, true, stickToBottomRef))

    expect(stickToBottomRef.current).toBe(false)
  })
})
