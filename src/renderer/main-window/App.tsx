import { useEffect, useRef, useState } from 'react'
import { isHallucinatedText } from '../../shared/hallucination'

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
          ⚠ 以下快捷键注册失败（可能被其他应用占用）：{status.failedShortcuts.join('、')}
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
        <span><kbd className="font-mono">⌘⌥H</kbd> 覆盖层</span>
        <span><kbd className="font-mono">⌘⌥X</kbd> 录音开关</span>
        <span><kbd className="font-mono">⌘⌥S</kbd> 截图解题</span>
      </div>
    </div>
  )
}

// ── Ask Tab ───────────────────────────────────────────────────────────────────
function AskTab() {
  const [question, setQuestion] = useState('')
  const [jd, setJd] = useState('')
  const [isSending, setIsSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Sync JD to main process whenever it changes
  useEffect(() => {
    const t = setTimeout(() => {
      window.electronAPI.setConfig({ jobDescription: jd })
    }, 500)
    return () => clearTimeout(t)
  }, [jd])

  // Track the real stream lifecycle (main mirrors llm:start/done/error to this window) so "发送中…"
  // reflects actual generation, not a fixed 1.5s guess. But these events fire for EVERY stream
  // (voice/screenshot/overlay too), so correlate by id: only the stream WE submitted drives the
  // button. pendingSubmitRef adopts the first start after a local submit; finishing requires a
  // matching id (or, for pre-start errors carrying id:null, that we're still pending).
  const pendingSubmitRef = useRef(false)
  const myStreamIdRef = useRef<number | null>(null)
  useEffect(() => {
    const clearSafety = () => { if (sendTimerRef.current) clearTimeout(sendTimerRef.current) }
    const reset = () => { clearSafety(); pendingSubmitRef.current = false; myStreamIdRef.current = null; setIsSending(false) }
    const unStart = window.electronAPI.onAnswerStart(({ id }) => {
      if (pendingSubmitRef.current) { myStreamIdRef.current = id; pendingSubmitRef.current = false }
    })
    const unDone = window.electronAPI.onAnswerDone(({ id }) => {
      if (!pendingSubmitRef.current && id === myStreamIdRef.current) reset()
    })
    const unError = window.electronAPI.onAnswerError(({ id }) => {
      // id:null = a pre-start failure (missing key / busy). If we're mid-submit, it's ours → reset.
      if (pendingSubmitRef.current || (id !== null && id === myStreamIdRef.current)) reset()
    })
    return () => { unStart(); unDone(); unError(); clearSafety() }
  }, [])

  const submit = () => {
    const q = question.trim()
    if (!q || isSending) return
    setIsSending(true)
    pendingSubmitRef.current = true  // adopt the next stream start as ours
    window.electronAPI.askQuestion(q)
    setQuestion('')
    // Safety net: if our start/done/error is ever missed, don't strand the button disabled.
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    sendTimerRef.current = setTimeout(() => { pendingSubmitRef.current = false; myStreamIdRef.current = null; setIsSending(false) }, 30000)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto">
      {/* JD input */}
      <div>
        <label className="text-xs font-medium mb-1.5 block" style={{ color: '#64748b' }}>
          岗位描述 JD（可选，提升答案相关性）
        </label>
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          placeholder="粘贴岗位描述，例如：负责后端微服务架构设计，熟悉 Redis、Kafka..."
          rows={4}
          className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none transition-colors"
          style={{
            background: '#0f0f1a',
            border: '1px solid #1e1e3a',
            color: '#94a3b8',
            lineHeight: '1.6',
            fontFamily: 'inherit'
          }}
          onFocus={(e) => (e.target.style.borderColor = '#3b4fd4')}
          onBlur={(e) => (e.target.style.borderColor = '#1e1e3a')}
        />
      </div>

      {/* Question input */}
      <div className="flex-1">
        <label className="text-xs font-medium mb-1.5 block" style={{ color: '#64748b' }}>
          手动输入问题
        </label>
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入面试问题... (Ctrl+Enter 发送)"
          rows={4}
          className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none transition-colors"
          style={{
            background: '#0f0f1a',
            border: '1px solid #1e1e3a',
            color: '#e2e8f0',
            lineHeight: '1.6',
            fontFamily: 'inherit'
          }}
          onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
          onBlur={(e) => (e.target.style.borderColor = '#1e1e3a')}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs" style={{ color: '#334155' }}>Ctrl+Enter 快速发送</span>
          <div className="flex gap-2">
            <button
              onClick={() => window.electronAPI.clearAnswer()}
              className="px-3 py-1 text-xs rounded transition-colors"
              style={{ background: '#1e1e2e', color: '#64748b', border: '1px solid #2d2d44', cursor: 'pointer' }}
            >
              清空
            </button>
            <button
              onClick={submit}
              disabled={!question.trim() || isSending}
              className="px-4 py-1 text-xs rounded font-medium transition-all"
              style={{
                background: question.trim() && !isSending ? '#3b82f6' : '#1e293b',
                color: question.trim() && !isSending ? '#fff' : '#334155',
                border: 'none',
                cursor: question.trim() && !isSending ? 'pointer' : 'default'
              }}
            >
              {isSending ? '发送中...' : '发送'}
            </button>
          </div>
        </div>
      </div>

      {/* Hint */}
      <div
        className="rounded-lg px-3 py-2 text-xs leading-relaxed"
        style={{ background: '#0c0c18', border: '1px solid #1a1a2e', color: '#334155' }}
      >
        答案会出现在屏幕左上角的浮动覆盖层中，屏幕共享时对对方不可见。
      </div>
    </div>
  )
}

// ── Voice Tab ─────────────────────────────────────────────────────────────────
function VoiceTab({ active, onGoSettings }: { active: boolean; onGoSettings: () => void }) {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  // Whether an ASR key is configured — drives a pre-flight hint so the user isn't surprised by a
  // failed transcription after recording a whole take. Default true to avoid a first-frame flash.
  const [asrConfigured, setAsrConfigured] = useState(true)
  // Persisted like deviceId — an English interviewer shouldn't have to re-pick the language each
  // launch (a stale '' or bad value falls back to zh-CN via the explicit whitelist check).
  const [lang, setLang] = useState<'zh-CN' | 'en-US'>(() => (localStorage.getItem('asrLang') === 'en-US' ? 'en-US' : 'zh-CN'))
  // Editable draft text — populated by live transcription, user can edit before sending
  const [draftText, setDraftText] = useState('')
  const [error, setError] = useState('')
  // Audio input device — pick BlackHole (virtual device) to capture system/meeting audio, or a mic
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem('asrDeviceId') || '')
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const listeningRef = useRef(false)
  const transcribingRef = useRef(false)  // true while a stopped take is still being transcribed
  const langRef = useRef(lang)
  const deviceIdRef = useRef(deviceId)
  const devicesRef = useRef(devices)
  useEffect(() => { langRef.current = lang; localStorage.setItem('asrLang', lang) }, [lang])

  // Re-check ASR config each time this tab becomes active, so the hint clears right after the user
  // configures a key in Settings (no app restart needed).
  useEffect(() => {
    if (active) window.electronAPI.getConfig().then((cfg) => setAsrConfigured(!!cfg.asrApiKey))
  }, [active])
  useEffect(() => { deviceIdRef.current = deviceId; localStorage.setItem('asrDeviceId', deviceId) }, [deviceId])
  useEffect(() => { devicesRef.current = devices }, [devices])

  // Enumerate audio input devices (labels only populate after a mic-permission grant)
  useEffect(() => {
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        setDevices(list.filter((d) => d.kind === 'audioinput'))
      } catch { /* ignore */ }
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  const grantAndRefresh = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'audioinput'))
      setError('')
    } catch (err) {
      setError(`无法获取麦克风权限：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const appendToDraft = (text: string) => {
    const t = text.trim()
    if (!t || t.length < 2) return
    if (isHallucinatedText(t)) return
    window.electronAPI.sendTranscript({ text: t, isFinal: true })  // mirror live transcript to overlay panel
    setDraftText((prev) => {
      const combined = prev ? prev + ' ' + t : t
      return combined.slice(-2000)  // cap at 2000 chars
    })
  }

  const startCapture = async (currentLang: string) => {
    setError('')
    try {
      // macOS has no system-audio loopback via getDisplayMedia (Windows-only). Capture the
      // selected input device instead: BlackHole = system/meeting audio, otherwise a mic.
      const id = deviceIdRef.current
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true })
      } catch (e) {
        // Selected device unavailable (e.g. Bluetooth headset just disconnected) → fall back to default
        const name = (e as { name?: string })?.name || ''
        if (id && (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError')) {
          setError('所选音频设备不可用（蓝牙耳机断开？），已临时改用默认输入设备')
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } else {
          throw e
        }
      }
      streamRef.current = stream
      // Labels only appear post-permission — refresh so the picker becomes readable.
      // Read via ref: this runs from a mount-time ⌘⌥X closure where `devices` would be stale [].
      if (devicesRef.current.some((d) => !d.label)) {
        navigator.mediaDevices.enumerateDevices()
          .then((l) => setDevices(l.filter((d) => d.kind === 'audioinput')))
          .catch(() => {})
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'

      // Manual bracketing: one continuous recording from ⌘⌥X-start to ⌘⌥X-stop, then
      // transcribed in a single pass on stop. The user delimits the utterance — no VAD.
      const chunks: Blob[] = []
      const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType })
      recorderRef.current = rec
      const startedAt = Date.now()
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType })
        const durMs = Date.now() - startedAt
        // Diagnostic: bytes-per-second far below ~1KB/s means we captured silence —
        // usually a hidden-window throttle or the input device not receiving system audio.
        console.log(`[ASR] 录音停止: ${durMs}ms, blob ${blob.size}B (${Math.round(blob.size / Math.max(durMs / 1000, 0.1))}B/s)`)
        if (blob.size < 2000) {  // nothing meaningful captured — tell the user instead of vanishing
          setError('录音太短，没有捕获到有效音频')
          setTranscribing(false); transcribingRef.current = false; return
        }
        let silent = false
        if (durMs > 1500 && blob.size / (durMs / 1000) < 800) {
          silent = true
          setError('录到的音频几乎是静音。请确认系统输出已路由到所选输入设备（如 BlackHole 多输出设备），并保持主窗口可见或已生效的后台采集。')
        }
        try {
          const buf = await blob.arrayBuffer()
          const text = await window.electronAPI.transcribeChunk(buf, mimeType, currentLang)
          if (text) { setError(''); appendToDraft(text) }
          else if (!silent) { setError('未识别到有效语音（可能是噪声、太短，或被降噪过滤）') }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('could not process file') && !msg.includes('valid media')) {
            setError(`转录失败: ${msg}`)
          }
        } finally {
          setTranscribing(false)
          transcribingRef.current = false
        }
      }

      stream.getTracks().forEach((t) => {
        t.onended = () => {
          if (listeningRef.current) {
            setError('音频设备已断开（蓝牙耳机？），录音已停止；重连后按 ⌘⌥X 重新开始。')
            stopCapture()
          }
        }
      })

      listeningRef.current = true
      setListening(true)
      window.electronAPI.startListening()
      rec.start()  // single continuous recording until stopCapture()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        `录音失败：${msg}。请在 系统设置 → 隐私与安全性 → 麦克风 给应用授权；要监听对方声音，请选择 BlackHole 设备（见上方说明）。`
      )
    }
  }

  const stopCapture = () => {
    listeningRef.current = false
    setListening(false)
    const rec = recorderRef.current
    recorderRef.current = null
    // Stopping triggers rec.onstop, which transcribes the whole take, then clears transcribing
    if (rec) { setTranscribing(true); transcribingRef.current = true; rec.stop() }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    window.electronAPI.stopListening()
  }

  // Toggle recording: ⌘⌥X pressed once = start, pressed again = stop.
  // listeningRef is the single source of truth — main process just sends a toggle nudge.
  // togglingRef guards the async start window so a fast double-press can't spawn two recorders.
  const togglingRef = useRef(false)
  useEffect(() => {
    const un = window.electronAPI.onAsrPttToggle(async () => {
      if (togglingRef.current) return
      togglingRef.current = true
      try {
        if (listeningRef.current) {
          stopCapture()
        } else {
          // Don't start a new take while the previous one is still transcribing — otherwise the
          // old onstop appends its result into the freshly-cleared new draft and desyncs the UI.
          if (transcribingRef.current) return
          setDraftText('')
          await startCapture(langRef.current)
        }
      } finally {
        togglingRef.current = false
      }
    })
    return un
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])



  const sendToAI = () => {
    const text = draftText.trim()
    if (!text) return
    window.electronAPI.autoAsk(text)
    setDraftText('')
  }

  // Heuristic: warn if the chosen input looks like a Bluetooth headset MIC. Selecting it forces
  // macOS into low-quality HFP mode (audible to the interviewer) — capture BlackHole instead.
  const selectedDevice = devices.find((d) => d.deviceId === deviceId)
  const looksLikeBtMic = /airpods|bluetooth|蓝牙|buds|beats|jabra|bose|sony w[fh]-|耳机/i.test(selectedDevice?.label || '')

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* ASR-not-configured pre-flight hint — clickable, jumps to Settings */}
      {!asrConfigured && (
        <div
          onClick={onGoSettings}
          className="rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.35)', color: '#fbbf24', cursor: 'pointer' }}
        >
          ⚠ 还没配置语音识别（ASR）Key，录音将无法转写。<strong>点此前往设置 → 语音识别</strong>。
        </div>
      )}

      {/* System-audio guidance */}
      <div className="rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#7dd3fc' }}>
        💡 想让 AI 听到<strong>对方的声音</strong>：装 BlackHole 虚拟声卡 → 在「音频 MIDI 设置」建一个含 BlackHole 的「多输出设备」并设为系统输出 → 下面选 BlackHole。仅选麦克风只会录到你自己。按 ⌘⌥X 开始/停止。
        <br />🎧 <strong>用蓝牙耳机</strong>：把耳机也加进上面的「多输出设备」（照常从耳机听），并设非蓝牙设备为主、给蓝牙开「漂移校正」。采集仍选 <strong>BlackHole</strong>，<strong>别选蓝牙耳机的麦克风</strong>。
      </div>

      {/* Audio input device picker */}
      <div className="flex gap-2 items-center">
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="flex-1 rounded px-2 py-1.5 text-xs outline-none"
          style={{ background: '#0f0f1a', border: '1px solid #1e1e3a', color: '#94a3b8' }}
        >
          <option value="">默认输入设备（麦克风）</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `输入设备 ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <button
          onClick={grantAndRefresh}
          className="px-2 py-1.5 text-xs rounded flex-shrink-0"
          style={{ background: '#1e1e2e', color: '#64748b', border: '1px solid #2d2d44', cursor: 'pointer' }}
        >
          授权/刷新
        </button>
      </div>

      {/* Bluetooth-mic warning: selecting a BT headset mic forces HFP mode */}
      {looksLikeBtMic && (
        <div className="rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.35)', color: '#fbbf24' }}>
          ⚠ 这看起来是蓝牙耳机的麦克风。选它会让系统切到 HFP 模式——音质骤降、对方可能察觉。捕获对方声音请改选 <strong>BlackHole</strong>；只想录你自己建议用<strong>内建麦克风</strong>。
        </div>
      )}

      {/* Language selector */}
      <div className="flex gap-2">
        {(['zh-CN', 'en-US'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className="px-3 py-1 text-xs rounded transition-colors"
            style={{
              background: lang === l ? '#1d4ed8' : '#1e1e2e',
              color: lang === l ? '#bfdbfe' : '#475569',
              border: `1px solid ${lang === l ? '#3b82f6' : '#2d2d44'}`,
              cursor: 'pointer'
            }}
          >
            {l === 'zh-CN' ? '中文' : 'English'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(120,20,20,0.4)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Listening indicator */}
      <div
        className="w-full py-3 rounded-lg text-sm font-semibold text-center transition-all"
        style={{
          background: listening ? 'rgba(220,38,38,0.15)' : 'rgba(59,130,246,0.08)',
          color: listening ? '#f87171' : '#475569',
          border: `1px solid ${listening ? 'rgba(220,38,38,0.4)' : '#1e1e2e'}`,
        }}
      >
        {transcribing ? '⏳ 转写中…' : listening ? '● 录音中... 按 ⌘⌥X 停止' : '按 ⌘⌥X 开始录音'}
      </div>

      {/* Editable draft area */}
      <div className="flex flex-col flex-1 gap-2" style={{ minHeight: 0 }}>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: '#334155' }}>
            {listening ? '录音中…(停止后转写)' : draftText ? '转写完成 — 可编辑后发送' : '转写结果'}
          </span>
          <div className="flex gap-2">
            {draftText && (
              <button
                onClick={() => setDraftText('')}
                className="px-2 py-0.5 text-xs rounded"
                style={{ background: '#1e1e2e', color: '#475569', border: '1px solid #2d2d44', cursor: 'pointer' }}
              >
                清空
              </button>
            )}
          </div>
        </div>
        <textarea
          ref={draftRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          readOnly={listening}
          placeholder={transcribing ? '转写中…' : listening ? '录音中…停止后转写结果将出现在这里' : '按 ⌘⌥X 录音，转写结果将出现在这里...'}
          className="flex-1 rounded-lg p-3 text-xs leading-relaxed resize-none outline-none"
          style={{
            background: '#0a0a12',
            border: `1px solid ${listening ? 'rgba(220,38,38,0.3)' : '#1a1a2e'}`,
            color: '#e2e8f0',
            minHeight: 80,
          }}
        />
      </div>

      {/* Send button */}
      <button
        onClick={sendToAI}
        disabled={!draftText.trim()}
        className="w-full py-3 rounded-lg text-sm font-semibold transition-all"
        style={{
          background: draftText.trim() ? 'rgba(124,58,237,0.2)' : 'rgba(30,30,46,0.6)',
          color: draftText.trim() ? '#a78bfa' : '#334155',
          border: `1px solid ${draftText.trim() ? 'rgba(124,58,237,0.4)' : '#1e1e2e'}`,
          cursor: draftText.trim() ? 'pointer' : 'default',
        }}
      >
        发送到 AI
      </button>
    </div>
  )
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
function SettingsTab({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [visionModel, setVisionModel] = useState('deepseek-chat')
  const [asrApiKey, setAsrApiKey] = useState('')
  const [asrBaseUrl, setAsrBaseUrl] = useState('https://api.openai.com/v1')
  const [asrModel, setAsrModel] = useState('whisper-1')
  const [overlayOpacity, setOverlayOpacity] = useState(0.94)
  const [screenshotMode, setScreenshotMode] = useState<'direct' | 'ocr'>('direct')
  const [screenshotPrompt, setScreenshotPrompt] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [llmTest, setLlmTest] = useState<{ st: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }>({ st: 'idle', msg: '' })
  const [visionTest, setVisionTest] = useState<{ st: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }>({ st: 'idle', msg: '' })
  const [asrTest, setAsrTest] = useState<{ st: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }>({ st: 'idle', msg: '' })

  const testLlm = async () => {
    setLlmTest({ st: 'testing', msg: '' })
    try {
      const r = await window.electronAPI.testLLM({ apiKey, baseUrl, model })
      setLlmTest({ st: r.ok ? 'ok' : 'fail', msg: r.message })
    } catch (e) {
      setLlmTest({ st: 'fail', msg: e instanceof Error ? e.message : String(e) })
    }
  }
  const testVision = async () => {
    setVisionTest({ st: 'testing', msg: '' })
    try {
      const r = await window.electronAPI.testVision({ apiKey, baseUrl, visionModel })
      setVisionTest({ st: r.ok ? 'ok' : 'fail', msg: r.message })
    } catch (e) {
      setVisionTest({ st: 'fail', msg: e instanceof Error ? e.message : String(e) })
    }
  }
  const testAsr = async () => {
    setAsrTest({ st: 'testing', msg: '' })
    try {
      const r = await window.electronAPI.testASR({ apiKey: asrApiKey, baseUrl: asrBaseUrl, model: asrModel })
      setAsrTest({ st: r.ok ? 'ok' : 'fail', msg: r.message })
    } catch (e) {
      setAsrTest({ st: 'fail', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      if (cfg.apiKey) setApiKey(cfg.apiKey)
      if (cfg.baseUrl) setBaseUrl(cfg.baseUrl)
      if (cfg.model) setModel(cfg.model)
      if (cfg.visionModel) setVisionModel(cfg.visionModel)
      if (cfg.asrApiKey) setAsrApiKey(cfg.asrApiKey)
      if (cfg.asrBaseUrl) setAsrBaseUrl(cfg.asrBaseUrl)
      if (cfg.asrModel) setAsrModel(cfg.asrModel)
      if (cfg.overlayOpacity !== undefined) setOverlayOpacity(cfg.overlayOpacity)
      if (cfg.screenshotMode) setScreenshotMode(cfg.screenshotMode)
      if (cfg.screenshotPrompt !== undefined) setScreenshotPrompt(cfg.screenshotPrompt)
    })
  }, [])

  const save = () => {
    // Light validation so an obviously-broken config doesn't get a false '✓ 已保存'. Non-empty key
    // + well-formed URLs only — never gate on a live test (that would break editing offline).
    if (!apiKey.trim()) { setSaveErr('请填写 API Key'); return }
    try { new URL(baseUrl) } catch { setSaveErr('Base URL 需形如 https://api.example.com'); return }
    if (asrApiKey.trim()) { try { new URL(asrBaseUrl) } catch { setSaveErr('ASR Base URL 需形如 https://api.example.com'); return } }
    setSaveErr('')
    window.electronAPI.setConfig({ apiKey, baseUrl, model, visionModel, asrApiKey, asrBaseUrl, asrModel, overlayOpacity, screenshotMode, screenshotPrompt })
    setSaved(true)
    onSaved?.()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      {/* Overlay appearance */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>
        悬浮窗外观
      </div>
      <div>
        <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
          背景透明度
        </label>
        <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
          调节覆盖层背景透明度（{Math.round(overlayOpacity * 100)}%）
        </div>
        <input
          type="range"
          min={0.3}
          max={0.99}
          step={0.01}
          value={overlayOpacity}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setOverlayOpacity(v)
            window.electronAPI.setConfig({ overlayOpacity: v })
          }}
          className="w-full"
          style={{ accentColor: '#3b82f6' }}
        />
      </div>

      {/* Screenshot mode */}
      <div>
        <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
          截图解题模式（⌘⌥S）
        </label>
        <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
          {screenshotMode === 'direct'
            ? '直接解答：视觉模型一次调用直接流式给出答案，最快'
            : '先识别：先 OCR 出可编辑文字，确认/纠错后再发给 AI'}
        </div>
        <div className="flex gap-2">
          {([['direct', '直接解答（快）'], ['ocr', '先识别可编辑']] as ['direct' | 'ocr', string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setScreenshotMode(m); window.electronAPI.setConfig({ screenshotMode: m }) }}
              className="px-3 py-1 text-xs rounded transition-colors"
              style={{
                background: screenshotMode === m ? '#1d4ed8' : '#1e1e2e',
                color: screenshotMode === m ? '#bfdbfe' : '#475569',
                border: `1px solid ${screenshotMode === m ? '#3b82f6' : '#2d2d44'}`,
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom prompt for direct-solve mode — sent with the image to the vision model */}
        {screenshotMode === 'direct' && (
          <div className="mt-2">
            <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
              截图解答 Prompt（随图片发给视觉模型）
            </label>
            <div className="text-xs mb-1.5" style={{ color: '#334155' }}>
              留空则用默认指令。可自定义解题风格。
            </div>
            <textarea
              value={screenshotPrompt}
              onChange={(e) => setScreenshotPrompt(e.target.value)}
              onBlur={(e) => { e.target.style.borderColor = '#1e1e3a'; window.electronAPI.setConfig({ screenshotPrompt }) }}
              placeholder="例如：分析并解答图片中的题目，先给出思路，再给出实现，优先 LeetCode 风格"
              rows={3}
              spellCheck={false}
              className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none transition-colors"
              style={{ background: '#0f0f1a', border: '1px solid #1e1e3a', color: '#e2e8f0', lineHeight: '1.6', fontFamily: 'inherit' }}
              onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
            />
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* LLM section */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>
        AI 问答（LLM）
      </div>
      <Field
        label="API Key"
        hint="DeepSeek / OpenAI 兼容服务的密钥"
        type="password"
        value={apiKey}
        onChange={setApiKey}
        placeholder="sk-..."
      />
      <Field
        label="Base URL"
        hint="API 地址，默认 DeepSeek"
        value={baseUrl}
        onChange={setBaseUrl}
        placeholder="https://api.deepseek.com"
      />
      <Field
        label="问答模型"
        hint="语音/文字问答使用的模型"
        value={model}
        onChange={setModel}
        placeholder="deepseek-chat"
      />
      <Field
        label="视觉模型（截图解题）"
        hint="支持图像输入的模型，用于 ⌘⌥S 截图模式"
        value={visionModel}
        onChange={setVisionModel}
        placeholder="gpt-4o / deepseek-vl2"
      />

      {/* LLM preset shortcuts */}
      <div>
        <div className="text-xs mb-2" style={{ color: '#475569' }}>LLM 快速切换</div>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'DeepSeek Chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', visionModel: 'deepseek-chat' },
            { label: 'DeepSeek Coder', baseUrl: 'https://api.deepseek.com', model: 'deepseek-coder', visionModel: 'deepseek-chat' },
            { label: 'Qwen Plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus' },
            { label: 'GPT-4o', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', visionModel: 'gpt-4o' },
            { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', visionModel: 'Qwen/Qwen2-VL-7B-Instruct' }
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => { setBaseUrl(p.baseUrl); setModel(p.model); setVisionModel(p.visionModel) }}
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{ background: '#1e1e2e', color: '#64748b', border: '1px solid #2d2d44', cursor: 'pointer' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TestRow label="测试问答模型" onTest={testLlm} state={llmTest} />
      <TestRow label="测试视觉模型" onTest={testVision} state={visionTest} />

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* ASR section */}
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#7c3aed' }}>
        语音识别（系统音频 ASR）
      </div>
      <Field
        label="ASR API Key"
        hint="Whisper 兼容服务密钥。推荐 Groq（免费额度大）"
        type="password"
        value={asrApiKey}
        onChange={setAsrApiKey}
        placeholder="gsk_... 或 sk-..."
      />
      <Field
        label="ASR Base URL"
        hint="Whisper API 地址"
        value={asrBaseUrl}
        onChange={setAsrBaseUrl}
        placeholder="https://api.groq.com/openai/v1"
      />
      <Field
        label="ASR 模型"
        hint="Whisper 模型名称"
        value={asrModel}
        onChange={setAsrModel}
        placeholder="whisper-large-v3"
      />

      {/* ASR preset shortcuts */}
      <div>
        <div className="text-xs mb-2" style={{ color: '#475569' }}>ASR 快速切换</div>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Groq (免费)', asrBaseUrl: 'https://api.groq.com/openai/v1', asrModel: 'whisper-large-v3' },
            { label: 'OpenAI Whisper', asrBaseUrl: 'https://api.openai.com/v1', asrModel: 'whisper-1' },
            { label: '硅基流动', asrBaseUrl: 'https://api.siliconflow.cn/v1', asrModel: 'FunAudioLLM/SenseVoiceSmall' },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => { setAsrBaseUrl(p.asrBaseUrl); setAsrModel(p.asrModel) }}
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{ background: '#1e1e2e', color: '#64748b', border: '1px solid #2d2d44', cursor: 'pointer' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TestRow label="测试 ASR 连接" onTest={testAsr} state={asrTest} />

      <button
        onClick={save}
        className="px-4 py-2 text-sm rounded-lg font-medium mt-2 transition-colors"
        style={{ background: saved ? '#16a34a' : '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}
      >
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
      {saveErr && (
        <div className="text-xs" style={{ color: '#f87171' }}>✗ {saveErr}</div>
      )}
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────
function TestRow({
  label,
  onTest,
  state
}: {
  label: string
  onTest: () => void
  state: { st: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }
}) {
  const color = state.st === 'ok' ? '#4ade80' : state.st === 'fail' ? '#f87171' : '#94a3b8'
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={onTest}
        disabled={state.st === 'testing'}
        className="px-3 py-1.5 text-xs rounded transition-colors flex-shrink-0"
        style={{
          background: '#13213a',
          color: '#7dd3fc',
          border: '1px solid #1e3a5f',
          cursor: state.st === 'testing' ? 'default' : 'pointer',
          opacity: state.st === 'testing' ? 0.6 : 1
        }}
      >
        {state.st === 'testing' ? '测试中…' : label}
      </button>
      {(state.st === 'ok' || state.st === 'fail') && state.msg && (
        <span className="text-xs" style={{ color }}>
          {state.st === 'ok' ? '✓ ' : '✗ '}
          {state.msg}
        </span>
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text'
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-0.5" style={{ color: '#94a3b8' }}>
        {label}
      </label>
      <div className="text-xs mb-1.5" style={{ color: '#334155' }}>{hint}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-xs outline-none transition-colors"
        style={{
          background: '#0f0f1a',
          border: '1px solid #1e1e3a',
          color: '#e2e8f0',
          fontFamily: type === 'text' ? 'inherit' : 'monospace'
        }}
        onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
        onBlur={(e) => (e.target.style.borderColor = '#1e1e3a')}
      />
    </div>
  )
}
