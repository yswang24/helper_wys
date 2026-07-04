import { useEffect, useState } from 'react'

// ASR display state for the overlay (main window does the actual capture): the listening
// indicator + the last 6 final transcript lines. Verbatim move from the overlay App.
export function useAsrDisplay(): {
  listening: boolean
  finalLines: string[]
  clearFinalLines: () => void
} {
  const [listening, setListening] = useState(false)
  const [finalLines, setFinalLines] = useState<string[]>([])
  useEffect(() => {
    const un = window.electronAPI.onTranscript(({ text, isFinal }) => {
      if (isFinal && text.trim().length > 1) setFinalLines((prev) => [...prev, text].slice(-6))
    })
    return un
  }, [])
  useEffect(() => {
    const unStart = window.electronAPI.onAsrStart(() => setListening(true))
    const unStop = window.electronAPI.onAsrStop(() => setListening(false))
    return () => {
      unStart()
      unStop()
    }
  }, [])
  return { listening, finalLines, clearFinalLines: () => setFinalLines([]) }
}
