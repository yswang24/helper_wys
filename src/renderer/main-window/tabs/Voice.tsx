import { useState, useEffect, useRef } from 'react'
import { isHallucinatedText } from '../../../shared/hallucination'

export function VoiceTab({ active, onGoSettings }: { active: boolean; onGoSettings: () => void }) {
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
  // Safety net for transcribingRef: armed in stopCapture, cleared the instant onstop fires. If
  // onstop never fires, this force-resets so the voice feature can't be stranded (see stopCapture).
  const transcribeGuardRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
        // onstop fired → the stranding safety net (armed in stopCapture) is no longer needed.
        if (transcribeGuardRef.current) { clearTimeout(transcribeGuardRef.current); transcribeGuardRef.current = undefined }
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
          // Backstop watchdog: the main process already bounds the request to ~30s, but if the IPC
          // round-trip itself ever hangs, this guarantees the promise settles so the finally below
          // clears transcribing/transcribingRef — otherwise ⌘⌥X stays locked (start branch bails on
          // transcribingRef) with the UI stuck on "转写中…" until an app restart.
          let watchdog: ReturnType<typeof setTimeout> | undefined
          const text = await Promise.race([
            window.electronAPI.transcribeChunk(buf, mimeType, currentLang),
            new Promise<string>((_, reject) => {
              watchdog = setTimeout(() => reject(new Error('转写超时（40 秒无响应），请重试')), 40000)
            })
          ]).finally(() => { if (watchdog) clearTimeout(watchdog) })
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
    if (rec) {
      setTranscribing(true); transcribingRef.current = true
      // Safety net: onstop should fire almost immediately after stop(). If it NEVER fires (recorder
      // already inactive / an edge state), transcribingRef would stay true forever and the ⌘⌥X start
      // branch would then silently refuse every new take until an app restart — exactly the "第一次
      // 成功、之后完全没反应" failure. Force-reset after a short grace so it can't get stranded. (Slow
      // transcription is bounded separately by the 40s watchdog inside onstop, after this is cleared.)
      if (transcribeGuardRef.current) clearTimeout(transcribeGuardRef.current)
      transcribeGuardRef.current = setTimeout(() => {
        transcribeGuardRef.current = undefined
        if (transcribingRef.current) {
          console.warn('[ASR] onstop 未在预期内触发，强制复位转写状态（本次录音可能未正常结束）')
          transcribingRef.current = false; setTranscribing(false)
          setError('转写状态异常，已自动复位，请重新按 ⌘⌥X 录音')
        }
      }, 8000)
      rec.stop()
    }
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
      if (togglingRef.current) { console.warn('[ASR] 忽略 ⌘⌥X：上一次开始/停止切换尚未完成'); return }
      togglingRef.current = true
      try {
        if (listeningRef.current) {
          stopCapture()
        } else {
          // Don't start a new take while the previous one is still transcribing — otherwise the
          // old onstop appends its result into the freshly-cleared new draft and desyncs the UI.
          // But NEVER fail silently: a stuck transcribingRef used to make ⌘⌥X do nothing with zero
          // feedback (the reported "第一次成功、之后完全没反应"). Tell the user instead.
          if (transcribingRef.current) {
            console.warn('[ASR] 忽略开始录音：上一段仍在转写中（transcribingRef=true）')
            setError('上一段还在转写中，请等结果出来再按 ⌘⌥X 录音')
            return
          }
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
