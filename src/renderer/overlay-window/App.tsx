import { useEffect, useRef, useState, useCallback } from 'react'

type LLMStatus = 'idle' | 'streaming' | 'done' | 'error'

export function App() {
  const panelRef = useRef<HTMLDivElement>(null)
  const answerEndRef = useRef<HTMLDivElement>(null)

  // LLM state
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [llmStatus, setLlmStatus] = useState<LLMStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // ASR state — overlay only displays, main window does the actual capture
  const [listening, setListening] = useState(false)
  const [finalLines, setFinalLines] = useState<string[]>([])

  // Manual input
  const [showInput, setShowInput] = useState(false)
  const [inputText, setInputText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const submitManual = useCallback(() => {
    const q = inputText.trim()
    if (!q) return
    window.electronAPI.askQuestion(q)
    setInputText('')
    setShowInput(false)
  }, [inputText])

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
  useEffect(() => {
    const unStart = window.electronAPI.onAnswerStart((q) => {
      setQuestion(q)
      setAnswer('')
      setErrorMsg('')
      setLlmStatus('streaming')
    })
    const unChunk = window.electronAPI.onAnswerChunk((chunk) => {
      setAnswer((prev) => prev + chunk)
    })
    const unDone = window.electronAPI.onAnswerDone(() => setLlmStatus('done'))
    const unError = window.electronAPI.onAnswerError((msg) => {
      setErrorMsg(msg)
      setLlmStatus('error')
    })
    const unClear = window.electronAPI.onAnswerClear(() => {
      setQuestion('')
      setAnswer('')
      setErrorMsg('')
      setLlmStatus('idle')
    })
    return () => { unStart(); unChunk(); unDone(); unError(); unClear() }
  }, [])

  // Auto-scroll
  useEffect(() => {
    answerEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [answer])

  // Mouse pass-through is now handled by main process cursor polling (index.ts)

  const allTranscript = finalLines.join(' ')

  return (
    <div className="h-screen w-screen overflow-hidden p-3 select-none">
      <div
        ref={panelRef}
        className="flex flex-col rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: 'rgba(10, 10, 16, 0.94)',
          border: '1px solid rgba(70, 70, 110, 0.6)',
          backdropFilter: 'blur(16px)',
          maxWidth: 490,
          maxHeight: 'calc(100vh - 24px)'
        }}
      >
        {/* Drag handle */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 cursor-move"
          style={{
            background: 'rgba(20, 20, 35, 0.9)',
            borderColor: 'rgba(70, 70, 110, 0.5)',
            WebkitAppRegion: 'drag'
          } as React.CSSProperties}
        >
          <StatusDot llm={llmStatus} listening={listening} />
          <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>
            Interview Assistant
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
            <span className="text-xs" style={{ color: '#1e293b' }}>H·X·L·S</span>
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

        {/* Question label */}
        {question && (
          <div
            className="px-3 py-2 border-b flex-shrink-0"
            style={{ borderColor: 'rgba(50, 50, 80, 0.4)', background: 'rgba(15, 15, 28, 0.5)' }}
          >
            <div className="text-xs" style={{ color: '#475569' }}>问题</div>
            <div className="text-xs mt-0.5 leading-relaxed" style={{ color: '#64748b' }}>
              {question}
            </div>
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
          {llmStatus === 'idle' && !answer && (
            <div className="text-xs italic" style={{ color: '#1e293b' }}>
              {listening ? '检测到完整问题后自动回答...' : '等待提问...'}
            </div>
          )}
          {llmStatus === 'error' && (
            <div
              className="text-xs rounded-lg p-2"
              style={{ background: 'rgba(120, 20, 20, 0.4)', color: '#f87171' }}
            >
              ⚠ {errorMsg}
            </div>
          )}
          {answer && <AnswerText text={answer} streaming={llmStatus === 'streaming'} />}
          <div ref={answerEndRef} />
        </div>

        {/* Status / action bar */}
        {(llmStatus === 'streaming' || (llmStatus === 'done' && answer)) && (
          <div
            className="px-3 py-1.5 text-xs flex items-center gap-2 border-t flex-shrink-0"
            style={{ borderColor: 'rgba(50, 50, 80, 0.4)' }}
          >
            {llmStatus === 'streaming' && (
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
            {llmStatus === 'done' && answer && (
              <CopyButton text={answer} />
            )}
          </div>
        )}
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
  const copy = () => {
    window.electronAPI.copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
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
            style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: renderInline(seg.content) }}
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
    const open = streaming ? rem.match(/```(\w*)\n?([\s\S]*)$/) : null
    if (open) {
      if (open.index! > 0) segs.push({ type: 'text', content: rem.slice(0, open.index) })
      segs.push({ type: 'code', lang: open[1] || undefined, content: open[2] })
    } else {
      segs.push({ type: 'text', content: rem })
    }
  }
  return segs
}

function renderInline(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e2e8f0">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(30,30,60,0.6);padding:1px 4px;border-radius:3px;color:#7dd3fc;font-size:0.85em">$1</code>')
}
