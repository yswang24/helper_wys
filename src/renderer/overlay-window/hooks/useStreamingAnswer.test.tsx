// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreamingAnswer } from './useStreamingAnswer'

type H = { [k: string]: (arg: unknown) => void }
const h: H = {}

beforeEach(() => {
  for (const k of Object.keys(h)) delete h[k]
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    onAnswerStart: (cb: H['x']) => ((h.start = cb), () => {}),
    onAnswerChunk: (cb: H['x']) => ((h.chunk = cb), () => {}),
    onAnswerDone: (cb: H['x']) => ((h.done = cb), () => {}),
    onAnswerError: (cb: H['x']) => ((h.error = cb), () => {}),
    onAnswerClear: (cb: () => void) => ((h.clear = cb as H['x']), () => {})
  }
  // Flush synchronously so buffered chunks apply within the act() call.
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => (cb(0), 0))
})

function render() {
  const ref = { current: true }
  return renderHook(() => useStreamingAnswer(ref))
}

describe('useStreamingAnswer', () => {
  it('accumulates chunks then marks done', () => {
    const { result } = render()
    act(() => h.start({ id: 1, question: 'q' }))
    act(() => h.chunk({ id: 1, chunk: 'a' }))
    act(() => h.chunk({ id: 1, chunk: 'b' }))
    act(() => h.done({ id: 1 }))
    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0].answer).toBe('ab')
    expect(result.current.history[0].status).toBe('done')
  })

  it('keeps accumulating chunks while manual review pauses live-tail following', () => {
    const stickToBottomRef = { current: true }
    const { result } = renderHook(() => useStreamingAnswer(stickToBottomRef))
    act(() => h.start({ id: 1, question: 'q' }))
    stickToBottomRef.current = false

    act(() => h.chunk({ id: 1, chunk: '仍在' }))
    act(() => h.chunk({ id: 1, chunk: '生成' }))

    expect(stickToBottomRef.current).toBe(false)
    expect(result.current.history[0]).toMatchObject({
      answer: '仍在生成',
      status: 'streaming'
    })
  })

  it('keeps overlapping streams separate by id', () => {
    const { result } = render()
    act(() => h.start({ id: 1, question: 'q1' }))
    act(() => h.start({ id: 2, question: 'q2' }))
    act(() => h.chunk({ id: 1, chunk: 'x' }))
    act(() => h.chunk({ id: 2, chunk: 'y' }))
    expect(result.current.history[0].answer).toBe('x')
    expect(result.current.history[1].answer).toBe('y')
  })

  it('surfaces an orphan (id:null) error as a standalone negative-id item', () => {
    const { result } = render()
    act(() => h.error({ id: null, message: 'boom' }))
    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0].id).toBeLessThan(0)
    expect(result.current.history[0].status).toBe('error')
    expect(result.current.history[0].errorMsg).toBe('boom')
  })

  it('inserts an orphan error BEFORE a still-live stream (keeps live answer last)', () => {
    const { result } = render()
    act(() => h.start({ id: 1, question: 'q' }))
    act(() => h.error({ id: null, message: 'busy' }))
    expect(result.current.history).toHaveLength(2)
    expect(result.current.history[0].errorMsg).toBe('busy') // error first
    expect(result.current.history[1].id).toBe(1) // live stream stays last
    expect(result.current.history[1].status).toBe('streaming')
  })

  it('marks a matching id as error without synthesizing an item', () => {
    const { result } = render()
    act(() => h.start({ id: 1, question: 'q' }))
    act(() => h.error({ id: 1, message: 'nope' }))
    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0].status).toBe('error')
    expect(result.current.history[0].errorMsg).toBe('nope')
  })

  it('clears history on clear', () => {
    const { result } = render()
    act(() => h.start({ id: 1, question: 'q' }))
    act(() => h.clear(undefined))
    expect(result.current.history).toHaveLength(0)
  })

  it('re-pins stick-to-bottom SYNCHRONOUSLY on a new answer', () => {
    const ref = { current: false }
    const { rerender } = renderHook(() => useStreamingAnswer(ref))
    rerender()
    act(() => h.start({ id: 1, question: 'q' }))
    expect(ref.current).toBe(true) // written inside onAnswerStart, same tick
  })
})
