import OpenAI from 'openai'
import type { BrowserWindow } from 'electron'
import { describeApiError } from './apiError'
import { VISION_PROBE_PNG_B64 } from './visionProbe'

export interface LLMConfig {
  apiKey: string
  baseUrl: string
  model: string
  visionModel: string
  jobDescription: string
}

const DEFAULT_CONFIG: LLMConfig = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  visionModel: 'deepseek-chat',
  jobDescription: ''
}

// In-memory config, updated via IPC from main window
let currentConfig: LLMConfig = { ...DEFAULT_CONFIG }
let isStreaming = false
let activeAbort: AbortController | null = null
// Per-stream identity. streamGen is bumped whenever a stream starts or is force-disowned;
// each stream captures its own generation and only mutates shared state in its finally when
// it's still the current generation. This stops a slow/aborted stream's late finally from
// clobbering a newer stream's isStreaming/activeAbort. nextStreamId tags messages so the
// renderer can attribute chunks/done/error to the right answer bubble.
let streamGen = 0
let nextStreamId = 1

export function stopStreaming(): void {
  activeAbort?.abort()
  activeAbort = null
}

export function forceResetStreaming(): void {
  activeAbort = null
  isStreaming = false
  streamGen++ // disown any stuck stream: its late finally sees myGen !== streamGen and no-ops
}

// Send to the overlay only if its webContents is still alive — a renderer crash or window
// teardown mid-stream would otherwise throw on every send and escape as an unhandled rejection.
// Returns false when the target is gone so callers can stop the stream.
function safeSend(win: BrowserWindow, channel: string, payload?: unknown): boolean {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false
  win.webContents.send(channel, payload)
  return true
}

export function setConfig(partial: Partial<LLMConfig>): void {
  currentConfig = { ...currentConfig, ...partial }
  console.log('[LLM] config updated:', { baseUrl: currentConfig.baseUrl, model: currentConfig.model, visionModel: currentConfig.visionModel })
}

export function getConfig(): LLMConfig {
  return { ...currentConfig }
}

export function isCurrentlyStreaming(): boolean {
  return isStreaming
}

export interface HistoryRound {
  question: string
  answer: string
}

// Conversation memory lives in the main process so every entry point (overlay input,
// ask tab, voice auto-ask, screenshot-extracted text) shares one rolling context.
const conversationHistory: HistoryRound[] = []
const MAX_HISTORY_ROUNDS = 5

export function clearHistory(): void {
  conversationHistory.length = 0
}

export async function streamAnswer(
  question: string,
  overlayWindow: BrowserWindow
): Promise<void> {
  if (!currentConfig.apiKey) {
    safeSend(overlayWindow, 'llm:error', { id: null, message: '请先在设置中填写 API Key' })
    return
  }

  if (isStreaming) {
    safeSend(overlayWindow, 'llm:error', { id: null, message: '上一个问题还在生成中，请稍候' })
    return
  }

  const client = new OpenAI({
    apiKey: currentConfig.apiKey,
    baseURL: currentConfig.baseUrl,
    dangerouslyAllowBrowser: true
  })

  const id = nextStreamId++
  const myGen = ++streamGen
  const abort = new AbortController()
  activeAbort = abort
  isStreaming = true
  safeSend(overlayWindow, 'llm:start', { id, question })

  try {
    const stream = await client.chat.completions.create(
      {
        model: currentConfig.model,
        messages: buildMessages(question, currentConfig.jobDescription, conversationHistory),
        stream: true,
        max_tokens: 2000,
        temperature: 0.7
      },
      { signal: abort.signal }
    )

    let fullAnswer = ''
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? ''
      if (content) {
        fullAnswer += content
        if (!safeSend(overlayWindow, 'llm:chunk', { id, chunk: content })) { abort.abort(); break }
      }
    }

    // Record into rolling memory only on a real, non-aborted completion. The OpenAI SDK
    // swallows mid-stream aborts (loop ends normally), so guard on the signal — otherwise a
    // truncated partial answer pollutes the rolling context fed into later prompts.
    if (!abort.signal.aborted && fullAnswer.trim()) {
      conversationHistory.push({ question, answer: fullAnswer })
      if (conversationHistory.length > MAX_HISTORY_ROUNDS) {
        conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_ROUNDS)
      }
    }
    safeSend(overlayWindow, 'llm:done', { id })
  } catch (err: unknown) {
    // The SDK throws APIUserAbortError (name 'Error', not 'AbortError') when aborted before the
    // first chunk, so detect user-stop via our own signal rather than the error name.
    if (abort.signal.aborted) {
      safeSend(overlayWindow, 'llm:done', { id })  // treat user-stop as done
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      safeSend(overlayWindow, 'llm:error', { id, message: `${msg}\n[URL: ${currentConfig.baseUrl}, 模型: ${currentConfig.model}]` })
    }
  } finally {
    if (myGen === streamGen) {
      isStreaming = false
      activeAbort = null
    }
  }
}

export async function extractImageText(
  imageBase64: string,
  overlayWindow: BrowserWindow
): Promise<void> {
  if (!currentConfig.apiKey) {
    safeSend(overlayWindow, 'image:error', '请先在设置中填写 API Key')
    return
  }

  const client = new OpenAI({
    apiKey: currentConfig.apiKey,
    baseURL: currentConfig.baseUrl,
    dangerouslyAllowBrowser: true,
    maxRetries: 0 // fail fast — don't let SDK retries hang the "识别中" status for minutes
  })

  const useModel = currentConfig.visionModel || currentConfig.model
  console.log(`[ImageOCR] model=${useModel}, baseURL=${currentConfig.baseUrl}, imageSize=${Math.round(imageBase64.length * 3 / 4 / 1024)}KB`)

  // Notify overlay that extraction is starting
  safeSend(overlayWindow, 'image:status', 'extracting')

  try {
    const timeout = AbortSignal.timeout(45000)
    const result = await client.chat.completions.create({
      model: useModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            { type: 'text', text: '请完整识别图片中的全部文字（含代码，保留换行与缩进），逐行原样输出，不要省略、不要总结、不要补充解释。' }
          ]
        }
      ],
      max_tokens: 4000,
      temperature: 0
    }, { signal: timeout })

    const text = result.choices[0]?.message?.content ?? ''
    console.log(`[ImageOCR] done, extracted ${text.length} chars, usage: ${JSON.stringify(result.usage)}`)
    console.log(`[ImageOCR] preview: ${text.slice(0, 200)}`)
    if (text.trim()) {
      safeSend(overlayWindow, 'image:text', text)
    } else {
      safeSend(overlayWindow, 'image:error', '视觉模型返回了空内容，请检查模型是否支持图片输入')
    }
  } catch (err: unknown) {
    console.error('[ImageOCR] error:', JSON.stringify(err, null, 2))
    let msg = err instanceof Error ? err.message : String(err)
    if (err && typeof err === 'object' && 'error' in err) {
      const detail = (err as Record<string, unknown>).error
      if (detail && typeof detail === 'object' && 'message' in detail) {
        msg += ` — ${(detail as Record<string, unknown>).message}`
      }
    }
    safeSend(overlayWindow, 'image:error', `识别失败: ${msg}\n[模型: ${useModel}]`)
  }
}

function buildMessages(
  question: string,
  jobDescription: string,
  history: HistoryRound[] = []
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let systemContent = `你是一个专业的技术面试助手。请用简洁、准确的中文回答面试问题。

回答要求：
- 抓住重点，不要过于冗长
- 技术问题给出代码示例（用 markdown 代码块标注语言）
- 多点并列时用数字列表
- 回答控制在合理长度`

  if (jobDescription.trim()) {
    systemContent += `\n\n【应聘岗位描述】\n${jobDescription.trim()}`
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent }
  ]

  for (const round of history) {
    messages.push({ role: 'user', content: round.question })
    messages.push({ role: 'assistant', content: round.answer })
  }

  messages.push({ role: 'user', content: question })
  return messages
}

// Connectivity test for the Settings UI — uses the values currently in the form
// (not the saved config), so the user can verify before saving. OpenAI-compatible,
// so SiliconFlow / DeepSeek / Groq / OpenAI all work through the same path.
export async function testLLMConnection(
  cfg: { apiKey: string; baseUrl: string; model: string }
): Promise<{ ok: boolean; message: string }> {
  if (!cfg.apiKey) return { ok: false, message: '请先填写 API Key' }
  if (!cfg.model) return { ok: false, message: '请先填写模型名' }
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, dangerouslyAllowBrowser: true, maxRetries: 0 })
  const start = Date.now()
  try {
    const r = await client.chat.completions.create(
      { model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
      { signal: AbortSignal.timeout(15000) }
    )
    return { ok: true, message: `连接成功 · 模型 ${r.model || cfg.model} · ${Date.now() - start}ms` }
  } catch (err) {
    return { ok: false, message: describeApiError(err) }
  }
}

// Vision-model connectivity test — sends a realistic screenshot (see visionProbe.ts) so
// the user can verify the model actually accepts image input. Mirrors the real OCR path
// (same prompt + params), and tiny-image-rejecting VLMs (Qwen-VL etc.) accept it.
export async function testVisionConnection(
  cfg: { apiKey: string; baseUrl: string; visionModel: string }
): Promise<{ ok: boolean; message: string }> {
  if (!cfg.apiKey) return { ok: false, message: '请先填写 API Key' }
  if (!cfg.visionModel) return { ok: false, message: '请先填写视觉模型名' }
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, dangerouslyAllowBrowser: true, maxRetries: 0 })
  const start = Date.now()
  try {
    const r = await client.chat.completions.create(
      {
        model: cfg.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/png;base64,${VISION_PROBE_PNG_B64}` } },
              { type: 'text', text: '请识别图片中的文字内容，直接输出文字。' }
            ]
          }
        ],
        max_tokens: 64,
        temperature: 0
      },
      { signal: AbortSignal.timeout(20000) }
    )
    return { ok: true, message: `连接成功 · 模型 ${r.model || cfg.visionModel} · ${Date.now() - start}ms` }
  } catch (err) {
    return { ok: false, message: describeApiError(err) }
  }
}
