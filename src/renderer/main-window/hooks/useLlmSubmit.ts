import { useEffect, useRef, useState } from 'react'

// Tracks the real stream lifecycle so "发送中…" reflects actual generation. llm:start/done/error
// fire for EVERY stream (voice/screenshot/overlay too), so correlate by id: only the stream WE
// submitted drives the button. Moved verbatim from AskTab.
export function useLlmSubmit(): { isSending: boolean; submit: (rawQuestion: string) => boolean } {
  const [isSending, setIsSending] = useState(false)
  const pendingSubmitRef = useRef(false)
  const myStreamIdRef = useRef<number | null>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const clearSafety = (): void => {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    }
    const reset = (): void => {
      clearSafety()
      pendingSubmitRef.current = false
      myStreamIdRef.current = null
      setIsSending(false)
    }
    const unStart = window.electronAPI.onAnswerStart(({ id }) => {
      if (pendingSubmitRef.current) {
        myStreamIdRef.current = id
        pendingSubmitRef.current = false
      }
    })
    const unDone = window.electronAPI.onAnswerDone(({ id }) => {
      if (!pendingSubmitRef.current && id === myStreamIdRef.current) reset()
    })
    const unError = window.electronAPI.onAnswerError(({ id }) => {
      // id:null = a pre-start failure (missing key / busy). If we're mid-submit, it's ours → reset.
      if (pendingSubmitRef.current || (id !== null && id === myStreamIdRef.current)) reset()
    })
    return () => {
      unStart()
      unDone()
      unError()
      clearSafety()
    }
  }, [])

  // Returns true when it actually submitted (so the caller can clear its input).
  const submit = (rawQuestion: string): boolean => {
    const q = rawQuestion.trim()
    if (!q || isSending) return false
    setIsSending(true)
    pendingSubmitRef.current = true // adopt the next stream start as ours
    window.electronAPI.askQuestion(q)
    // Safety net: if our start/done/error is ever missed, don't strand the button disabled.
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    sendTimerRef.current = setTimeout(() => {
      pendingSubmitRef.current = false
      myStreamIdRef.current = null
      setIsSending(false)
    }, 30000)
    return true
  }

  return { isSending, submit }
}
