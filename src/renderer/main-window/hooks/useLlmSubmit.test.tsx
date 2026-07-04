// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLlmSubmit } from './useLlmSubmit'

type H = { [k: string]: (arg: unknown) => void }
const h: H = {}
const askQuestion = vi.fn()

beforeEach(() => {
  for (const k of Object.keys(h)) delete h[k]
  askQuestion.mockClear()
  vi.useFakeTimers()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    askQuestion,
    onAnswerStart: (cb: H['x']) => ((h.start = cb), () => {}),
    onAnswerDone: (cb: H['x']) => ((h.done = cb), () => {}),
    onAnswerError: (cb: H['x']) => ((h.error = cb), () => {})
  }
})

describe('useLlmSubmit', () => {
  it('submits, adopts a start, and resets on the matching done', () => {
    const { result } = renderHook(() => useLlmSubmit())
    act(() => {
      expect(result.current.submit('  hi  ')).toBe(true)
    })
    expect(askQuestion).toHaveBeenCalledWith('hi')
    expect(result.current.isSending).toBe(true)
    act(() => h.start({ id: 7 }))
    act(() => h.done({ id: 9 })) // foreign stream → no reset
    expect(result.current.isSending).toBe(true)
    act(() => h.done({ id: 7 })) // ours → reset
    expect(result.current.isSending).toBe(false)
  })

  it('ignores empty input and does not double-submit while sending', () => {
    const { result } = renderHook(() => useLlmSubmit())
    act(() => {
      expect(result.current.submit('   ')).toBe(false)
    })
    expect(askQuestion).not.toHaveBeenCalled()
    act(() => {
      result.current.submit('q1')
    })
    act(() => {
      expect(result.current.submit('q2')).toBe(false) // already sending
    })
    expect(askQuestion).toHaveBeenCalledTimes(1)
  })

  it('resets on a pre-start (id:null) error while pending', () => {
    const { result } = renderHook(() => useLlmSubmit())
    act(() => {
      result.current.submit('q')
    })
    act(() => h.error({ id: null, message: 'busy' }))
    expect(result.current.isSending).toBe(false)
  })

  it('the 30s safety timer un-strands the button if events are missed', () => {
    const { result } = renderHook(() => useLlmSubmit())
    act(() => {
      result.current.submit('q')
    })
    expect(result.current.isSending).toBe(true)
    act(() => vi.advanceTimersByTime(30000))
    expect(result.current.isSending).toBe(false)
  })
})
