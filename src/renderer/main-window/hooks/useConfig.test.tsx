// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConfig } from './useConfig'

const setConfig = vi.fn()
const getConfig = vi.fn(() => Promise.resolve({}))

beforeEach(() => {
  setConfig.mockClear()
  getConfig.mockClear()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { getConfig, setConfig }
})

describe('useConfig save validation', () => {
  it('refuses to save with an empty API key (no setConfig, error shown)', async () => {
    const { result } = renderHook(() => useConfig())
    await act(async () => {}) // let the mount getConfig resolve
    act(() => result.current.save())
    expect(setConfig).not.toHaveBeenCalled()
    expect(result.current.saveErr).toBe('请填写 API Key')
  })

  it('rejects a malformed Base URL', async () => {
    const { result } = renderHook(() => useConfig())
    await act(async () => {})
    act(() => result.current.setApiKey('sk-x'))
    act(() => result.current.setBaseUrl('not a url'))
    act(() => result.current.save())
    expect(setConfig).not.toHaveBeenCalled()
    expect(result.current.saveErr).toContain('Base URL')
  })

  it('saves a valid config (setConfig with all fields, saved=true, onSaved fired)', async () => {
    const onSaved = vi.fn()
    const { result } = renderHook(() => useConfig(onSaved))
    await act(async () => {})
    act(() => result.current.setApiKey('sk-x'))
    act(() => result.current.save())
    expect(setConfig).toHaveBeenCalledOnce()
    expect(setConfig.mock.calls[0][0]).toMatchObject({ apiKey: 'sk-x', baseUrl: 'https://api.deepseek.com' })
    expect(result.current.saved).toBe(true)
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
