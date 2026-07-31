export interface PreparedAsrAudio {
  buffer: ArrayBuffer
  mimeType: string
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function encodeMonoPcm16Wav(audio: AudioBuffer, sampleRate = 16_000): ArrayBuffer {
  const frameCount = Math.max(1, Math.round(audio.duration * sampleRate))
  const output = new ArrayBuffer(44 + frameCount * 2)
  const view = new DataView(output)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + frameCount * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, frameCount * 2, true)

  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) =>
    audio.getChannelData(channel)
  )
  const sourceStep = audio.sampleRate / sampleRate
  for (let frame = 0; frame < frameCount; frame++) {
    const sourcePosition = Math.min(frame * sourceStep, audio.length - 1)
    const leftIndex = Math.floor(sourcePosition)
    const rightIndex = Math.min(leftIndex + 1, audio.length - 1)
    const fraction = sourcePosition - leftIndex
    let mono = 0
    for (const channel of channels) {
      mono += channel[leftIndex] + (channel[rightIndex] - channel[leftIndex]) * fraction
    }
    mono = Math.max(-1, Math.min(1, mono / Math.max(channels.length, 1)))
    view.setInt16(44 + frame * 2, Math.round(mono < 0 ? mono * 0x8000 : mono * 0x7fff), true)
  }
  return output
}

// Electron records Opus/WebM, while MiMo accepts WAV/MP3. Decode and resample locally so the
// same recording works for every configured provider.
export async function prepareRecordedAudioForAsr(blob: Blob): Promise<PreparedAsrAudio> {
  const original = await blob.arrayBuffer()
  if (typeof AudioContext === 'undefined') {
    return { buffer: original, mimeType: blob.type }
  }

  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(original.slice(0))
    return {
      buffer: encodeMonoPcm16Wav(decoded),
      mimeType: 'audio/wav'
    }
  } catch {
    return { buffer: original, mimeType: blob.type }
  } finally {
    await context.close().catch(() => {})
  }
}
