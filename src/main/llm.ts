import OpenAI from 'openai'
import type { BrowserWindow } from 'electron'
import { describeApiError } from './apiError'
import { VISION_PROBE_PNG_B64 } from './visionProbe'
import { getOpenAIClient } from './openaiClient'

export interface LLMConfig {
  apiKey: string
  baseUrl: string
  model: string
  visionApiKey: string
  visionBaseUrl: string
  visionModel: string
  jobDescription: string
  // 候选人背景/简历要点 — 注入 system prompt（见 buildBaseMessages），让"你做过什么项目"这类
  // 个人经历问题能贴合真实简历作答，而不是泛泛的标准答案。
  resume: string
  // 回答语言：'zh' 固定中文（旧行为）/ 'en' 固定英文 / 'auto' 跟随提问语言。
  // 字符串而非联合类型：config:set 的 IPC 载荷是 Record<string, string>，与其它字段保持一致。
  answerLang: string
  // Custom instruction sent alongside screenshots in direct-solve mode (⌥⌘Z / Fn+Shift).
  // Empty = default.
  screenshotPrompt: string
}

const DEFAULT_CONFIG: LLMConfig = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  visionApiKey: '',
  visionBaseUrl: 'https://api.deepseek.com',
  visionModel: 'deepseek-chat',
  jobDescription: '',
  resume: '',
  answerLang: 'zh',
  screenshotPrompt: ''
}

// Used when screenshotPrompt is blank — the original built-in instruction.
const DEFAULT_SCREENSHOT_PROMPT =
  '请解答这张截图里的题目。如果是代码/算法题，给出完整可运行的解法并简要说明思路。'

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

// The main window mirrors the stream LIFECYCLE (start/done/error, not chunks) so the Ask tab's
// "发送中…" button can track real progress instead of a fixed timer. Registered from index.ts.
let mainWindowRef: BrowserWindow | null = null
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}
function notifyMain(channel: string, payload: unknown): void {
  if (mainWindowRef) safeSend(mainWindowRef, channel, payload)
}

export function setConfig(partial: Partial<LLMConfig>): void {
  currentConfig = { ...currentConfig, ...partial }
  console.log('[LLM] config updated:', {
    baseUrl: currentConfig.baseUrl,
    model: currentConfig.model,
    visionBaseUrl: currentConfig.visionBaseUrl,
    visionModel: currentConfig.visionModel
  })
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
// Secondary cap (on top of round count): keep only the most recent rounds that fit this many
// chars, so a few long code answers can't bloat the prompt and inflate time-to-first-token.
const MAX_HISTORY_CHARS = 6000

export function clearHistory(): void {
  conversationHistory.length = 0
}

// Shared streaming core for both text questions and direct screenshot solving. Handles the full
// per-stream lifecycle (id/generation tagging, abort, rolling-memory recording, overlay events)
// so the two entry points only differ in the model + the messages they build.
//   historyQuestion — what to store as the "question" side of the rolling memory round (a label
//   like "[截图题目]" for image solves, since the real prompt is an image, not text).
async function streamChat(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  questionLabel: string,
  historyQuestion: string,
  overlayWindow: BrowserWindow,
  provider?: { apiKey: string; baseUrl: string; label: string }
): Promise<void> {
  const providerApiKey = provider?.apiKey ?? currentConfig.apiKey
  const providerBaseUrl = provider?.baseUrl ?? currentConfig.baseUrl
  if (!providerApiKey) {
    const message = `请先在设置中填写${provider?.label ?? '文本'} API Key`
    safeSend(overlayWindow, 'llm:error', { id: null, message })
    notifyMain('llm:error', { id: null, message }) // so a failed Ask-tab submit re-enables its button
    return
  }

  if (isStreaming) {
    const message = '上一个问题还在生成中，请稍候'
    safeSend(overlayWindow, 'llm:error', { id: null, message })
    notifyMain('llm:error', { id: null, message })
    return
  }

  const client = getOpenAIClient({ apiKey: providerApiKey, baseURL: providerBaseUrl })

  const id = nextStreamId++
  const myGen = ++streamGen
  const abort = new AbortController()
  activeAbort = abort
  isStreaming = true
  safeSend(overlayWindow, 'llm:start', { id, question: questionLabel })
  notifyMain('llm:start', { id, question: questionLabel })

  // Idle watchdog: a half-open connection or a server that never sends [DONE] would otherwise
  // hang the for-await forever (overlay stuck on "正在生成", isStreaming pinned true). Arm before
  // the request (covers connect + first token) and re-arm on every chunk (covers inter-token gaps).
  let timedOut = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, 30000)
  }

  try {
    armIdle()
    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
        max_tokens: 2000,
        temperature: 0.7
      },
      { signal: abort.signal }
    )

    let fullAnswer = ''
    for await (const chunk of stream) {
      armIdle()
      const content = chunk.choices[0]?.delta?.content ?? ''
      if (content) {
        fullAnswer += content
        if (!safeSend(overlayWindow, 'llm:chunk', { id, chunk: content })) {
          abort.abort()
          break
        }
      }
    }

    // Record into rolling memory only on a real, non-aborted completion. The OpenAI SDK
    // swallows mid-stream aborts (loop ends normally), so guard on the signal — otherwise a
    // truncated partial answer pollutes the rolling context fed into later prompts.
    if (!abort.signal.aborted && fullAnswer.trim()) {
      conversationHistory.push({ question: historyQuestion, answer: fullAnswer })
      if (conversationHistory.length > MAX_HISTORY_ROUNDS) {
        conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_ROUNDS)
      }
    }
    // Empty, non-aborted result = the model/gateway returned nothing (wrong model name, or an
    // inline error frame the SDK parsed without throwing). Surface it instead of a silent empty
    // bubble — mirrors extractImageText's empty-content handling.
    if (!abort.signal.aborted && !fullAnswer.trim()) {
      const message = `模型未返回内容，请检查模型名是否正确/是否支持该接口\n[URL: ${providerBaseUrl}, 模型: ${model}]`
      safeSend(overlayWindow, 'llm:error', { id, message })
      notifyMain('llm:error', { id, message })
    } else {
      safeSend(overlayWindow, 'llm:done', { id })
      notifyMain('llm:done', { id })
    }
  } catch (err: unknown) {
    if (timedOut) {
      const message = `请求超时（30 秒无响应），请检查网络或 Base URL\n[URL: ${providerBaseUrl}, 模型: ${model}]`
      safeSend(overlayWindow, 'llm:error', { id, message })
      notifyMain('llm:error', { id, message })
    } else if (abort.signal.aborted) {
      // The SDK throws APIUserAbortError (name 'Error', not 'AbortError') when aborted before the
      // first chunk, so detect user-stop via our own signal rather than the error name.
      safeSend(overlayWindow, 'llm:done', { id }) // treat user-stop as done
      notifyMain('llm:done', { id })
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      const message = `${msg}\n[URL: ${providerBaseUrl}, 模型: ${model}]`
      safeSend(overlayWindow, 'llm:error', { id, message })
      notifyMain('llm:error', { id, message })
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    if (myGen === streamGen) {
      isStreaming = false
      activeAbort = null
    }
  }
}

export function streamAnswer(question: string, overlayWindow: BrowserWindow): Promise<void> {
  return streamChat(
    currentConfig.model,
    buildMessages(
      question,
      currentConfig.jobDescription,
      currentConfig.resume,
      conversationHistory
    ),
    question,
    question,
    overlayWindow
  )
}

// Direct screenshot solving: feed the cropped image straight to the vision model and STREAM the
// answer — one API round trip instead of OCR-then-ask (two). Used by direct screenshot solving.
export function streamImageAnswer(
  imageBase64: string,
  overlayWindow: BrowserWindow
): Promise<void> {
  const model = currentConfig.visionModel || currentConfig.model
  const promptText = currentConfig.screenshotPrompt?.trim() || DEFAULT_SCREENSHOT_PROMPT
  return streamChat(
    model,
    buildImageMessages(
      imageBase64,
      currentConfig.jobDescription,
      currentConfig.resume,
      conversationHistory,
      promptText
    ),
    '📷 截图解题',
    '[截图题目]',
    overlayWindow,
    {
      apiKey: currentConfig.visionApiKey,
      baseUrl: currentConfig.visionBaseUrl,
      label: '视觉'
    }
  )
}

export async function extractImageText(
  imageBase64: string,
  overlayWindow: BrowserWindow
): Promise<void> {
  if (!currentConfig.visionApiKey) {
    safeSend(overlayWindow, 'image:error', '请先在设置中填写视觉 API Key')
    return
  }

  // maxRetries: 0 — fail fast; don't let SDK retries hang the "识别中" status for minutes
  const client = getOpenAIClient({
    apiKey: currentConfig.visionApiKey,
    baseURL: currentConfig.visionBaseUrl,
    maxRetries: 0
  })

  const useModel = currentConfig.visionModel || currentConfig.model
  console.log(
    `[ImageOCR] model=${useModel}, baseURL=${currentConfig.visionBaseUrl}, imageSize=${Math.round((imageBase64.length * 3) / 4 / 1024)}KB`
  )

  // Notify overlay that extraction is starting
  safeSend(overlayWindow, 'image:status', 'extracting')

  try {
    const timeout = AbortSignal.timeout(45000)
    const result = await client.chat.completions.create(
      {
        model: useModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
              {
                type: 'text',
                text: '请完整识别图片中的全部文字（含代码，保留换行与缩进），逐行原样输出，不要省略、不要总结、不要补充解释。'
              }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0
      },
      { signal: timeout }
    )

    const text = result.choices[0]?.message?.content ?? ''
    console.log(
      `[ImageOCR] done, extracted ${text.length} chars, usage: ${JSON.stringify(result.usage)}`
    )
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

const ANSWER_RULES = `回答要求：
- 抓住重点，不要过于冗长
- 技术问题给出代码示例（用 markdown 代码块标注语言）
- 多点并列时用数字列表
- 回答控制在合理长度`

// 回答语言片段，拼进两个入口的 system intro。此前硬编码中文——英文面试即使转写出英文问题，
// 答案仍是中文、没法照读；现在跟随 answerLang 配置（设置页「回答个性化」）。
function answerLangPhrase(): string {
  switch (currentConfig.answerLang) {
    case 'en':
      return '简洁、准确的英文'
    case 'auto':
      return '与提问相同的语言（英文题用英文、中文题用中文）简洁准确地'
    default:
      return '简洁、准确的中文'
  }
}

// System prompt + replayed rolling memory, shared by the text and image entry points.
// The caller appends the final user turn (text or image) to the returned array.
function buildBaseMessages(
  intro: string,
  jobDescription: string,
  resume: string,
  history: HistoryRound[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let systemContent = `${intro}\n\n${ANSWER_RULES}`
  if (resume.trim()) {
    systemContent += `\n\n【候选人背景/简历】\n${resume.trim()}\n回答自我介绍、项目经历等个人问题时，用第一人称、结合以上真实背景作答；不要编造背景里没有的经历。`
  }
  if (jobDescription.trim()) {
    systemContent += `\n\n【应聘岗位描述】\n${jobDescription.trim()}`
  }
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent }
  ]
  // Walk newest→oldest accumulating a char budget; drop older rounds once it's exhausted. The
  // newest round is always kept even if it alone exceeds the budget, so context never goes empty.
  const selected: HistoryRound[] = []
  let budget = MAX_HISTORY_CHARS
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = history[i].question.length + history[i].answer.length
    if (selected.length && budget - cost < 0) break
    budget -= cost
    selected.unshift(history[i])
  }
  for (const round of selected) {
    messages.push({ role: 'user', content: round.question })
    messages.push({ role: 'assistant', content: round.answer })
  }
  return messages
}

function buildMessages(
  question: string,
  jobDescription: string,
  resume: string,
  history: HistoryRound[] = []
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages = buildBaseMessages(
    `你是一个专业的技术面试助手。请用${answerLangPhrase()}回答面试问题。`,
    jobDescription,
    resume,
    history
  )
  messages.push({ role: 'user', content: question })
  return messages
}

function buildImageMessages(
  imageBase64: string,
  jobDescription: string,
  resume: string,
  history: HistoryRound[],
  promptText: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages = buildBaseMessages(
    `你是一个专业的技术面试助手。下面给你一张题目截图，请先看懂图里的题目/代码，再用${answerLangPhrase()}作答。`,
    jobDescription,
    resume,
    history
  )
  messages.push({
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      { type: 'text', text: promptText }
    ]
  })
  return messages
}

// Connectivity test for the Settings UI — uses the values currently in the form
// (not the saved config), so the user can verify before saving. OpenAI-compatible,
// so SiliconFlow / DeepSeek / Groq / OpenAI all work through the same path.
export async function testLLMConnection(cfg: {
  apiKey: string
  baseUrl: string
  model: string
}): Promise<{ ok: boolean; message: string }> {
  if (!cfg.apiKey) return { ok: false, message: '请先填写 API Key' }
  if (!cfg.model) return { ok: false, message: '请先填写模型名' }
  const client = getOpenAIClient({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, maxRetries: 0 })
  const start = Date.now()
  try {
    const r = await client.chat.completions.create(
      { model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
      { signal: AbortSignal.timeout(15000) }
    )
    return {
      ok: true,
      message: `连接成功 · 模型 ${r.model || cfg.model} · ${Date.now() - start}ms`
    }
  } catch (err) {
    return { ok: false, message: describeApiError(err) }
  }
}

// Vision-model connectivity test — sends a realistic screenshot (see visionProbe.ts) so
// the user can verify the model actually accepts image input. Mirrors the real OCR path
// (same prompt + params), and tiny-image-rejecting VLMs (Qwen-VL etc.) accept it.
export async function testVisionConnection(cfg: {
  apiKey: string
  baseUrl: string
  visionModel: string
}): Promise<{ ok: boolean; message: string }> {
  if (!cfg.apiKey) return { ok: false, message: '请先填写 API Key' }
  if (!cfg.visionModel) return { ok: false, message: '请先填写视觉模型名' }
  const client = getOpenAIClient({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, maxRetries: 0 })
  const start = Date.now()
  try {
    const r = await client.chat.completions.create(
      {
        model: cfg.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${VISION_PROBE_PNG_B64}` }
              },
              { type: 'text', text: '请识别图片中的文字内容，直接输出文字。' }
            ]
          }
        ],
        max_tokens: 64,
        temperature: 0
      },
      { signal: AbortSignal.timeout(20000) }
    )
    return {
      ok: true,
      message: `连接成功 · 模型 ${r.model || cfg.visionModel} · ${Date.now() - start}ms`
    }
  } catch (err) {
    return { ok: false, message: describeApiError(err) }
  }
}
