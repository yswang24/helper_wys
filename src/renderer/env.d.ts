/// <reference types="vite/client" />

type UnlistenFn = () => void

interface LLMConfig {
  apiKey: string
  baseUrl: string
  model: string
  visionModel: string
  jobDescription: string
  // ASR (Whisper)
  asrApiKey: string
  asrBaseUrl: string
  asrModel: string
  // Overlay appearance
  overlayOpacity?: number
}

interface AppStatus {
  contentProtection: boolean
  overlayVisible: boolean
  platform: string
  version: string
  failedShortcuts: string[]
}

interface TranscriptData {
  text: string
  isFinal: boolean
}

interface ElectronAPI {
  // Overlay
  setIgnoreMouse: (ignore: boolean) => void
  // Status
  getStatus: () => Promise<AppStatus>
  platform: string
  // Config
  getConfig: () => Promise<LLMConfig>
  setConfig: (partial: Partial<LLMConfig>) => void
  testLLM: (cfg: { apiKey: string; baseUrl: string; model: string }) => Promise<{ ok: boolean; message: string }>
  testVision: (cfg: { apiKey: string; baseUrl: string; visionModel: string }) => Promise<{ ok: boolean; message: string }>
  testASR: (cfg: { apiKey: string; baseUrl: string; model: string }) => Promise<{ ok: boolean; message: string }>
  // LLM
  askQuestion: (question: string) => void
  clearAnswer: () => void
  stopAnswer: () => void
  onAnswerStart: (cb: (data: { id: number; question: string }) => void) => UnlistenFn
  onAnswerChunk: (cb: (data: { id: number; chunk: string }) => void) => UnlistenFn
  onAnswerDone: (cb: (data: { id: number }) => void) => UnlistenFn
  onAnswerError: (cb: (data: { id: number | null; message: string }) => void) => UnlistenFn
  onAnswerClear: (cb: () => void) => UnlistenFn
  // Overlay appearance
  onOverlayOpacity: (cb: (opacity: number) => void) => UnlistenFn
  // ASR – overlay side
  sendTranscript: (data: TranscriptData) => void
  autoAsk: (question: string) => void
  onAsrStart: (cb: () => void) => UnlistenFn
  onAsrStop: (cb: () => void) => UnlistenFn
  onAsrPttToggle: (cb: () => void) => UnlistenFn
  // ASR – main window side
  startListening: () => void
  stopListening: () => void
  onTranscript: (cb: (data: TranscriptData) => void) => UnlistenFn
  // Whisper transcription (request-response)
  transcribeChunk: (audio: ArrayBuffer, mimeType: string, lang: string) => Promise<string>
  // Clipboard
  copyText: (text: string) => void
  // Screenshot / coding mode
  submitScreenshot: (region: { x: number; y: number; w: number; h: number; vw?: number; vh?: number }) => void
  // Image text extraction
  onImageText: (cb: (text: string) => void) => UnlistenFn
  onImageStatus: (cb: (status: string) => void) => UnlistenFn
  onImageError: (cb: (msg: string) => void) => UnlistenFn
  askExtractedText: (text: string) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

// `export {}` makes this file a module so the `declare global` augmentation above
// actually applies (otherwise window.electronAPI is untyped across the renderer).
export {}
