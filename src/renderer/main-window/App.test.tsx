// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from './App'

let platform = 'darwin'

// All three tabs stay mounted (display:none) so their listeners (e.g. onAsrPttToggle) keep working
// regardless of the active tab. This guards that invariant after the tab split.
beforeEach(() => {
  platform = 'darwin'
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve([]),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  })
  const noopUnsub = () => () => {}
  ;(window as unknown as { electronAPI: unknown }).electronAPI = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'getStatus')
          return () =>
            Promise.resolve({
              contentProtection: true,
              overlayVisible: false,
              platform,
              version: '1.0.0',
              failedShortcuts: []
            })
        if (prop === 'getConfig' || prop === 'getPublicConfig') return () => Promise.resolve({})
        if (prop === 'platform') return platform
        if (prop.startsWith('on')) return noopUnsub
        return () => {}
      }
    }
  )
})

describe('main-window App', () => {
  it('keeps all three tabs mounted at once (Ask + Voice + Settings content all present)', async () => {
    render(<App />)
    // Content unique to each tab is in the DOM simultaneously (hidden via display:none, not unmounted).
    await waitFor(() => expect(screen.getByText('手动输入问题')).toBeInTheDocument()) // Ask
    expect(screen.getByText('默认输入设备（麦克风）')).toBeInTheDocument() // Voice
    expect(screen.getAllByText('文本模型').length).toBeGreaterThan(0) // Settings
    expect(screen.getByText('视频 / 视觉模型')).toBeInTheDocument()
    expect(screen.getByText('音频模型（语音识别 ASR）')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '硅基流动' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: '阿里云百炼' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: '小米 MiMo Token Plan' })).toHaveLength(3)
    expect(await screen.findByText('fn⇧')).toBeInTheDocument()
    expect(screen.getByText('⌘⌥↑ / ⌘⌥↓')).toBeInTheDocument()
    expect(screen.getByText(/滚动模式（再按关闭/)).toBeInTheDocument()
  })

  it('does not advertise macOS-only shortcuts on other platforms', async () => {
    platform = 'win32'
    render(<App />)

    await waitFor(() => expect(screen.getByText('手动输入问题')).toBeInTheDocument())
    expect(screen.queryByText('fn⇧')).not.toBeInTheDocument()
    expect(screen.queryByText('⌘⌥↑ / ⌘⌥↓')).not.toBeInTheDocument()
    expect(screen.queryByText(/滚动模式（再按关闭/)).not.toBeInTheDocument()
  })
})
