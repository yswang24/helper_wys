// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from './App'

// All three tabs stay mounted (display:none) so their listeners (e.g. onAsrPttToggle) keep working
// regardless of the active tab. This guards that invariant after the tab split.
beforeEach(() => {
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
              platform: 'darwin',
              version: '1.0.0',
              failedShortcuts: []
            })
        if (prop === 'getConfig' || prop === 'getPublicConfig') return () => Promise.resolve({})
        if (prop === 'platform') return 'darwin'
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
  })
})
