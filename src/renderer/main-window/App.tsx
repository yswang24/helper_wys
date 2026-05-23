import { useEffect, useRef, useState } from 'react'

interface AppStatus {
  contentProtection: boolean
  overlayVisible: boolean
  platform: string
  version: string
}

type Tab = 'ask' | 'voice' | 'settings'

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [tab, setTab] = useState<Tab>('ask')
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    window.electronAPI.getStatus().then(setStatus)
    const t = setInterval(() => window.electronAPI.getStatus().then(setStatus), 2000)
    return () => clearInterval(t)
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
          IA
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">Interview Assistant</div>
          <div className="text-xs" style={{ color: '#475569' }}>v{status?.version ?? '...'}</div>
        </div>
        <div className="flex gap-1.5">
          <Pill ok={status?.contentProtection ?? false} label="隐身" />
          <Pill ok={status?.overlayVisible ?? false} label="覆盖层" />
        </div>
      </div>

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

      {/* Content — all tabs stay mounted so their listeners (e.g. onAsrToggle) remain active */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 overflow-y-auto" style={{ display: tab === 'ask' ? 'block' : 'none' }}><AskTab /></div>
        <div className="absolute inset-0 overflow-hidden flex flex-col" style={{ display: tab === 'voice' ? 'flex' : 'none' }}><VoiceTab /></div>
        <div className="absolute inset-0 overflow-y-auto" style={{ display: tab === 'settings' ? 'block' : 'none' }}><SettingsTab onSaved={() => setNeedsSetup(false)} /></div>
      </div>

      {/* Shortcuts footer */}
      <div
        className="px-4 py-2 text-xs border-t flex gap-3 flex-wrap"
        style={{ borderColor: '#1e1e2e', color: '#334155' }}
      >
        <span><kbd className="font-mono">Ctrl+Shift+H</kbd> 覆盖层</span>
        <span><kbd className="font-mono">Ctrl+Shift+M</kbd> 此窗口</span>
        <span><kbd className="font-mono">Ctrl+Shift+L</kbd> 监听</span>
        <span><kbd className="font-mono">Ctrl+Shift+X</kbd> 清空</span>
        <span><kbd className="font-mono">Ctrl+Shift+S</kbd> 截图</span>
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

  // Sync JD to main process whenever it changes
  useEffect(() => {
    const t = setTimeout(() => {
      window.electronAPI.setConfig({ jobDescription: jd })
    }, 500)
    return () => clearTimeout(t)
  }, [jd])

  const submit = () => {
    const q = question.trim()
    if (!q || isSending) return
    setIsSending(true)
    window.electronAPI.askQuestion(q)
    setQuestion('')
    // Reset sending state after a short delay (streaming start triggers it)
    setTimeout(() => setIsSending(false), 1500)
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

const QUESTION_RE = /[？?。！!]$|[\s\S]{15,}$/

// Whisper hallucinates these when audio is silent/noisy (streaming platform watermarks,
// common video endings, etc. from training data)
const HALLUCINATION_RE = /点赞|订阅|转发|打赏|谢谢大家|明镜|优优独播|YoYo Television|独播剧场|爱奇艺|腾讯视频|优酷|bilibili|哔哩哔哩|字幕组|制作字幕|版权所有|请勿盗版|Thank you for watching|thanks for watching|please subscribe|don't forget to like|请关注|扫码|二维码|本视频|本期视频/i

// ── Voice Tab ─────────────────────────────────────────────────────────────────
function VoiceTab() {
  const [listening, setListening] = useState(false)
  const [lang, setLang] = useState<'zh-CN' | 'en-US'>('zh-CN')
  // macOS 系统音频回环(loopback)捕获不稳定，默认使用麦克风
  const [audioSource, setAudioSource] = useState<'mic' | 'system'>(
    window.electronAPI.platform === 'darwin' ? 'mic' : 'system'
  )
  const [transcriptLines, setTranscriptLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const listeningRef = useRef(false)
  const langRef = useRef(lang)
  useEffect(() => { langRef.current = lang }, [lang])

  // Keyboard shortcut Ctrl+Shift+L toggles from overlay side
  useEffect(() => {
    const un = window.electronAPI.onAsrToggle(() => {
      if (listeningRef.current) stopCapture()
      else startCapture(langRef.current, audioSource)
    })
    return un
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSource])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [transcriptLines])

  const pushLine = (text: string) => {
    const t = text.trim()
    if (!t || t.length < 2) return
    if (HALLUCINATION_RE.test(t)) return
    setTranscriptLines((prev) => {
      // Skip if identical to any of the last 3 lines (catches alternating hallucinations)
      if (prev.slice(-3).includes(t)) return prev
      return [...prev, t].slice(-40)
    })
    window.electronAPI.sendTranscript({ text: t, isFinal: true })
    if (QUESTION_RE.test(t)) {
      window.electronAPI.autoAsk(t)
    }
  }

  const startCapture = async (currentLang: string, src: 'mic' | 'system') => {
    setError('')
    try {
      let stream: MediaStream
      if (src === 'system') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: { width: 1, height: 1, frameRate: 1 }
        })
        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach((t) => t.stop())
          throw new Error('未获取到音频轨道，系统可能不支持 loopback 捕获')
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      }

      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'

      // Timesliced recording (start(N)) only puts WebM headers in the first chunk —
      // subsequent chunks are raw data that Whisper rejects. Instead, restart the
      // recorder every 3s so each recording is a complete, valid file.
      const onChunk = async (data: Blob) => {
        if (data.size < 5000) return
        try {
          const buf = await data.arrayBuffer()
          const text = await window.electronAPI.transcribeChunk(buf, mimeType, currentLang)
          if (text) { setError(''); pushLine(text) }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('could not process file') && !msg.includes('valid media')) {
            setError(`转录失败: ${msg}`)
          }
        }
      }

      const startCycle = () => {
        if (!listeningRef.current || !streamRef.current) return
        const audioStream = new MediaStream(streamRef.current.getAudioTracks())
        const rec = new MediaRecorder(audioStream, { mimeType })
        recorderRef.current = rec
        rec.ondataavailable = (e) => { if (e.data.size > 0) onChunk(e.data) }
        rec.onstop = () => { if (listeningRef.current) startCycle() }
        rec.start()
        setTimeout(() => { if (rec.state === 'recording') rec.stop() }, 3000)
      }

      stream.getTracks().forEach((t) => {
        t.onended = () => { if (listeningRef.current) stopCapture() }
      })

      listeningRef.current = true
      setListening(true)
      window.electronAPI.startListening()
      startCycle()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (src === 'system' && window.electronAPI.platform === 'darwin') {
        setError(
          `macOS 系统音频捕获失败：${msg}。建议切换到「麦克风」模式，或前往 系统设置 → 隐私与安全性 → 屏幕录制，给 Terminal 授权后重启应用。`
        )
      } else {
        setError(src === 'system' ? `系统音频失败: ${msg}` : `麦克风失败: ${msg}`)
      }
    }
  }

  const stopCapture = () => {
    listeningRef.current = false  // must be first — prevents onstop from restarting cycle
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    listeningRef.current = false
    setListening(false)
    window.electronAPI.stopListening()
  }

  const toggle = () => {
    if (listening) stopCapture()
    else startCapture(langRef.current, audioSource)
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Audio source selector */}
      <div>
        <div className="text-xs mb-1.5" style={{ color: '#475569' }}>音频来源</div>
        <div className="flex gap-2">
          {([['system', '系统音频'], ['mic', '麦克风']] as const).map(([src, label]) => (
            <button
              key={src}
              onClick={() => setAudioSource(src)}
              className="flex-1 px-3 py-1.5 text-xs rounded transition-colors font-medium"
              style={{
                background: audioSource === src
                  ? (src === 'system' ? 'rgba(124,58,237,0.2)' : 'rgba(15,118,110,0.2)')
                  : '#1e1e2e',
                color: audioSource === src ? (src === 'system' ? '#a78bfa' : '#34d399') : '#475569',
                border: `1px solid ${audioSource === src ? (src === 'system' ? '#7c3aed' : '#0f766e') : '#2d2d44'}`,
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-xs mt-1.5" style={{ color: '#334155' }}>
          {audioSource === 'system'
            ? '捕获所有系统声音（会议软件、B站等）— 需要 ASR API Key'
            : '捕获麦克风输入 — 需要 ASR API Key'}
        </div>
      </div>

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

      {/* Listen button */}
      <button
        onClick={toggle}
        className="w-full py-3 rounded-lg text-sm font-semibold transition-all"
        style={{
          background: listening ? 'rgba(220,38,38,0.15)' : 'rgba(59,130,246,0.15)',
          color: listening ? '#f87171' : '#7dd3fc',
          border: `1px solid ${listening ? 'rgba(220,38,38,0.4)' : 'rgba(59,130,246,0.4)'}`,
          cursor: 'pointer'
        }}
      >
        {listening ? '● 停止监听' : '开始语音监听'}
      </button>

      {/* Transcript area header with send button */}
      {transcriptLines.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: '#334155' }}>转录内容</span>
          <div className="flex gap-2">
            <button
              onClick={() => setTranscriptLines([])}
              className="px-2 py-0.5 text-xs rounded"
              style={{ background: '#1e1e2e', color: '#475569', border: '1px solid #2d2d44', cursor: 'pointer' }}
            >
              清空
            </button>
            <button
              onClick={() => {
                const text = transcriptLines.slice(-4).join(' ').trim()
                if (text) window.electronAPI.autoAsk(text)
              }}
              className="px-2 py-0.5 text-xs rounded font-medium"
              style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', cursor: 'pointer' }}
            >
              发送到AI
            </button>
          </div>
        </div>
      )}

      {/* Transcript scroll area */}
      <div
        ref={transcriptRef}
        className="flex-1 rounded-lg p-3 overflow-y-auto text-xs leading-relaxed"
        style={{ background: '#0a0a12', border: '1px solid #1a1a2e', color: '#64748b', minHeight: 0 }}
      >
        {transcriptLines.length === 0 ? (
          <span className="italic" style={{ color: '#1e293b' }}>转录内容将在这里实时显示...</span>
        ) : (
          transcriptLines.map((line, i) => <div key={i} className="mb-1">{line}</div>)
        )}
      </div>
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
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      if (cfg.apiKey) setApiKey(cfg.apiKey)
      if (cfg.baseUrl) setBaseUrl(cfg.baseUrl)
      if (cfg.model) setModel(cfg.model)
      if (cfg.visionModel) setVisionModel(cfg.visionModel)
      if (cfg.asrApiKey) setAsrApiKey(cfg.asrApiKey)
      if (cfg.asrBaseUrl) setAsrBaseUrl(cfg.asrBaseUrl)
      if (cfg.asrModel) setAsrModel(cfg.asrModel)
    })
  }, [])

  const save = () => {
    window.electronAPI.setConfig({ apiKey, baseUrl, model, visionModel, asrApiKey, asrBaseUrl, asrModel })
    setSaved(true)
    onSaved?.()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
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
        hint="支持图像输入的模型，用于 Ctrl+Shift+S 截图模式"
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
            { label: 'GPT-4o', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', visionModel: 'gpt-4o' }
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

      <button
        onClick={save}
        className="px-4 py-2 text-sm rounded-lg font-medium mt-2 transition-colors"
        style={{ background: saved ? '#16a34a' : '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}
      >
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────
function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{
        background: ok ? 'rgba(22, 163, 74, 0.2)' : 'rgba(30, 30, 50, 0.6)',
        color: ok ? '#4ade80' : '#334155',
        border: `1px solid ${ok ? 'rgba(74, 222, 128, 0.3)' : 'rgba(50, 50, 80, 0.5)'}`
      }}
    >
      {label}
    </span>
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
