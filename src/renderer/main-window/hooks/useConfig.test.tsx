// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfig } from './useConfig'

const loadedConfig = () => ({
  apiKey: 'text-key',
  baseUrl: 'https://text.example/v1',
  model: 'text-model',
  llmProviderProfiles: [
    {
      apiKey: 'saved-ali-text-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'saved-text-model'
    }
  ],
  visionApiKey: 'vision-key',
  visionBaseUrl: 'https://vision.example/v1',
  visionModel: 'vision-model',
  visionProviderProfiles: [],
  asrApiKey: 'audio-key',
  asrBaseUrl: 'https://audio.example/v1',
  asrModel: 'audio-model',
  asrProviderProfiles: [],
  jobDescription: '',
  resume: '',
  answerLang: 'zh' as const,
  screenshotPrompt: '',
  overlayOpacity: 0.94,
  screenshotMode: 'direct' as const
})

const setConfig = vi.fn()
const getConfig = vi.fn(() => Promise.resolve(loadedConfig()))

beforeEach(() => {
  setConfig.mockReset()
  getConfig.mockReset()
  getConfig.mockResolvedValue(loadedConfig())
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { getConfig, setConfig }
})

describe('independent provider configuration', () => {
  it('keeps text and vision switching independent and restores saved text credentials', async () => {
    const { result } = renderHook(() => useConfig())
    await waitFor(() => expect(result.current.baseUrl).toBe('https://text.example/v1'))

    act(() =>
      result.current.switchLlmProvider({
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3.5-omni-plus'
      })
    )

    expect(result.current.apiKey).toBe('saved-ali-text-key')
    expect(result.current.model).toBe('saved-text-model')
    expect(result.current.visionApiKey).toBe('vision-key')
    expect(result.current.visionBaseUrl).toBe('https://vision.example/v1')
    expect(result.current.visionModel).toBe('vision-model')
    expect(setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: 'saved-ali-text-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'saved-text-model'
      })
    )
  })

  it('stores and restores audio provider profiles independently', async () => {
    const { result } = renderHook(() => useConfig())
    await waitFor(() => expect(result.current.asrApiKey).toBe('audio-key'))

    act(() =>
      result.current.switchAsrProvider({
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-asr-flash'
      })
    )
    expect(result.current.asrApiKey).toBe('')
    expect(result.current.asrModel).toBe('qwen3-asr-flash')

    act(() =>
      result.current.switchAsrProvider({
        baseUrl: 'https://audio.example/v1',
        model: 'unused-default'
      })
    )
    expect(result.current.asrApiKey).toBe('audio-key')
    expect(result.current.asrModel).toBe('audio-model')
  })

  it('saves all three active providers and their profiles', async () => {
    const onSaved = vi.fn()
    const { result } = renderHook(() => useConfig(onSaved))
    await waitFor(() => expect(result.current.apiKey).toBe('text-key'))

    act(() => result.current.save())

    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'text-key',
        visionApiKey: 'vision-key',
        asrApiKey: 'audio-key',
        llmProviderProfiles: expect.any(Array),
        visionProviderProfiles: expect.any(Array),
        asrProviderProfiles: expect.any(Array)
      })
    )
    expect(result.current.saved).toBe(true)
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('refuses to save without a text API key', async () => {
    getConfig.mockResolvedValue({ ...loadedConfig(), apiKey: '' })
    const { result } = renderHook(() => useConfig())
    await waitFor(() => expect(getConfig).toHaveBeenCalledOnce())

    act(() => result.current.save())

    expect(setConfig).not.toHaveBeenCalled()
    expect(result.current.saveErr).toBe('请填写文本 API Key')
  })
})
