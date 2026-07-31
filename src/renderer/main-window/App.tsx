import { useState, useEffect } from 'react'
import { AskTab } from './tabs/Ask'
import { VoiceTab } from './tabs/Voice'
import { SettingsTab } from './tabs/Settings'
interface AppStatus {
  contentProtection: boolean
  overlayVisible: boolean
  platform: string
  version: string
  failedShortcuts?: string[]
}

type Tab = 'ask' | 'voice' | 'settings'

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [tab, setTab] = useState<Tab>('ask')
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    // Only static fields are shown now (version + failedShortcuts) — no live overlay status — so a
    // mount fetch plus one delayed refetch (failedShortcuts is set during app startup, which can
    // land just after this window mounts) replaces the old permanent 2s polling.
    let cancelled = false
    const fetchStatus = () => window.electronAPI.getStatus().then((s) => { if (!cancelled) setStatus(s) })
    fetchStatus()
    const t = setTimeout(fetchStatus, 1200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [])

  // On first load, if no API key is saved, redirect to settings
  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      if (!cfg.apiKey) {
        setTab('settings')
        setNeedsSetup(true)
      }
    })
  }, [])

  return (
    <div className="flex flex-col h-screen" style={{ color: '#e2e8f0' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#1e1e2e' }}>
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
        >
          H
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">Helper</div>
          <div className="text-xs" style={{ color: '#475569' }}>v{status?.version ?? '...'}</div>
        </div>
      </div>

      {/* Shortcut-registration failure warning */}
      {status?.failedShortcuts && status.failedShortcuts.length > 0 && (
        <div
          className="px-4 py-2 text-xs"
          style={{ background: 'rgba(217,119,6,0.12)', borderBottom: '1px solid rgba(217,119,6,0.3)', color: '#fbbf24' }}
        >
          ⚠ 以下快捷键不可用（可能被占用或系统组件启动失败）：
          {status.failedShortcuts.join('、')}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b px-2 pt-2" style={{ borderColor: '#1e1e2e' }}>
        {([['ask', '提问'], ['voice', '语音'], ['settings', '设置']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 text-xs font-medium rounded-t transition-colors"
            style={{
              color: tab === t ? '#7dd3fc' : '#475569',
              borderBottom: tab === t ? '2px solid #7dd3fc' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* First-run banner */}
      {needsSetup && tab === 'settings' && (
        <div
          className="px-4 py-2 text-xs"
          style={{ background: 'rgba(59,130,246,0.12)', borderBottom: '1px solid rgba(59,130,246,0.25)', color: '#7dd3fc' }}
        >
          首次使用 — 请填写 API Key 后保存，即可开始使用
        </div>
      )}

      {/* Content — all tabs stay mounted so their listeners (e.g. onAsrPttToggle) remain active */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 overflow-y-auto" style={{ display: tab === 'ask' ? 'block' : 'none' }}><AskTab /></div>
        <div className="absolute inset-0 overflow-hidden flex flex-col" style={{ display: tab === 'voice' ? 'flex' : 'none' }}><VoiceTab active={tab === 'voice'} onGoSettings={() => setTab('settings')} /></div>
        <div className="absolute inset-0 overflow-y-auto" style={{ display: tab === 'settings' ? 'block' : 'none' }}><SettingsTab onSaved={() => setNeedsSetup(false)} /></div>
      </div>

      {/* Shortcuts footer */}
      <div
        className="px-4 py-2 text-xs border-t flex gap-3 flex-wrap"
        style={{ borderColor: '#1e1e2e', color: '#334155' }}
      >
        {status?.platform === 'darwin' && (
          <>
            <span><kbd className="font-mono">fn⌃</kbd> 录音开关</span>
            <span><kbd className="font-mono">fn⇧</kbd> 全屏截图</span>
            <span>
              <kbd className="font-mono">fn⌥</kbd>{' '}
              滚动模式（再按关闭；↑↓ 由 Helper 接管；30 秒无操作关闭）
            </span>
            <span><kbd className="font-mono">fn⌘</kbd> 覆盖层</span>
            <span><kbd className="font-mono">⌥⌘X</kbd> 输入/穿透模式</span>
            <span><kbd className="font-mono">⌥⌘Z</kbd> 局部截图</span>
          </>
        )}
      </div>
    </div>
  )
}
