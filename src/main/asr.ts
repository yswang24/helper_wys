import { toFile } from 'openai'
import { join } from 'path'
import { tmpdir } from 'os'
import { readdirSync, unlinkSync } from 'fs'
import { isHallucinatedText } from '../shared/hallucination'
import { describeApiError } from './apiError'
import { getOpenAIClient } from './openaiClient'

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

  const client = getOpenAIClient({ apiKey: config.apiKey, baseURL: config.baseUrl })

  const ext = mimeType.includes('webm') ? 'webm'
    : mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('mp4') ? 'mp4'
    : 'webm'

  // Whisper accepts ISO 639-1 2-letter codes only (zh not zh-CN, en not en-US)
  const lang = language?.split('-')[0]
  // The dialogue prompt + temperature:0 are Whisper-specific tuning. Other backends
  // (SenseVoice etc.) may reject the param or leak the canned phrasing, and the prompt is
  // language-keyed so a non-zh/en clip isn't anchored toward the wrong language's wording.
  const isWhisper = /whisper/i.test(config.model)
  const promptByLang: Record<string, string> = {
    zh: '面试官：请解释一下这个技术问题。候选人：好的，我来说明。',
    en: 'Interviewer: Can you explain this concept? Candidate: Sure, let me explain.'
  }
  const prompt = promptByLang[lang ?? 'en']
  // Upload the buffer directly via toFile — no temp file. (File is polyfilled in index.ts, and the
  // old "avoids File API compat" temp-file workaround is obsolete.) The extension on the filename
  // is what lets the backend infer the codec, so keep it aligned with the real mime type.
  const result = await client.audio.transcriptions.create({
    file: await toFile(audio, `audio.${ext}`, { type: mimeType }),
    model: config.model,
    ...(lang ? { language: lang } : {}),
    ...(isWhisper ? { temperature: 0, ...(prompt ? { prompt } : {}) } : {})
  })
  const text = result.text.trim()
  // Diagnostic: tiny output from a sizable audio buffer means the audio was silent
  // (routing/throttle) — not a Whisper failure. Logged so the two cases are distinguishable.
  console.log(`[ASR] audio ${audio.length}B → "${text.slice(0, 40)}" (${text.length} chars)`)
  if (isHallucinatedText(text)) {
    console.log('[ASR] discarded as hallucination/boilerplate (empty result returned)')
    return ''
  }
  return text
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
  const client = getOpenAIClient({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, maxRetries: 0 })
  const start = Date.now()
  try {
    await client.audio.transcriptions.create(
      { file: await toFile(makeProbeWav(), 'probe.wav', { type: 'audio/wav' }), model: cfg.model },
      { signal: AbortSignal.timeout(20000) }
    )
    return { ok: true, message: `连接成功 · 模型 ${cfg.model} · ${Date.now() - start}ms` }
  } catch (err) {
    return { ok: false, message: describeApiError(err) }
  }
}

// Best-effort sweep of temp audio left by older builds (the current path uploads buffers directly,
// no temp files) or by a run killed mid-transcribe. Call once on startup. Only our own prefixes.
export function cleanupStaleTempAudio(): void {
  try {
    const dir = tmpdir()
    for (const f of readdirSync(dir)) {
      if (/^ia_.*\.(webm|ogg|mp4)$/.test(f) || /^iatest_.*\.wav$/.test(f)) {
        try { unlinkSync(join(dir, f)) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}
