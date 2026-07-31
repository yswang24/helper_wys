import { useState, useEffect, useRef } from 'react'
import { isHallucinatedText } from '../../../shared/hallucination'
import { prepareRecordedAudioForAsr } from './audioEncoding'

// Filter a raw transcript: drop empties, <2 chars, and Whisper hallucinations. Returns the cleaned
// text, or null if it should be discarded.
function cleanTranscript(text: string): string | null {
  const t = text.trim()
  if (!t || t.length < 2) return null
  if (isHallucinatedText(t)) return null
  return t
}

// The Fn+Control recording state machine, moved verbatim as ONE block from VoiceTab. Deliberately NOT
// split further: the five refs + two watchdog timers + toggle guard are a single coordinated
// machine — pulling any apart re-introduces the "first take works, then Fn+Control does nothing" bug.
// Refs stay refs (stale-closure discipline); the only view-owned piece is the draft textarea ref.
export function useAsrCapture(active: boolean) {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [asrConfigured, setAsrConfigured] = useState(true)
  const [lang, setLang] = useState<'zh-CN' | 'en-US'>(() =>
    localStorage.getItem('asrLang') === 'en-US' ? 'en-US' : 'zh-CN'
  )
  const [draftText, setDraftText] = useState('')
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem('asrDeviceId') || '')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const listeningRef = useRef(false)
  const transcribingRef = useRef(false) // true while a stopped take is still being transcribed
  // Safety net for transcribingRef: armed in stopCapture, cleared the instant onstop fires.
  const transcribeGuardRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const langRef = useRef(lang)
  const deviceIdRef = useRef(deviceId)
  const devicesRef = useRef(devices)
  useEffect(() => {
    langRef.current = lang
    localStorage.setItem('asrLang', lang)
  }, [lang])

  // Re-check ASR config each time this tab becomes active, so the hint clears right after the user
  // configures a key in Settings (no app restart needed).
  useEffect(() => {
    if (active) window.electronAPI.getConfig().then((cfg) => setAsrConfigured(!!cfg.asrApiKey))
  }, [active])
  useEffect(() => {
    deviceIdRef.current = deviceId
    localStorage.setItem('asrDeviceId', deviceId)
  }, [deviceId])
  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  // Enumerate audio input devices (labels only populate after a mic-permission grant)
  useEffect(() => {
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        setDevices(list.filter((d) => d.kind === 'audioinput'))
      } catch {
        /* ignore */
      }
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

  const startCapture = async (currentLang: string) => {
    setError('')
    try {
      // macOS has no system-audio loopback via getDisplayMedia (Windows-only). Capture the selected
      // input device instead: BlackHole = system/meeting audio, otherwise a mic.
      const id = deviceIdRef.current
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: id ? { deviceId: { exact: id } } : true
        })
      } catch (e) {
        // Selected device unavailable (e.g. Bluetooth headset just disconnected) → fall back to default
        const name = (e as { name?: string })?.name || ''
        if (
          id &&
          (name === 'OverconstrainedError' ||
            name === 'NotFoundError' ||
            name === 'NotReadableError')
        ) {
          setError('所选音频设备不可用（蓝牙耳机断开？），已临时改用默认输入设备')
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } else {
          throw e
        }
      }
      streamRef.current = stream
      // Labels only appear post-permission — refresh via ref (this runs from a mount-time Fn+Control closure
      // where `devices` would be stale []).
      if (devicesRef.current.some((d) => !d.label)) {
        navigator.mediaDevices
          .enumerateDevices()
          .then((l) => setDevices(l.filter((d) => d.kind === 'audioinput')))
          .catch(() => {})
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      // Manual bracketing: one continuous recording from Fn+Control-start to Fn+Control-stop, transcribed in a
      // single pass on stop. The user delimits the utterance — no VAD.
      const chunks: Blob[] = []
      const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType })
      recorderRef.current = rec
      const startedAt = Date.now()
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      rec.onstop = async () => {
        // onstop fired → the stranding safety net (armed in stopCapture) is no longer needed.
        if (transcribeGuardRef.current) {
          clearTimeout(transcribeGuardRef.current)
          transcribeGuardRef.current = undefined
        }
        const blob = new Blob(chunks, { type: mimeType })
        const durMs = Date.now() - startedAt
        console.log(
          `[ASR] 录音停止: ${durMs}ms, blob ${blob.size}B (${Math.round(blob.size / Math.max(durMs / 1000, 0.1))}B/s)`
        )
        if (blob.size < 2000) {
          // nothing meaningful captured — tell the user instead of vanishing
          setError('录音太短，没有捕获到有效音频')
          setTranscribing(false)
          transcribingRef.current = false
          return
        }
        let silent = false
        if (durMs > 1500 && blob.size / (durMs / 1000) < 800) {
          silent = true
          setError(
            '录到的音频几乎是静音。请确认系统输出已路由到所选输入设备（如 BlackHole 多输出设备），并保持主窗口可见或已生效的后台采集。'
          )
        }
        try {
          const preparedAudio = await prepareRecordedAudioForAsr(blob)
          // Backstop watchdog: guarantees the promise settles so the finally clears transcribing even
          // if the IPC round-trip hangs — otherwise Fn+Control stays locked on "转写中…" until an app restart.
          let watchdog: ReturnType<typeof setTimeout> | undefined
          const text = await Promise.race([
            window.electronAPI.transcribeChunk(
              preparedAudio.buffer,
              preparedAudio.mimeType,
              currentLang
            ),
            new Promise<string>((_, reject) => {
              watchdog = setTimeout(
                () => reject(new Error('转写超时（40 秒无响应），请重试')),
                40000
              )
            })
          ]).finally(() => {
            if (watchdog) clearTimeout(watchdog)
          })
          if (text) {
            setError('')
            const cleaned = cleanTranscript(text)
            if (cleaned) {
              window.electronAPI.sendTranscript({ text: cleaned, isFinal: true }) // mirror to overlay
              if ((await window.electronAPI.getOverlayMode()) === 'passthrough') {
                // Passthrough: the overlay is click-through, so send straight to the AI — and DON'T
                // touch the draft. Each take is an independent question; no accumulation.
                window.electronAPI.autoAsk(cleaned)
              } else {
                // Interactive: accumulate in the draft (cap 2000 chars) for review + manual "发送到 AI".
                setDraftText((prev) => (prev ? prev + ' ' + cleaned : cleaned).slice(-2000))
              }
            }
          } else if (!silent) {
            setError('未识别到有效语音（可能是噪声、太短，或被降噪过滤）')
          }
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
            setError('音频设备已断开（蓝牙耳机？），录音已停止；重连后按 fn⌃ 重新开始。')
            stopCapture()
          }
        }
      })

      listeningRef.current = true
      setListening(true)
      window.electronAPI.startListening()
      rec.start() // single continuous recording until stopCapture()
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
      setTranscribing(true)
      transcribingRef.current = true
      // Safety net: if onstop NEVER fires, transcribingRef would stay true forever and the Fn+Control start
      // branch would silently refuse every new take until restart — the "第一次成功、之后没反应" bug.
      // Force-reset after a short grace. (Slow transcription is bounded separately by the 40s watchdog.)
      if (transcribeGuardRef.current) clearTimeout(transcribeGuardRef.current)
      transcribeGuardRef.current = setTimeout(() => {
        transcribeGuardRef.current = undefined
        if (transcribingRef.current) {
          console.warn('[ASR] onstop 未在预期内触发，强制复位转写状态（本次录音可能未正常结束）')
          transcribingRef.current = false
          setTranscribing(false)
          setError('转写状态异常，已自动复位，请重新按 fn⌃ 录音')
        }
      }, 8000)
      rec.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    window.electronAPI.stopListening()
  }

  // Toggle recording: Fn+Control once = start, again = stop. listeningRef is the single source of truth;
  // togglingRef guards the async start window so a fast double-press can't spawn two recorders.
  const togglingRef = useRef(false)
  useEffect(() => {
    const un = window.electronAPI.onAsrPttToggle(async () => {
      if (togglingRef.current) {
        console.warn('[ASR] 忽略 Fn+Control：上一次开始/停止切换尚未完成')
        return
      }
      togglingRef.current = true
      try {
        if (listeningRef.current) {
          stopCapture()
        } else {
          // Don't start a new take while the previous one is still transcribing (the old onstop would
          // append into the freshly-cleared draft). But NEVER fail silently — tell the user.
          if (transcribingRef.current) {
            console.warn('[ASR] 忽略开始录音：上一段仍在转写中（transcribingRef=true）')
            setError('上一段还在转写中，请等结果出来再按 fn⌃ 录音')
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

  // Heuristic: warn if the chosen input looks like a Bluetooth headset MIC (selecting it forces
  // macOS into low-quality HFP mode, audible to the interviewer).
  const selectedDevice = devices.find((d) => d.deviceId === deviceId)
  const looksLikeBtMic = /airpods|bluetooth|蓝牙|buds|beats|jabra|bose|sony w[fh]-|耳机/i.test(
    selectedDevice?.label || ''
  )

  return {
    listening,
    transcribing,
    asrConfigured,
    lang,
    setLang,
    draftText,
    setDraftText,
    error,
    devices,
    deviceId,
    setDeviceId,
    grantAndRefresh,
    sendToAI,
    looksLikeBtMic
  }
}
