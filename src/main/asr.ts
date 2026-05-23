import OpenAI from 'openai'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync, createReadStream } from 'fs'
import { randomBytes } from 'crypto'

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

const HALLUCINATION_RE = /点赞|订阅|转发|打赏|谢谢大家|明镜|优优独播|YoYo Television|独播剧场|爱奇艺|腾讯视频|优酷|bilibili|哔哩哔哩|字幕组|版权所有|请勿盗录|Thank you for watching|please subscribe|请关注|扫码|二维码|本视频/i

function isHallucinatedText(text: string): boolean {
  if (!text) return true
  if (HALLUCINATION_RE.test(text)) return true
  // Detect repeated segment hallucination: "ABCABC" or "X X X X"
  const half = text.slice(0, Math.floor(text.length / 2))
  if (half.length > 4 && text.startsWith(half + half.slice(0, 2))) return true
  return false
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
    if (isHallucinatedText(text)) return ''
    return text
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}
