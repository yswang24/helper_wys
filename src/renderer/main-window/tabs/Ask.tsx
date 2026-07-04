import { useState, useEffect, useRef } from 'react'

export function AskTab() {
  const [question, setQuestion] = useState('')
  const [jd, setJd] = useState('')
  const [isSending, setIsSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Backfill the persisted JD once on mount. jdLoadedRef gates the sync effect below: without it,
  // the initial '' state would be pushed to the main process (and disk) before the load resolves,
  // wiping the saved JD on every launch. Ref-gating (not skip-first-run) is StrictMode-safe — the
  // double-invoked mount effect still sees the ref false until getConfig actually resolves.
  const jdLoadedRef = useRef(false)
  useEffect(() => {
    window.electronAPI.getConfig().then((cfg) => {
      // Functional update: if the user already typed before the load resolved, keep their text.
      if (cfg.jobDescription) setJd((cur) => cur || cfg.jobDescription)
      jdLoadedRef.current = true
    })
  }, [])

  // Sync JD to main process whenever it changes (post-load only — see jdLoadedRef above)
  useEffect(() => {
    if (!jdLoadedRef.current) return
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
