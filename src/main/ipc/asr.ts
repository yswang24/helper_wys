import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { SEND, INVOKE, EVENT } from '../../shared/ipc'
import type { TranscriptData } from '../../shared/ipc'

export interface AsrIpcDeps {
  getOverlayWindow: () => BrowserWindow | null
  startStreamSafely: (run: (win: BrowserWindow) => void) => void
  streamAnswer: (question: string, win: BrowserWindow) => unknown
  transcribeAudio: (buf: Buffer, mimeType: string, lang: string) => Promise<string>
}

export function registerAsrIpc(deps: AsrIpcDeps): void {
  // Main window sends start/stop commands; overlay runs the capture. Forward to the overlay.
  ipcMain.on(SEND.asrStart, () => deps.getOverlayWindow()?.webContents.send(EVENT.asrStart))
  ipcMain.on(SEND.asrStop, () => deps.getOverlayWindow()?.webContents.send(EVENT.asrStop))

  // Transcript arrives from the main window; forward it to the overlay's transcript panel.
  ipcMain.on(SEND.asrTranscript, (_e, data: TranscriptData) =>
    deps.getOverlayWindow()?.webContents.send(EVENT.asrTranscript, data)
  )

  // Overlay asks main to auto-submit a transcribed question to LLM
  ipcMain.on(SEND.asrAutoAsk, (_e, question: string) => {
    if (!deps.getOverlayWindow()) return
    deps.startStreamSafely((win) => deps.streamAnswer(question, win))
  })

  // Overlay sends audio chunk → Whisper API → returns text. `lang || ''` fallback preserved.
  ipcMain.handle(INVOKE.transcribe, async (_e, audio: ArrayBuffer, mimeType: string, lang: string) => {
    return deps.transcribeAudio(Buffer.from(audio), mimeType, lang || '')
  })
}
