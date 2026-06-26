import { useEffect, useRef, useState, useCallback, memo } from 'react'

type LLMStatus = 'idle' | 'streaming' | 'done' | 'error'

interface HistoryItem {
  id: number
  question: string
  answer: string
  status: LLMStatus
  errorMsg: string
}

export function App() {
  const panelRef = useRef<HTMLDivElement>(null)
  const answerEndRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(1)

  // LLM history
  const [history, setHistory] = useState<HistoryItem[]>([])

  // ASR state — overlay only displays, main window does the actual capture
  const [listening, setListening] = useState(false)
  const [finalLines, setFinalLines] = useState<string[]>([])

  // Appearance
  const [bgOpacity, setBgOpacity] = useState(0.94)

  // Manual input
  const [showInput, setShowInput] = useState(false)
  const [inputText, setInputText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Image text extraction
  const [extractedText, setExtractedText] = useState('')
  const [showExtracted, setShowExtracted] = useState(false)
  const [extractStatus, setExtractStatus] = useState<'idle' | 'extracting' | 'done' | 'error'>('idle')
  const [extractError, setExtractError] = useState('')
  const extractedRef = useRef<HTMLTextAreaElement>(null)

  const submitManual = useCallback(() => {
    const q = inputText.trim()
    if (!q) return
    window.electronAPI.askQuestion(q)
    setInputText('')
    setShowInput(false)
  }, [inputText])

  const submitExtracted = useCallback(() => {
    const t = extractedText.trim()
    if (!t) return
    window.electronAPI.askExtractedText(t)
    setShowExtracted(false)
    setExtractedText('')
  }, [extractedText])

  // ── Appearance: opacity ─────────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      if (cfg.overlayOpacity !== undefined) setBgOpacity(cfg.overlayOpacity)
    })
    const un = window.electronAPI.onOverlayOpacity((opacity) => setBgOpacity(opacity))
    return un
  }, [])

  // ── Focus management: only allow focus on input elements ──
  useEffect(() => {
    let inputClicked = false

    // Detect click on input BEFORE focus fires
    const onMouseDown = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        inputClicked = true
      }
    }

    // Block any focus that wasn't from a direct input click
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      // Always allow our own input/extracted textareas — they're focused programmatically
      // (e.g. the 输入 button's setTimeout focus), which has no preceding input mousedown.
      if (target === inputRef.current || target === extractedRef.current) {
        inputClicked = false
        return
      }
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (!inputClicked) target.blur()
      } else {
        target?.blur?.()
      }
      inputClicked = false
    }

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  // ── Receive transcripts from main window (via main process) ─────────────────
  useEffect(() => {
    const un = window.electronAPI.onTranscript(({ text, isFinal }) => {
      if (isFinal && text.trim().length > 1) {
        setFinalLines((prev) => [...prev, text].slice(-6))
      }
    })
    return un
  }, [])

  // ── Listening indicator controlled by main window ───────────────────────────
  useEffect(() => {
    const unStart = window.electronAPI.onAsrStart(() => setListening(true))
    const unStop = window.electronAPI.onAsrStop(() => setListening(false))
    return () => { unStart(); unStop() }
  }, [])

  // ── LLM events ──────────────────────────────────────────────────────────────
  // Every event carries the main-process stream id, so chunks/done/error attach to the RIGHT
  // bubble even when streams overlap — instead of blindly mutating the last item.
  useEffect(() => {
    // Chunks arrive token-by-token. Buffering them and flushing once per animation frame turns
    // N setState+markdown-reparse per token into one per frame — the streaming-render win. The
    // updater stays pure (appends to prev from a const snapshot) so it's StrictMode-safe.
    const chunkBuf = new Map<number, string>()
    let flushScheduled = false
    const flush = () => {
      flushScheduled = false
      if (chunkBuf.size === 0) return
      const deltas = Array.from(chunkBuf.entries())
      chunkBuf.clear()
      setHistory((prev) => prev.map((it) => {
        const d = deltas.find(([id]) => id === it.id)
        return d ? { ...it, answer: it.answer + d[1] } : it
      }))
    }
    const scheduleFlush = () => {
      if (flushScheduled) return
      flushScheduled = true
      requestAnimationFrame(flush)
    }

    const unStart = window.electronAPI.onAnswerStart(({ id, question }) => {
      setHistory((prev) => [...prev, { id, question, answer: '', status: 'streaming', errorMsg: '' }])
    })
    const unChunk = window.electronAPI.onAnswerChunk(({ id, chunk }) => {
      chunkBuf.set(id, (chunkBuf.get(id) ?? '') + chunk)
      scheduleFlush()
    })
    const unDone = window.electronAPI.onAnswerDone(({ id }) => {
      flush()  // apply any buffered trailing text before marking done
      setHistory((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'done' as LLMStatus } : it)))
    })
    const unError = window.electronAPI.onAnswerError(({ id, message }) => {
      flush()  // preserve any buffered partial answer before switching the bubble to error
      setHistory((prev) => {
        if (id != null && prev.some((it) => it.id === id)) {
          return prev.map((it) => (it.id === id ? { ...it, status: 'error' as LLMStatus, errorMsg: message } : it))
        }
        // No matching stream (e.g. empty-key error before any start, or an independent ⌘⌥O
        // screenshot failure). Surface a standalone error item instead of dropping it. Negative
        // id can't collide with main-process stream ids.
        const synthId = -(nextIdRef.current++)
        const errItem = { id: synthId, question: '', answer: '', status: 'error' as LLMStatus, errorMsg: message }
        // If a stream is still live as the last item, keep IT last so the status bar / 停止 button
        // / auto-scroll stay bound to the live answer — insert the error just before it.
        const lastIdx = prev.length - 1
        if (lastIdx >= 0 && prev[lastIdx].status === 'streaming') {
          return [...prev.slice(0, lastIdx), errItem, prev[lastIdx]]
        }
        return [...prev, errItem]
      })
    })
    const unClear = window.electronAPI.onAnswerClear(() => {
      chunkBuf.clear()
      flushScheduled = false
      setHistory([])
    })
    return () => { unStart(); unChunk(); unDone(); unError(); unClear() }
  }, [])

  // ── Image text extraction ───────────────────────────────────────────────────
  useEffect(() => {
    const unStatus = window.electronAPI.onImageStatus((status) => {
      if (status === 'extracting') {
        setExtractedText('')
        setShowExtracted(false)
        setExtractStatus('extracting')
      }
    })
    const unText = window.electronAPI.onImageText((text) => {
      setExtractedText(text)
      setShowExtracted(true)
      setExtractStatus('done')
    })
    const unError = window.electronAPI.onImageError((msg) => {
      setExtractStatus('error')
      setExtractError(msg)
    })
    return () => { unStatus(); unText(); unError() }
  }, [])

  // Auto-scroll to latest answer. Instant ('auto'), not 'smooth': during streaming this fires
  // once per frame, and smooth animations would stack and fight each other into visible jank.
  const lastAnswer = history.length > 0 ? history[history.length - 1].answer : ''
  useEffect(() => {
    answerEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [lastAnswer])

  // Mouse pass-through is now handled by main process cursor polling (index.ts)

  const allTranscript = finalLines.join(' ')

  return (
    // Interactivity is driven by the main process toggling setIgnoreMouseEvents from the cursor
    // position (index.ts heartbeat), so the whole window is either click-through or not — a CSS
    // none/auto split here would only imply per-pixel precision the bounds poll doesn't have.
    <div className="h-screen w-screen overflow-hidden">
      <div
        ref={panelRef}
        className="flex flex-col rounded-xl overflow-hidden shadow-2xl h-full w-full"
        style={{
          background: `rgba(10, 10, 16, ${bgOpacity})`,
          border: '1px solid rgba(70, 70, 110, 0.6)',
          backdropFilter: 'blur(16px)'
        }}
      >
        {/* Drag handle */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 cursor-move"
          style={{
            background: `rgba(20, 20, 35, ${Math.min(bgOpacity + 0.06, 0.98)})`,
            borderColor: 'rgba(70, 70, 110, 0.5)',
            WebkitAppRegion: 'drag'
          } as React.CSSProperties}
        >
          <StatusDot llm={history.length > 0 ? history[history.length - 1].status : 'idle'} listening={listening} />
          <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>
            Helper
          </span>
          {listening && (
            <span className="text-xs animate-pulse" style={{ color: '#a78bfa' }}>
              ● 监听中
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => { setShowInput((v) => !v); setTimeout(() => inputRef.current?.focus(), 50) }}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{
                background: showInput ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: showInput ? '#7dd3fc' : '#334155',
                border: `1px solid ${showInput ? 'rgba(59,130,246,0.4)' : 'transparent'}`,
                cursor: 'pointer',
                WebkitAppRegion: 'no-drag'
              } as React.CSSProperties}
            >
              ✎ 输入
            </button>
            {history.length > 0 && (
              <button
                onClick={() => window.electronAPI.clearAnswer()}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{
                  background: 'transparent',
                  color: '#334155',
                  border: '1px solid transparent',
                  cursor: 'pointer',
                  WebkitAppRegion: 'no-drag'
                } as React.CSSProperties}
              >
                清空
              </button>
            )}
          </div>
        </div>

        {/* Transcript panel */}
        {(listening || allTranscript) && (
          <div
            className="px-3 py-2 border-b flex-shrink-0"
            style={{
              borderColor: 'rgba(50, 50, 80, 0.4)',
              background: 'rgba(12, 12, 22, 0.7)',
              maxHeight: 110,
              overflowY: 'auto'
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: '#334155' }}>
                {listening ? '转录中 (每3秒)' : '最近转录'}
              </span>
              {allTranscript && (
                <div className="flex gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                  <button
                    onClick={() => setFinalLines([])}
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(30,30,60,0.6)', color: '#334155', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
                  >
                    清空
                  </button>
                  <button
                    onClick={() => window.electronAPI.autoAsk(allTranscript)}
                    className="text-xs px-2 py-0.5 rounded font-medium"
                    style={{ background: 'rgba(124,58,237,0.25)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.5)', cursor: 'pointer' }}
                  >
                    发送到AI
                  </button>
                </div>
              )}
            </div>
            {allTranscript ? (
              <div className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
                {allTranscript}
              </div>
            ) : (
              <div className="text-xs italic" style={{ color: '#1e293b' }}>等待音频...</div>
            )}
          </div>
        )}

        {/* Manual input */}
        {showInput && (
          <div
            className="px-3 py-2 border-b flex-shrink-0"
            style={{ borderColor: 'rgba(59,130,246,0.3)', background: 'rgba(10,20,40,0.8)' }}
          >
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitManual() }
                if (e.key === 'Escape') { setShowInput(false); setInputText('') }
              }}
              placeholder="输入问题... (Ctrl+Enter 发送，Esc 关闭)"
              rows={2}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full text-xs rounded px-2 py-1.5 resize-none outline-none"
              style={{
                background: 'rgba(20,30,60,0.6)',
                border: '1px solid rgba(59,130,246,0.3)',
                color: '#e2e8f0',
                fontFamily: 'inherit'
              }}
            />
            <div className="flex justify-end gap-2 mt-1.5">
              <button
                onClick={() => { setShowInput(false); setInputText('') }}
                className="px-2 py-0.5 text-xs rounded"
                style={{ background: 'rgba(30,30,60,0.5)', color: '#475569', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={submitManual}
                disabled={!inputText.trim()}
                className="px-3 py-0.5 text-xs rounded font-medium"
                style={{
                  background: inputText.trim() ? '#3b82f6' : 'rgba(30,30,60,0.5)',
                  color: inputText.trim() ? '#fff' : '#334155',
                  border: 'none',
                  cursor: inputText.trim() ? 'pointer' : 'default'
                }}
              >
                发送
              </button>
            </div>
          </div>
        )}

        {/* Answer area */}
        <div className="flex-1 overflow-y-auto px-3 py-3" style={{ minHeight: 80 }}>
          {history.length === 0 && (
            <div className="text-xs italic" style={{ color: '#1e293b' }}>
              {listening ? '检测到完整问题后自动回答...' : '等待提问...'}
            </div>
          )}
          {history.map((item, idx) => (
            <HistoryItemView key={item.id} item={item} showDivider={idx < history.length - 1} />
          ))}
          <div ref={answerEndRef} />
        </div>

        {/* Image extraction: loading / error / editor */}
        {extractStatus === 'extracting' && (
          <div
            className="px-3 py-3 border-t flex-shrink-0 flex items-center gap-2"
            style={{ borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(10,25,20,0.8)' }}
          >
            <span className="animate-pulse text-xs" style={{ color: '#34d399' }}>●</span>
            <span className="text-xs" style={{ color: '#34d399' }}>正在识别图片文字...</span>
          </div>
        )}
        {extractStatus === 'error' && (
          <div
            className="px-3 py-2 border-t flex-shrink-0"
            style={{ borderColor: 'rgba(220,38,38,0.3)', background: 'rgba(30,10,10,0.8)' }}
          >
            <div className="text-xs mb-1" style={{ color: '#f87171' }}>
              ⚠ {extractError}
            </div>
            <button
              onClick={() => { setExtractStatus('idle'); setExtractError('') }}
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: 'rgba(30,30,60,0.5)', color: '#475569', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
            >
              关闭
            </button>
          </div>
        )}
        {showExtracted && extractStatus === 'done' && (
          <div
            className="px-3 py-2 border-t flex-shrink-0"
            style={{ borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(10,25,20,0.8)' }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium" style={{ color: '#34d399' }}>
                图片识别结果（可编辑）
              </span>
              <button
                onClick={() => { setShowExtracted(false); setExtractedText(''); setExtractStatus('idle') }}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(30,30,60,0.6)', color: '#334155', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
              >
                关闭
              </button>
            </div>
            <textarea
              ref={extractedRef}
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitExtracted() }
              }}
              rows={10}
              spellCheck={false}
              className="w-full text-xs rounded px-2 py-1.5 resize-y outline-none"
              style={{
                background: 'rgba(15,25,20,0.8)',
                border: '1px solid rgba(52,211,153,0.3)',
                color: '#e2e8f0',
                fontFamily: 'inherit',
                lineHeight: '1.6',
                minHeight: 80,
                maxHeight: '46vh'
              }}
            />
            <div className="flex justify-end gap-2 mt-1.5">
              <button
                onClick={() => { setShowExtracted(false); setExtractedText(''); setExtractStatus('idle') }}
                className="px-2 py-0.5 text-xs rounded"
                style={{ background: 'rgba(30,30,60,0.5)', color: '#475569', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={submitExtracted}
                disabled={!extractedText.trim()}
                className="px-3 py-0.5 text-xs rounded font-medium"
                style={{
                  background: extractedText.trim() ? 'rgba(16,185,129,0.3)' : 'rgba(30,30,60,0.5)',
                  color: extractedText.trim() ? '#34d399' : '#334155',
                  border: `1px solid ${extractedText.trim() ? 'rgba(52,211,153,0.4)' : 'rgba(50,50,80,0.4)'}`,
                  cursor: extractedText.trim() ? 'pointer' : 'default'
                }}
              >
                发送到AI (Ctrl+Enter)
              </button>
            </div>
          </div>
        )}

        {/* Status / action bar */}
        {history.length > 0 && (() => {
          const last = history[history.length - 1]
          if (last.status !== 'streaming' && !(last.status === 'done' && last.answer)) return null
          return (
            <div
              className="px-3 py-1.5 text-xs flex items-center gap-2 border-t flex-shrink-0"
              style={{ borderColor: 'rgba(50, 50, 80, 0.4)' }}
            >
              {last.status === 'streaming' && (
                <>
                  <span className="animate-pulse" style={{ color: '#4ade80' }}>●</span>
                  <span style={{ color: '#4ade80' }}>正在生成...</span>
                  <button
                    onClick={() => window.electronAPI.stopAnswer()}
                    className="ml-auto px-2 py-0.5 rounded text-xs"
                    style={{ background: 'rgba(220,38,38,0.15)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)', cursor: 'pointer' }}
                  >
                    停止
                  </button>
                </>
              )}
              {last.status === 'done' && last.answer && (
                <CopyButton text={last.answer} />
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── Status indicator ──────────────────────────────────────────────────────────
function StatusDot({ llm, listening }: { llm: LLMStatus; listening: boolean }) {
  let color = '#1e293b'
  if (listening) color = '#4ade80'
  if (llm === 'streaming') color = '#22d3ee'
  if (llm === 'error') color = '#f87171'

  return (
    <div
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: color, boxShadow: listening || llm === 'streaming' ? `0 0 6px ${color}` : 'none' }}
    />
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  // Clear the reset timer on unmount — copying then asking again within 1.8s unmounts this
  // button (it's bound to the last 'done' item), so the timer would otherwise leak / fire late.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const copy = () => {
    window.electronAPI.copyText(text)
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      onClick={copy}
      className="ml-auto px-2 py-0.5 rounded text-xs transition-colors"
      style={{
        background: copied ? 'rgba(22,163,74,0.15)' : 'rgba(30,30,60,0.5)',
        color: copied ? '#4ade80' : '#475569',
        border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : 'rgba(50,50,80,0.4)'}`,
        cursor: 'pointer'
      }}
    >
      {copied ? '✓ 已复制' : '复制'}
    </button>
  )
}

// ── One question/answer row ─────────────────────────────────────────────────────
// memo'd so that while the LATEST answer streams (its `item` ref changes every frame), the
// already-finished rows above it keep the same `item` reference and skip re-rendering — no
// re-parsing their markdown on every chunk flush. Only the live row re-renders per frame.
const HistoryItemView = memo(function HistoryItemView({ item, showDivider }: { item: HistoryItem; showDivider: boolean }) {
  return (
    <div className="mb-4">
      {/* Question (omitted for standalone error items that have no question) */}
      {item.question && (
        <div
          className="px-3 py-2 border-b flex-shrink-0 mb-2"
          style={{ borderColor: 'rgba(50, 50, 80, 0.4)', background: 'rgba(15, 15, 28, 0.5)' }}
        >
          <div className="text-xs" style={{ color: '#475569' }}>问题</div>
          <div className="text-xs mt-0.5 leading-relaxed" style={{ color: '#64748b' }}>
            {item.question}
          </div>
        </div>
      )}

      {/* Answer */}
      {item.status === 'error' && (
        <div
          className="text-xs rounded-lg p-2"
          style={{ background: 'rgba(120, 20, 20, 0.4)', color: '#f87171' }}
        >
          ⚠ {item.errorMsg}
        </div>
      )}
      {item.answer && <AnswerText text={item.answer} streaming={item.status === 'streaming'} />}

      {showDivider && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'rgba(50, 50, 80, 0.3)' }} />
      )}
    </div>
  )
})

// ── Answer renderer ───────────────────────────────────────────────────────────
function AnswerText({ text, streaming }: { text: string; streaming: boolean }) {
  const segments = parseSegments(text, streaming)
  return (
    <div className="text-sm leading-relaxed space-y-2">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return (
            <pre
              key={i}
              className="rounded-lg p-3 overflow-x-auto text-xs"
              style={{
                background: 'rgba(20, 20, 40, 0.8)',
                border: '1px solid rgba(60, 60, 100, 0.5)',
                color: '#7dd3fc',
                fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
                whiteSpace: 'pre'
              }}
            >
              {seg.lang && (
                <div className="text-xs mb-2" style={{ color: '#475569' }}>{seg.lang}</div>
              )}
              {seg.content}
            </pre>
          )
        }
        return (
          <div
            key={i}
            className="space-y-1"
            style={{ color: '#cbd5e1', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: renderMarkdownBlock(seg.content) }}
          />
        )
      })}
    </div>
  )
}

interface Segment { type: 'text' | 'code'; content: string; lang?: string }

function parseSegments(text: string, streaming: boolean): Segment[] {
  const segs: Segment[] = []
  const re = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: 'text', content: text.slice(last, m.index) })
    segs.push({ type: 'code', lang: m[1] || undefined, content: m[2] })
    last = m.index + m[0].length
  }
  const rem = text.slice(last)
  if (rem) {
    // Only treat a trailing ``` as an OPEN code fence if it starts a line — otherwise a stray
    // inline ``` in prose ("use the ``` operator") would flip everything after it into a code
    // block mid-stream. The leading newline (if matched) stays with the preceding text.
    const open = streaming ? rem.match(/(?:^|\n)```(\w*)\n?([\s\S]*)$/) : null
    if (open) {
      const fenceStart = open.index! + (rem[open.index!] === '\n' ? 1 : 0)
      if (fenceStart > 0) segs.push({ type: 'text', content: rem.slice(0, fenceStart) })
      segs.push({ type: 'code', lang: open[1] || undefined, content: open[2] })
    } else {
      segs.push({ type: 'text', content: rem })
    }
  }
  return segs
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Inline formatting on an ALREADY-ESCAPED string: bold, inline code, links (rendered
// as non-navigating styled text so they can't hijack the overlay window).
function renderInline(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#e2e8f0">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(30,30,60,0.6);padding:1px 4px;border-radius:3px;color:#7dd3fc;font-size:0.85em">$1</code>')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '<span style="color:#7dd3fc;text-decoration:underline">$1</span>')
}

// Block-level markdown → HTML for a text segment (code fences handled separately by
// parseSegments). Escapes first, then recognizes headings / lists / blockquotes per line.
function renderMarkdownBlock(text: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) { out.push('<div style="height:2px"></div>'); continue }

    const heading = t.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      const size = heading[1].length === 1 ? '1.05em' : heading[1].length === 2 ? '1em' : '0.95em'
      out.push(`<div style="font-weight:700;color:#e2e8f0;font-size:${size}">${renderInline(escapeHtml(heading[2]))}</div>`)
      continue
    }

    const ordered = t.match(/^(\d+)\.\s+(.*)$/)
    if (ordered) {
      out.push(`<div style="display:flex;gap:6px"><span style="color:#7dd3fc;flex-shrink:0">${ordered[1]}.</span><span>${renderInline(escapeHtml(ordered[2]))}</span></div>`)
      continue
    }

    const bullet = t.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      out.push(`<div style="display:flex;gap:6px"><span style="color:#7dd3fc;flex-shrink:0">•</span><span>${renderInline(escapeHtml(bullet[1]))}</span></div>`)
      continue
    }

    const quote = t.match(/^>\s?(.*)$/)
    if (quote) {
      out.push(`<div style="border-left:2px solid rgba(125,211,252,0.4);padding-left:8px;color:#94a3b8">${renderInline(escapeHtml(quote[1]))}</div>`)
      continue
    }

    out.push(`<div>${renderInline(escapeHtml(line))}</div>`)
  }
  return out.join('')
}
