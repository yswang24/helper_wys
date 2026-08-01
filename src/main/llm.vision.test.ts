import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getClient: vi.fn()
}))

vi.mock('./openaiClient', () => ({ getOpenAIClient: mocks.getClient }))

import {
  clearHistory,
  forceResetStreaming,
  setConfig,
  setMainWindow,
  streamImageAnswer,
  testVisionConnection
} from './llm'
import { VISION_PROBE_PNG_B64, VISION_PROBE_PROMPT } from './visionProbe'

function completion(content: string | null, model = 'resolved-vision-model') {
  return { model, choices: [{ message: { content } }] }
}

function fakeWindow() {
  const send = vi.fn()
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send }
  } as unknown as BrowserWindow
  return { window, send }
}

describe('vision model use', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.getClient.mockReset()
    mocks.getClient.mockReturnValue({ chat: { completions: { create: mocks.create } } })
    forceResetStreaming()
    clearHistory()
    setMainWindow(null)
    setConfig({
      visionApiKey: 'vision-key',
      visionBaseUrl: 'https://vision.example/v1',
      visionModel: 'vision-model'
    })
  })

  it('passes the connection test only after recognizing all known image facts', async () => {
    mocks.create.mockResolvedValue(completion('- `seen`\n- **enumerate**\n- Two   Sum'))

    const result = await testVisionConnection({
      apiKey: 'vision-key',
      baseUrl: 'https://vision.example/v1',
      visionModel: 'vision-model'
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('resolved-vision-model')
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'vision-model',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${VISION_PROBE_PNG_B64}` }
              },
              { type: 'text', text: VISION_PROBE_PROMPT }
            ]
          }
        ]
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it.each([null, '', '请求成功，但我无法查看图片', 'seen and enumerate only'])(
    'fails clearly when HTTP succeeds without recognizing the probe: %s',
    async (content) => {
      mocks.create.mockResolvedValue(completion(content))

      const result = await testVisionConnection({
        apiKey: 'vision-key',
        baseUrl: 'https://vision.example/v1',
        visionModel: 'vision-model'
      })

      expect(result).toEqual({
        ok: false,
        message: '接口已响应，但模型未正确识别测试图片内容。请确认所选模型支持图片输入。'
      })
    }
  )

  it('rejects a known text-only model before creating a client', async () => {
    const result = await testVisionConnection({
      apiKey: 'vision-key',
      baseUrl: 'https://vision.example/v1',
      visionModel: 'GLM-5.2-fast-preview'
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('仅支持文本输入')
    expect(result.message).toContain('视觉模型')
    expect(mocks.getClient).not.toHaveBeenCalled()
  })

  it('does not reject a GLM-5V visual model', async () => {
    mocks.create.mockResolvedValue(completion('seen | enumerate | Two Sum', 'glm-5v-turbo'))

    const result = await testVisionConnection({
      apiKey: 'vision-key',
      baseUrl: 'https://vision.example/v1',
      visionModel: 'glm-5v-turbo'
    })

    expect(result.ok).toBe(true)
    expect(mocks.getClient).toHaveBeenCalledOnce()
  })

  it('shows a clear error instead of streaming an image to a known text-only model', async () => {
    setConfig({ visionModel: 'glm-5.2-fast-preview' })
    const { window, send } = fakeWindow()

    await streamImageAnswer('image-base64', window)

    expect(send).toHaveBeenCalledWith(
      'llm:error',
      expect.objectContaining({
        id: null,
        message: expect.stringContaining('仅支持文本输入')
      })
    )
    expect(mocks.getClient).not.toHaveBeenCalled()
  })
})
