import OpenAI from 'openai'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync, createReadStream } from 'fs'
import { randomBytes } from 'crypto'
import { isHallucinatedText } from '../shared/hallucination'
import { describeApiError } from './apiError'

export interface ASRConfig {
  apiKey: string
  baseUrl: string
  model: string
}

const DEFAULT: ASRConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'whisper-1'
}

let config: ASRConfig = { ...DEFAULT }

export function setASRConfig(partial: Partial<ASRConfig>): void {
  config = { ...config, ...partial }
}

export function getASRConfig(): ASRConfig {
  return { ...config }
}

export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  language?: string
): Promise<string> {
  if (!config.apiKey) throw new Error('请先在设置中填写语音识别 API Key')

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    dangerouslyAllowBrowser: true
  })

  const ext = mimeType.includes('webm') ? 'webm'
    : mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('mp4') ? 'mp4'
    : 'webm'

  // Write to temp file — avoids File API compat issues across Node versions
  const tmpFile = join(tmpdir(), `ia_${randomBytes(4).toString('hex')}.${ext}`)
  writeFileSync(tmpFile, audio)

  try {
    // Whisper accepts ISO 639-1 2-letter codes only (zh not zh-CN, en not en-US)
    const lang = language?.split('-')[0]
    const result = await client.audio.transcriptions.create({
      file: createReadStream(tmpFile) as unknown as File,
      model: config.model,
      ...(lang ? { language: lang } : {}),
      // Dialogue-style prompt anchors Whisper to the domain, cuts hallucinations on silence
      prompt: lang === 'zh'
        ? '面试官：请解释一下这个技术问题。候选人：好的，我来说明。'
        : 'Interviewer: Can you explain this concept? Candidate: Sure, let me explain.',
      temperature: 0
    })
    const text = result.text.trim()
    // Diagnostic: tiny output from a sizable audio buffer means the audio was silent
    // (routing/throttle) — not a Whisper failure. Logged so the two cases are distinguishable.
    console.log(`[ASR] audio ${audio.length}B → "${text.slice(0, 40)}" (${text.length} chars)`)
    if (isHallucinatedText(text)) return ''
    return text
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// A 1-second mono 16kHz WAV with a faint tone — real (non-silent) audio so the
// transcription endpoint accepts it, used purely to probe connectivity.
function makeProbeWav(seconds = 1, sampleRate = 16000): Buffer {
  const n = seconds * sampleRate
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 800), 44 + i * 2)
  return buf
}

// Connectivity test for the Settings UI — sends a tiny probe clip to the
// transcription endpoint. OpenAI-compatible, so SiliconFlow / Groq / OpenAI all work.
export async function testASRConnection(
  cfg: { apiKey: string; baseUrl: string; model: string }
): Promise<{ ok: boolean; message: string }> {
  if (!cfg.apiKey) return { ok: false, message: '请先填写 ASR API Key' }
  if (!cfg.model) return { ok: false, message: '请先填写 ASR 模型名' }
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, dangerouslyAllowBrowser: true, maxRetries: 0 })
  const tmpFile = join(tmpdir(), `iatest_${randomBytes(4).toString('hex')}.wav`)
  writeFileSync(tmpFile, makeProbeWav())
  const start = Date.now()
  try {
    await client.audio.transcriptions.create(
      { file: createReadStream(tmpFile) as unknown as File, model: cfg.model },
      { signal: AbortSignal.timeout(20000) }
    )
    return { ok: true, message: `连接成功 · 模型 ${cfg.model} · ${Date.now() - start}ms` }
  } catch (err) {
    return { ok: false, message: describeApiError(err) }
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}
