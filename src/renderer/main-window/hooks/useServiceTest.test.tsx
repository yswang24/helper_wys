// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useServiceTest } from './useServiceTest'

const testLLM = vi.fn()
const testVision = vi.fn()
const testASR = vi.fn()
const cfg = {
  apiKey: 'k',
  baseUrl: 'b',
  model: 'm',
  visionModel: 'vm',
  asrApiKey: 'ak',
  asrBaseUrl: 'ab',
  asrModel: 'am'
}

beforeEach(() => {
  ;[testLLM, testVision, testASR].forEach((f) => f.mockReset())
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { testLLM, testVision, testASR }
})

describe('useServiceTest', () => {
  it('transitions testing → ok and passes the right params', async () => {
    testLLM.mockResolvedValue({ ok: true, message: '连接成功' })
    const { result } = renderHook(() => useServiceTest(cfg))
    await act(async () => {
      await result.current.testLlm()
    })
    expect(testLLM).toHaveBeenCalledWith({ apiKey: 'k', baseUrl: 'b', model: 'm' })
    expect(result.current.llmTest).toEqual({ st: 'ok', msg: '连接成功' })
  })

  it('maps ok:false to fail with the message', async () => {
    testVision.mockResolvedValue({ ok: false, message: '模型不支持图片' })
    const { result } = renderHook(() => useServiceTest(cfg))
    await act(async () => {
      await result.current.testVision()
    })
    expect(result.current.visionTest).toEqual({ st: 'fail', msg: '模型不支持图片' })
  })

  it('catches a thrown error into fail', async () => {
    testASR.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useServiceTest(cfg))
    await act(async () => {
      await result.current.testAsr()
    })
    expect(testASR).toHaveBeenCalledWith({ apiKey: 'ak', baseUrl: 'ab', model: 'am' })
    expect(result.current.asrTest).toEqual({ st: 'fail', msg: 'network down' })
  })
})
