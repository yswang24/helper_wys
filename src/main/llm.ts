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
}

export function getConfig(): LLMConfig {
  return { ...currentConfig }
}

export function isCurrentlyStreaming(): boolean {
  return isStreaming
}

export async function streamAnswer(
  question: string,
  overlayWindow: BrowserWindow
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
        messages: buildMessages(question, currentConfig.jobDescription),
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

export async function streamCodingAnswer(
  imageBase64: string,
  overlayWindow: BrowserWindow
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
  const label = '[截图题目]'
  isStreaming = true
  overlayWindow.webContents.send('llm:start', label)

  try {
    const stream = await client.chat.completions.create(
      {
        model: currentConfig.visionModel || currentConfig.model,
        messages: buildCodingMessages(imageBase64, currentConfig.jobDescription),
        stream: true,
        max_tokens: 3000,
        temperature: 0.3
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
      overlayWindow.webContents.send('llm:done')
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      overlayWindow.webContents.send('llm:error', msg)
    }
  } finally {
    isStreaming = false
    activeAbort = null
  }
}

function buildCodingMessages(
  imageBase64: string,
  jobDescription: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let systemContent = `你是一个专业的算法面试助手。用户截取了一道编程题，请：
1. 简要分析题意和解题思路（2-3句话）
2. 给出完整的解题代码（选择最优解）
3. 简要说明时间/空间复杂度

代码用 markdown 代码块包裹，注明语言。默认使用 Python，除非题目指定语言。`

  if (jobDescription.trim()) {
    systemContent += `\n\n【应聘岗位描述】\n${jobDescription.trim()}`
  }

  return [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' }
        },
        { type: 'text', text: '请分析这道编程题并给出解答。' }
      ]
    }
  ]
}

function buildMessages(
  question: string,
  jobDescription: string
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

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: question }
  ]
}
