// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnswerScrollDirection } from '../../../shared/ipc'
import { scrollAnswerByPage, useAnswerScroll } from './useAnswerScroll'

interface FakeScrollElement {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  scrollTo: ReturnType<typeof vi.fn>
}

function fakeScrollElement(overrides: Partial<FakeScrollElement> = {}): FakeScrollElement {
  return {
    scrollTop: 500,
    scrollHeight: 1_200,
    clientHeight: 300,
    scrollTo: vi.fn(),
    ...overrides
  }
}

describe('scrollAnswerByPage', () => {
  it('smoothly scrolls by 60% of the answer viewport in either direction', () => {
    const element = fakeScrollElement()
    const stickToBottomRef = { current: true }
    const resumeLiveTailRef = { current: true }

    scrollAnswerByPage(element, 'up', stickToBottomRef, resumeLiveTailRef)
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 320, behavior: 'smooth' })
    expect(stickToBottomRef.current).toBe(false)
    expect(resumeLiveTailRef.current).toBe(false)

    scrollAnswerByPage(element, 'down', stickToBottomRef, resumeLiveTailRef)
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 680, behavior: 'smooth' })
  })

  it('clamps at both boundaries and is a no-op when the content does not overflow', () => {
    const stickToBottomRef = { current: true }
    const resumeLiveTailRef = { current: false }
    const top = fakeScrollElement({ scrollTop: 20 })
    scrollAnswerByPage(top, 'up', stickToBottomRef, resumeLiveTailRef)
    expect(top.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })

    const bottom = fakeScrollElement({ scrollTop: 850 })
    scrollAnswerByPage(bottom, 'down', stickToBottomRef, resumeLiveTailRef)
    expect(bottom.scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'smooth' })

    const fitted = fakeScrollElement({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })
    scrollAnswerByPage(fitted, 'down', stickToBottomRef, resumeLiveTailRef)
    expect(fitted.scrollTo).not.toHaveBeenCalled()
    expect(stickToBottomRef.current).toBe(true)
  })
})

describe('useAnswerScroll', () => {
  let onScrollRequest: ((direction: AnswerScrollDirection) => void) | undefined
  let onModeChange: ((active: boolean) => void) | undefined
  const unsubscribeScroll = vi.fn()
  const unsubscribeMode = vi.fn()

  beforeEach(() => {
    onScrollRequest = undefined
    onModeChange = undefined
    unsubscribeScroll.mockClear()
    unsubscribeMode.mockClear()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      onAnswerScroll: (listener: (direction: AnswerScrollDirection) => void) => {
        onScrollRequest = listener
        return unsubscribeScroll
      },
      onAnswerScrollMode: (listener: (active: boolean) => void) => {
        onModeChange = listener
        return unsubscribeMode
      }
    }
  })

  it('routes IPC to the answer element and pauses streaming auto-follow before scrolling', () => {
    const element = fakeScrollElement()
    const { result, unmount } = renderHook(() => useAnswerScroll())
    result.current.scrollRef.current = element as unknown as HTMLDivElement
    result.current.resumeLiveTailRef.current = true
    element.scrollTo.mockImplementation(() => {
      expect(result.current.stickToBottomRef.current).toBe(false)
    })

    act(() => onScrollRequest?.('up'))

    expect(element.scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'smooth' })
    expect(result.current.resumeLiveTailRef.current).toBe(false)
    unmount()
    expect(unsubscribeScroll).toHaveBeenCalledOnce()
    expect(unsubscribeMode).toHaveBeenCalledOnce()
  })

  it('re-enables auto-follow only after the actual viewport reaches the bottom', () => {
    const element = fakeScrollElement({ scrollTop: 500 })
    const { result } = renderHook(() => useAnswerScroll())
    result.current.scrollRef.current = element as unknown as HTMLDivElement

    act(() => onScrollRequest?.('down'))
    expect(result.current.stickToBottomRef.current).toBe(false)

    result.current.resumeLiveTailRef.current = true
    act(() => result.current.onAnswerScroll())
    expect(result.current.stickToBottomRef.current).toBe(true)
    expect(result.current.resumeLiveTailRef.current).toBe(true)

    element.scrollTop = 900
    act(() => result.current.onAnswerScroll())
    expect(result.current.stickToBottomRef.current).toBe(true)
    expect(result.current.resumeLiveTailRef.current).toBe(false)

    element.scrollTop = 850
    act(() => result.current.onAnswerScroll())
    expect(result.current.stickToBottomRef.current).toBe(false)
  })

  it('tracks scroll-mode status and cleans up both IPC subscriptions', () => {
    const { result, unmount } = renderHook(() => useAnswerScroll())

    expect(result.current.scrollModeActive).toBe(false)
    act(() => onModeChange?.(true))
    expect(result.current.scrollModeActive).toBe(true)
    act(() => onModeChange?.(false))
    expect(result.current.scrollModeActive).toBe(false)

    unmount()
    expect(unsubscribeScroll).toHaveBeenCalledOnce()
    expect(unsubscribeMode).toHaveBeenCalledOnce()
  })
})
