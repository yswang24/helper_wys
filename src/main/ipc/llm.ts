import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { SEND, EVENT } from '../../shared/ipc'

export interface LlmIpcDeps {
  getOverlayWindow: () => BrowserWindow | null
  startStreamSafely: (run: (win: BrowserWindow) => void) => void
  streamAnswer: (question: string, win: BrowserWindow) => unknown
  stopStreaming: () => void
  clearHistory: () => void
}

export function registerLlmIpc(deps: LlmIpcDeps): void {
  ipcMain.on(SEND.llmAsk, (_e, question: string) => {
    if (!deps.getOverlayWindow()) return
    deps.startStreamSafely((win) => deps.streamAnswer(question, win))
  })

  ipcMain.on(SEND.llmClear, () => {
    deps.stopStreaming() // abort any in-flight stream so it doesn't keep generating into an empty UI
    deps.clearHistory()
    deps.getOverlayWindow()?.webContents.send(EVENT.llmClear)
  })

  ipcMain.on(SEND.llmStop, () => {
    deps.stopStreaming()
  })

  // Overlay sends extracted text → LLM answers
  ipcMain.on(SEND.llmAskExtracted, (_e, text: string) => {
    if (!deps.getOverlayWindow()) return
    deps.startStreamSafely((win) => deps.streamAnswer(text, win))
  })
}
