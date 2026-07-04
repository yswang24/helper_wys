import { useEffect, useRef, useState, type MutableRefObject } from 'react'

export type LLMStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface HistoryItem {
  id: number
  question: string
  answer: string
  status: LLMStatus
  errorMsg: string
}

// Owns the streaming answer history + the token-buffering/RAF-flush machine + id reconciliation.
// stickToBottomRef is passed IN (not returned as a signal) so a new answer re-pins the scroll
// SYNCHRONOUSLY inside onAnswerStart — exactly as the former inline effect did.
export function useStreamingAnswer(stickToBottomRef: MutableRefObject<boolean>): {
  history: HistoryItem[]
} {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const nextIdRef = useRef(1)

  useEffect(() => {
    // Chunks arrive token-by-token. Buffering them and flushing once per animation frame turns
    // N setState+markdown-reparse per token into one per frame. The updater stays pure (appends to
    // prev from a const snapshot) so it's StrictMode-safe.
    const chunkBuf = new Map<number, string>()
    let flushScheduled = false
    const flush = (): void => {
      flushScheduled = false
      if (chunkBuf.size === 0) return
      const deltas = Array.from(chunkBuf.entries())
      chunkBuf.clear()
      setHistory((prev) =>
        prev.map((it) => {
          const d = deltas.find(([id]) => id === it.id)
          return d ? { ...it, answer: it.answer + d[1] } : it
        })
      )
    }
    const scheduleFlush = (): void => {
      if (flushScheduled) return
      flushScheduled = true
      requestAnimationFrame(flush)
    }

    const unStart = window.electronAPI.onAnswerStart(({ id, question }) => {
      stickToBottomRef.current = true // a new answer should always scroll into view
      setHistory((prev) => [
        ...prev,
        { id, question, answer: '', status: 'streaming', errorMsg: '' }
      ])
    })
    const unChunk = window.electronAPI.onAnswerChunk(({ id, chunk }) => {
      chunkBuf.set(id, (chunkBuf.get(id) ?? '') + chunk)
      scheduleFlush()
    })
    const unDone = window.electronAPI.onAnswerDone(({ id }) => {
      flush() // apply any buffered trailing text before marking done
      setHistory((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: 'done' as LLMStatus } : it))
      )
    })
    const unError = window.electronAPI.onAnswerError(({ id, message }) => {
      flush() // preserve any buffered partial answer before switching the bubble to error
      setHistory((prev) => {
        if (id != null && prev.some((it) => it.id === id)) {
          return prev.map((it) =>
            it.id === id ? { ...it, status: 'error' as LLMStatus, errorMsg: message } : it
          )
        }
        // No matching stream (e.g. an empty-key / "busy" error sent with id:null before any start).
        // Surface a standalone error item. Negative id can't collide with main-process stream ids.
        const synthId = -(nextIdRef.current++)
        const errItem = {
          id: synthId,
          question: '',
          answer: '',
          status: 'error' as LLMStatus,
          errorMsg: message
        }
        // If a stream is still live as the last item, keep IT last so the status bar / 停止 button /
        // auto-scroll stay bound to the live answer — insert the error just before it.
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
    return () => {
      unStart()
      unChunk()
      unDone()
      unError()
      unClear()
    }
  }, [stickToBottomRef])

  return { history }
}
