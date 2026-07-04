import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import { parseSegments, renderMarkdownBlock } from '../../shared/markdown'
import { useStreamingAnswer, type HistoryItem, type LLMStatus } from './hooks/useStreamingAnswer'

export function App() {
  const panelRef = useRef<HTMLDivElement>(null)
  const answerEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Whether the answer view is parked at the bottom. Drives whether streaming output keeps
  // yanking the viewport down — see the auto-scroll effect and onAnswerScroll below.
  const stickToBottomRef = useRef(true)

  // Recompute "am I at the bottom" on every user/programmatic scroll (40px slack). Once the user
  // scrolls up to re-read earlier content, this goes false and auto-follow pauses; scrolling back
  // to the bottom re-arms it.
  const onAnswerScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  // LLM history + streaming state machine (chunk buffering, RAF flush, id reconciliation).
  const { history } = useStreamingAnswer(stickToBottomRef)

  // ASR state — overlay only displays, main window does the actual capture
  const [listening, setListening] = useState(false)
  const [finalLines, setFinalLines] = useState<string[]>([])

  // Appearance
  const [bgOpacity, setBgOpacity] = useState(0.94)

  // Overlay interaction mode (driven by main via applyOverlayMode / ⌘⌥E / tray):
  // 'passthrough' = 点击穿透 + 不可聚焦(不激活本 app、不切屏,默认);
  // 'interactive' = 可点击 + 可打字(进入时会激活本 app 一次——一次有意的切屏)。
  const [overlayMode, setOverlayMode] = useState<'passthrough' | 'interactive'>('passthrough')

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
    // getPublicConfig (not getConfig): the overlay only needs appearance, so plaintext API keys
    // never enter this renderer's memory.
    window.electronAPI.getPublicConfig().then((cfg) => {
      if (cfg.overlayOpacity !== undefined) setBgOpacity(cfg.overlayOpacity)
    })
    const un = window.electronAPI.onOverlayOpacity((opacity) => setBgOpacity(opacity))
    return un
  }, [])

  // ── Interaction mode: reflect the main-process mode in the header badge ──────
  useEffect(() => window.electronAPI.onOverlayMode(setOverlayMode), [])

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
    // Only follow the stream while parked at the bottom — if the user scrolled up mid-generation
    // to re-read a point, don't drag them back down on every token (a new answer re-pins via
    // onAnswerStart). This is the difference between "回看可用" and "回看被打断".
    if (stickToBottomRef.current) answerEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [lastAnswer])

  // Mouse pass-through & activation are driven by the main process per mode (index.ts
  // applyOverlayMode): 'passthrough' = whole-window click-through + non-focusable (no 切屏);
  // 'interactive' = focusable + clickable. Toggle via the header badge / ⌘⌥E / tray.

  const allTranscript = finalLines.join(' ')

  return (
    // Interactivity is a whole-window mode (see overlayMode): in 'passthrough' the window is
    // click-through and non-activating; in 'interactive' it captures clicks and can take keyboard.
    <div className="h-screen w-screen overflow-hidden">
      <div
        ref={panelRef}
        className="flex flex-col rounded-xl overflow-hidden shadow-2xl h-full w-full"
        style={{
          background: `rgba(10, 10, 16, ${bgOpacity})`,
          border: '1px solid rgba(70, 70, 110, 0.6)',
          // 毛玻璃恢复:切换闪动的真凶是 blur()=[orderOut:](已删),不是这层滤镜。若日后某处再让本 app
          // 真正失活并观察到重绘闪,再考虑去掉它。
          backdropFilter: 'blur(16px)'
        }}
      >
        {/* Drag handle — manual window drag via IPC (index.ts overlay:drag-*). Replaces
            -webkit-app-region:drag, unreliable on transparent+frameless+panel windows after
            setIgnoreMouseEvents toggling. Only fires in interactive mode (in passthrough the
            window is click-through, so no mousedown lands here). */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 cursor-move"
          onMouseDown={(e) => {
            if (e.button !== 0) return
            // 点在按钮/输入框上不拖(那是交互);只从头部空白处发起窗口拖动
            if ((e.target as HTMLElement).closest('button, input, textarea')) return
            window.electronAPI.startOverlayDrag(e.screenX, e.screenY)
            const onMove = (ev: MouseEvent) => window.electronAPI.moveOverlayDrag(ev.screenX, ev.screenY)
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
              window.electronAPI.endOverlayDrag()
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
          style={{
            background: `rgba(20, 20, 35, ${Math.min(bgOpacity + 0.06, 0.98)})`,
            borderColor: 'rgba(70, 70, 110, 0.5)',
            userSelect: 'none',
            WebkitUserSelect: 'none'
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
            {/* Mode badge — 纯指示当前模式,不可点。切换只走 ⌘⌥E / 托盘:点击切换会激活本 app、
                毛玻璃背景重绘导致"跳一下"。pointerEvents:none 保证它永远不参与鼠标命中。 */}
            <div
              title="当前模式指示(穿透 / 输入)。切换用 ⌘⌥E 或托盘菜单。"
              className="text-xs px-2 py-0.5 rounded select-none"
              style={{
                background: overlayMode === 'interactive' ? 'rgba(16,185,129,0.2)' : 'rgba(30,30,60,0.5)',
                color: overlayMode === 'interactive' ? '#34d399' : '#64748b',
                border: `1px solid ${overlayMode === 'interactive' ? 'rgba(52,211,153,0.4)' : 'rgba(50,50,80,0.4)'}`,
                pointerEvents: 'none'
              } as React.CSSProperties}
            >
              {overlayMode === 'interactive' ? '✏️ 输入' : '🔒 穿透'}
            </div>
            <button
              onClick={() => { setShowInput((v) => !v); setTimeout(() => inputRef.current?.focus(), 50) }}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{
                background: showInput ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: showInput ? '#7dd3fc' : '#94a3b8',
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
                  color: '#94a3b8',
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
              <span className="text-xs" style={{ color: '#64748b' }}>
                {listening ? '录音中…(停止后转写)' : '最近转录'}
              </span>
              {allTranscript && (
                <div className="flex gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                  <button
                    onClick={() => setFinalLines([])}
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(30,30,60,0.6)', color: '#94a3b8', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
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
        <div ref={scrollRef} onScroll={onAnswerScroll} className="flex-1 overflow-y-auto px-3 py-3" style={{ minHeight: 80 }}>
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
                style={{ background: 'rgba(30,30,60,0.6)', color: '#94a3b8', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
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
  // Retry/copy only make sense for a real text question. Screenshot-direct items store a label
  // ('📷 截图解题'), and standalone error items store '' — re-asking those would send nonsense.
  const canRetry = !!item.question && item.question !== '📷 截图解题'
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
          <div>⚠ {item.errorMsg}</div>
          {canRetry && (
            <div className="flex gap-2 mt-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <button
                onClick={() => window.electronAPI.askQuestion(item.question)}
                className="px-2 py-0.5 rounded"
                style={{ background: 'rgba(248,113,113,0.15)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.4)', cursor: 'pointer' }}
              >
                重试
              </button>
              <button
                onClick={() => window.electronAPI.copyText(item.question)}
                className="px-2 py-0.5 rounded"
                style={{ background: 'rgba(30,30,60,0.6)', color: '#94a3b8', border: '1px solid rgba(50,50,80,0.4)', cursor: 'pointer' }}
              >
                复制问题
              </button>
            </div>
          )}
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
// One text block, memo'd by content. During streaming only the LAST (growing) segment changes,
// so every already-closed segment skips re-running the markdown→HTML build — turning the live
// row's per-frame cost from O(whole answer) into O(last segment).
const MarkdownBlock = memo(function MarkdownBlock({ content }: { content: string }) {
  return (
    <div
      className="space-y-1"
      style={{ color: '#cbd5e1', wordBreak: 'break-word' }}
      dangerouslySetInnerHTML={{ __html: renderMarkdownBlock(content) }}
    />
  )
})

const AnswerText = memo(function AnswerText({ text, streaming }: { text: string; streaming: boolean }) {
  const segments = useMemo(() => parseSegments(text, streaming), [text, streaming])
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
        return <MarkdownBlock key={i} content={seg.content} />
      })}
    </div>
  )
})

