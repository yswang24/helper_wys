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
    expect(screen.getByText('API Key')).toBeInTheDocument() // Settings
    expect(await screen.findByText('fn⌃')).toBeInTheDocument()
    expect(screen.getByText('fn⇧')).toBeInTheDocument()
    expect(screen.getByText('fn⌥')).toBeInTheDocument()
    expect(screen.getByText('fn⌘')).toBeInTheDocument()
    expect(screen.getByText('⌥⌘X')).toBeInTheDocument()
    expect(screen.getByText('输入/穿透模式')).toBeInTheDocument()
    expect(screen.getByText('⌥⌘Z')).toBeInTheDocument()
    expect(screen.getByText(/局部截图/)).toBeInTheDocument()
    expect(screen.queryByText('fn+Tab')).not.toBeInTheDocument()
    expect(screen.getByText(/滚动模式（再按关闭/)).toBeInTheDocument()
    expect(screen.queryByText('⌘⌥H')).not.toBeInTheDocument()
    expect(screen.queryByText('⌘⌥S')).not.toBeInTheDocument()
    expect(screen.queryByText('⌘⌥↑ / ⌘⌥↓')).not.toBeInTheDocument()
  })

  it('does not advertise macOS-only shortcuts on other platforms', async () => {
    platform = 'win32'
    render(<App />)

    await waitFor(() => expect(screen.getByText('手动输入问题')).toBeInTheDocument())
    expect(screen.queryByText('fn⌃')).not.toBeInTheDocument()
    expect(screen.queryByText('fn⇧')).not.toBeInTheDocument()
    expect(screen.queryByText('fn⌥')).not.toBeInTheDocument()
    expect(screen.queryByText('fn⌘')).not.toBeInTheDocument()
    expect(screen.queryByText('⌥⌘X')).not.toBeInTheDocument()
    expect(screen.queryByText('输入/穿透模式')).not.toBeInTheDocument()
    expect(screen.queryByText('⌥⌘Z')).not.toBeInTheDocument()
    expect(screen.queryByText(/局部截图/)).not.toBeInTheDocument()
    expect(screen.queryByText(/滚动模式（再按关闭/)).not.toBeInTheDocument()
  })
})
