import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toFile: vi.fn(),
  transcriptionCreate: vi.fn(),
  chatCreate: vi.fn(),
  getClient: vi.fn()
}))

vi.mock('openai', () => ({ toFile: mocks.toFile }))
vi.mock('./openaiClient', () => ({ getOpenAIClient: mocks.getClient }))

import { setASRConfig, testASRConnection, transcribeAudio } from './asr'

describe('provider-specific audio recognition', () => {
  beforeEach(() => {
    mocks.toFile.mockReset()
    mocks.transcriptionCreate.mockReset()
    mocks.chatCreate.mockReset()
    mocks.getClient.mockReset()
    mocks.getClient.mockReturnValue({
      audio: { transcriptions: { create: mocks.transcriptionCreate } },
      chat: { completions: { create: mocks.chatCreate } }
    })
    setASRConfig({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'whisper-1'
    })
  })

  it.each([
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  ])('uses Qwen chat audio for Alibaba endpoint %s', async (baseUrl) => {
    setASRConfig({ baseUrl, model: 'qwen3-asr-flash' })
    mocks.chatCreate.mockResolvedValue({
      choices: [{ message: { content: ' 百炼转写结果 ' } }]
    })

    await expect(transcribeAudio(Buffer.from('wav-audio'), 'audio/wav', 'zh-CN')).resolves.toBe(
      '百炼转写结果'
    )
    expect(mocks.transcriptionCreate).not.toHaveBeenCalled()
    expect(mocks.chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3-asr-flash',
        stream: false,
        asr_options: { language: 'zh', enable_itn: true },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: `data:audio/wav;base64,${Buffer.from('wav-audio').toString('base64')}`
                }
              }
            ]
          }
        ]
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('tests a dedicated Alibaba workspace endpoint through chat completions', async () => {
    mocks.chatCreate.mockResolvedValue({
      choices: [{ message: { content: 'probe' } }]
    })

    const result = await testASRConnection({
      apiKey: 'test-key',
      baseUrl: 'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-asr-flash'
    })

    expect(result.ok).toBe(true)
    expect(mocks.toFile).not.toHaveBeenCalled()
    expect(mocks.transcriptionCreate).not.toHaveBeenCalled()
    expect(mocks.chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3-asr-flash',
        asr_options: { enable_itn: true }
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('uses MiMo chat audio and rejects unsupported input formats', async () => {
    setASRConfig({
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      model: 'mimo-v2.5-asr'
    })
    mocks.chatCreate.mockResolvedValue({
      choices: [{ message: { content: 'MiMo transcript' } }]
    })

    await expect(transcribeAudio(Buffer.from('wav-audio'), 'audio/wav', 'en-US')).resolves.toBe(
      'MiMo transcript'
    )
    await expect(transcribeAudio(Buffer.from('webm-audio'), 'audio/webm', 'zh-CN')).rejects.toThrow(
      '仅支持 WAV 或 MP3'
    )
  })

  it('keeps Whisper-compatible providers on audio transcriptions', async () => {
    mocks.toFile.mockResolvedValue({ name: 'audio.webm' })
    mocks.transcriptionCreate.mockResolvedValue({ text: ' transcript ' })

    await expect(transcribeAudio(Buffer.from('audio'), 'audio/webm', 'zh-CN')).resolves.toBe(
      'transcript'
    )
    expect(mocks.chatCreate).not.toHaveBeenCalled()
    expect(mocks.transcriptionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-1',
        language: 'zh',
        file: { name: 'audio.webm' }
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })
})
