import OpenAI from 'openai'
import type { BrowserWindow } from 'electron'

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

export function stopStreaming(): void {
  activeAbort?.abort()
  activeAbort = null
}

export function forceResetStreaming(): void {
  activeAbort = null
  isStreaming = false
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

export async function streamAnswer(
  question: string,
  overlayWindow: BrowserWindow,
  history: HistoryRound[] = []
): Promise<void> {
  if (!currentConfig.apiKey) {
    overlayWindow.webContents.send('llm:error', '请先在设置中填写 API Key')
    return
  }

  if (isStreaming) {
    overlayWindow.webContents.send('llm:error', '上一个问题还在生成中，请稍候')
    return
  }

  const client = new OpenAI({
    apiKey: currentConfig.apiKey,
    baseURL: currentConfig.baseUrl,
    dangerouslyAllowBrowser: true
  })

  const abort = new AbortController()
  activeAbort = abort
  isStreaming = true
  overlayWindow.webContents.send('llm:start', question)

  try {
    const stream = await client.chat.completions.create(
      {
        model: currentConfig.model,
        messages: buildMessages(question, currentConfig.jobDescription, history),
        stream: true,
        max_tokens: 2000,
        temperature: 0.7
      },
      { signal: abort.signal }
    )

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? ''
      if (content) overlayWindow.webContents.send('llm:chunk', content)
    }

    overlayWindow.webContents.send('llm:done')
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      overlayWindow.webContents.send('llm:done')  // treat user-stop as done
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      overlayWindow.webContents.send('llm:error', `${msg}\n[URL: ${currentConfig.baseUrl}, 模型: ${currentConfig.model}]`)
    }
  } finally {
    isStreaming = false
    activeAbort = null
  }
}

export async function extractImageText(
  imageBase64: string,
  overlayWindow: BrowserWindow
): Promise<void> {
  if (!currentConfig.apiKey) {
    overlayWindow.webContents.send('llm:error', '请先在设置中填写 API Key')
    return
  }

  const client = new OpenAI({
    apiKey: currentConfig.apiKey,
    baseURL: currentConfig.baseUrl,
    dangerouslyAllowBrowser: true
  })

  const useModel = currentConfig.visionModel || currentConfig.model
  console.log(`[ImageOCR] model=${useModel}, baseURL=${currentConfig.baseUrl}, imageSize=${Math.round(imageBase64.length * 3 / 4 / 1024)}KB`)

  // Notify overlay that extraction is starting
  overlayWindow.webContents.send('image:status', 'extracting')

  try {
    const timeout = AbortSignal.timeout(60000)
    const result = await client.chat.completions.create({
      model: useModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            { type: 'text', text: '请识别图片中的文字内容，直接输出文字。' }
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
      overlayWindow.webContents.send('image:text', text)
    } else {
      overlayWindow.webContents.send('image:error', '视觉模型返回了空内容，请检查模型是否支持图片输入')
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
    overlayWindow.webContents.send('image:error', `识别失败: ${msg}\n[模型: ${useModel}]`)
  }
}

export async function streamImageAnswer(
  imageBase64: string,
  overlayWindow: BrowserWindow,
  userContext?: string
): Promise<void> {
  if (!currentConfig.apiKey) {
    overlayWindow.webContents.send('llm:error', '请先在设置中填写 API Key')
    return
  }

  if (isStreaming) {
    overlayWindow.webContents.send('llm:error', '上一个问题还在生成中，请稍候')
    return
  }

  const client = new OpenAI({
    apiKey: currentConfig.apiKey,
    baseURL: currentConfig.baseUrl,
    dangerouslyAllowBrowser: true
  })

  const abort = new AbortController()
  activeAbort = abort
  const label = '[图片识别]'
  isStreaming = true
  overlayWindow.webContents.send('llm:start', label)

  const useModel = currentConfig.visionModel || currentConfig.model
  console.log(`[ImageAnswer] model=${useModel}, baseURL=${currentConfig.baseUrl}, imageSize=${Math.round(imageBase64.length * 3 / 4 / 1024)}KB`)

  try {
    // Use non-streaming mode — many vision models (e.g. SiliconFlow Qwen-VL) don't support streaming
    const result = await client.chat.completions.create(
      {
        model: useModel,
        messages: buildImageMessages(imageBase64, currentConfig.jobDescription, userContext),
        max_tokens: 4000,
        temperature: 0.3
      },
      { signal: abort.signal }
    )

    const content = result.choices[0]?.message?.content ?? ''
    console.log(`[ImageAnswer] done, response length=${content.length}`)
    // Simulate streaming by sending in chunks for smooth UI
    const chunkSize = 20
    for (let i = 0; i < content.length; i += chunkSize) {
      overlayWindow.webContents.send('llm:chunk', content.slice(i, i + chunkSize))
    }
    overlayWindow.webContents.send('llm:done')
  } catch (err: unknown) {
    console.error('[ImageAnswer] error:', JSON.stringify(err, null, 2))
    if (err instanceof Error && err.name === 'AbortError') {
      overlayWindow.webContents.send('llm:done')
    } else {
      let msg = err instanceof Error ? err.message : String(err)
      // Try to extract more detail from OpenAI SDK error
      if (err && typeof err === 'object' && 'error' in err) {
        const detail = (err as Record<string, unknown>).error
        if (detail && typeof detail === 'object' && 'message' in detail) {
          msg += ` — ${(detail as Record<string, unknown>).message}`
        }
      }
      overlayWindow.webContents.send('llm:error', `图片识别失败: ${msg}\n[URL: ${currentConfig.baseUrl}, 模型: ${useModel}]`)
    }
  } finally {
    isStreaming = false
    activeAbort = null
  }
}

function buildImageMessages(
  imageBase64: string,
  jobDescription: string,
  userContext?: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let systemContent = `你是一个专业的面试助手。用户截取了一张图片（可能是面试题目、技术文档、系统设计图等），请根据图片内容智能判断题目类型并给出最佳回答：

- **编程/算法题**：分析题意 → 给出最优解代码（默认Python，除非指定） → 说明时间/空间复杂度
- **系统设计题**：列出核心要点 → 给出架构方案 → 说明权衡取舍
- **技术概念题**：简洁准确地解释概念 → 给出关键要点和示例
- **行为面试题**：提供STAR框架的回答思路 → 给出参考话术
- **其他类型**：根据内容给出最有帮助的回答

回答要求：
- 抓住重点，不要过于冗长
- 代码用 markdown 代码块包裹，注明语言
- 多点并列时用数字列表
- 回答控制在合理长度`

  if (jobDescription.trim()) {
    systemContent += `\n\n【应聘岗位描述】\n${jobDescription.trim()}`
  }

  const contentArray: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${imageBase64}` }
    }
  ]

  if (userContext?.trim()) {
    contentArray.push({
      type: 'text',
      text: `用户补充说明：${userContext.trim()}\n\n请结合图片内容和以上说明进行回答。`
    })
  } else {
    contentArray.push({ type: 'text', text: '请分析图片中的面试题目并给出回答。' })
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: contentArray }
  ]
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
