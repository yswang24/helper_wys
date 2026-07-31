import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareRecordedAudioForAsr } from './audioEncoding'

describe('ASR recording preparation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves the original recording when Web Audio decoding is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const source = new Uint8Array([1, 2, 3, 4])

    const prepared = await prepareRecordedAudioForAsr(
      new Blob([source], { type: 'audio/webm;codecs=opus' })
    )

    expect(prepared.mimeType).toBe('audio/webm;codecs=opus')
    expect(new Uint8Array(prepared.buffer)).toEqual(source)
  })

  it('converts decoded recorder audio to a 16 kHz mono PCM WAV', async () => {
    const left = new Float32Array([0, 0.5, -0.5, 0])
    const right = new Float32Array([0, 0.25, -0.25, 0])
    const close = vi.fn().mockResolvedValue(undefined)
    class FakeAudioContext {
      decodeAudioData = vi.fn().mockResolvedValue({
        duration: 4 / 48_000,
        length: 4,
        numberOfChannels: 2,
        sampleRate: 48_000,
        getChannelData: (channel: number) => (channel === 0 ? left : right)
      })

      close = close
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

    const prepared = await prepareRecordedAudioForAsr(
      new Blob([new Uint8Array([7, 8, 9])], { type: 'audio/webm' })
    )
    const wav = new Uint8Array(prepared.buffer)
    const view = new DataView(prepared.buffer)

    expect(prepared.mimeType).toBe('audio/wav')
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(close).toHaveBeenCalledOnce()
  })
})
