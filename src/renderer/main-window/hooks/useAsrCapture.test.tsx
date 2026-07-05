// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAsrCapture } from './useAsrCapture'

let toggle: () => Promise<void> | void
let recorders: FakeRec[] = []
let overlayMode: 'passthrough' | 'interactive' = 'interactive'
const startListening = vi.fn()
const stopListening = vi.fn()
const sendTranscript = vi.fn()
const autoAsk = vi.fn()
const transcribeChunk = vi.fn(() => Promise.resolve('hello'))
const getUserMedia = vi.fn(() =>
  Promise.resolve({
    getAudioTracks: () => [],
    getTracks: () => [{ stop() {}, onended: null as unknown }]
  })
)

class FakeRec {
  static isTypeSupported = (): boolean => true
  ondataavailable?: (e: { data: Blob }) => void
  onstop?: () => void | Promise<void>
  fireOnStop = true
  constructor() {
    recorders.push(this)
  }
  start(): void {
    this.ondataavailable?.({ data: new Blob(['x'.repeat(3000)]) })
  }
  stop(): void {
    if (this.fireOnStop) void this.onstop?.()
  }
}

beforeEach(() => {
  recorders = []
  overlayMode = 'interactive'
  ;[startListening, stopListening, sendTranscript, autoAsk, transcribeChunk, getUserMedia].forEach(
    (f) => f.mockClear()
  )
  transcribeChunk.mockResolvedValue('hello')
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('MediaStream', class MediaStream {})
  vi.stubGlobal('MediaRecorder', FakeRec)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: () => Promise.resolve([]),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  })
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    getConfig: () => Promise.resolve({ asrApiKey: 'k' }),
    startListening,
    stopListening,
    sendTranscript,
    autoAsk,
    transcribeChunk,
    getOverlayMode: () => Promise.resolve(overlayMode),
    onAsrPttToggle: (cb: () => Promise<void> | void) => ((toggle = cb), () => {})
  }
})
afterEach(() => vi.unstubAllGlobals())

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useAsrCapture', () => {
  it('first ⌘⌥X starts a recording', async () => {
    const { result } = renderHook(() => useAsrCapture(false))
    await act(async () => {
      await toggle()
    })
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(startListening).toHaveBeenCalledOnce()
    expect(recorders).toHaveLength(1)
    expect(result.current.listening).toBe(true)
  })

  it('second ⌘⌥X stops, transcribes, and appends to the draft', async () => {
    const { result } = renderHook(() => useAsrCapture(false))
    await act(async () => {
      await toggle()
    }) // start
    await act(async () => {
      await toggle()
    }) // stop → onstop
    await flush()
    expect(transcribeChunk).toHaveBeenCalledOnce()
    expect(sendTranscript).toHaveBeenCalledWith({ text: 'hello', isFinal: true })
    expect(result.current.draftText).toBe('hello')
    expect(result.current.listening).toBe(false)
    expect(autoAsk).not.toHaveBeenCalled() // interactive mode → manual send only
  })

  it('auto-sends to AI in passthrough mode without accumulating the draft', async () => {
    overlayMode = 'passthrough'
    const { result } = renderHook(() => useAsrCapture(false))
    await act(async () => {
      await toggle()
    }) // start
    await act(async () => {
      await toggle()
    }) // stop → onstop
    await flush()
    expect(autoAsk).toHaveBeenCalledWith('hello')
    expect(sendTranscript).toHaveBeenCalledWith({ text: 'hello', isFinal: true }) // still mirrored
    expect(result.current.draftText).toBe('') // passthrough never touches the draft
  })

  it('does NOT auto-send in interactive mode (draft kept for manual send)', async () => {
    overlayMode = 'interactive'
    renderHook(() => useAsrCapture(false))
    await act(async () => {
      await toggle()
    })
    await act(async () => {
      await toggle()
    })
    await flush()
    expect(autoAsk).not.toHaveBeenCalled()
  })

  it('8s guard force-resets transcribing if onstop never fires (⌘⌥X not stranded)', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAsrCapture(false))
    await act(async () => {
      await toggle()
    }) // start
    recorders[0].fireOnStop = false // simulate onstop never firing
    await act(async () => {
      await toggle()
    }) // stop → arms 8s guard, transcribing stays true
    expect(result.current.transcribing).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(8000)
    })
    expect(result.current.transcribing).toBe(false)
    expect(result.current.error).toContain('复位')
    vi.useRealTimers()
  })

  it('refuses to start a new take while the previous is still transcribing', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAsrCapture(false))
    await act(async () => {
      await toggle()
    }) // start
    recorders[0].fireOnStop = false
    await act(async () => {
      await toggle()
    }) // stop → transcribing stays true (guard not yet fired)
    getUserMedia.mockClear()
    await act(async () => {
      await toggle()
    }) // attempt start while transcribing
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(result.current.error).toContain('还在转写中')
    vi.useRealTimers()
  })
})
