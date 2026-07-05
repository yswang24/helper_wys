/// <reference types="vite/client" />

import type {
  FullConfig,
  PublicConfig,
  AppStatus,
  TranscriptData,
  ScreenRegion,
  OverlayMode,
  ServiceTestResult,
  AnswerStart,
  AnswerChunk,
  AnswerDone,
  AnswerError
} from '../shared/ipc'

type UnlistenFn = () => void

interface ElectronAPI {
  // Overlay
  setIgnoreMouse: (ignore: boolean) => void
  requestOverlayMode: (interactive: boolean) => void
  onOverlayMode: (cb: (mode: OverlayMode) => void) => UnlistenFn
  startOverlayDrag: (x: number, y: number) => void
  moveOverlayDrag: (x: number, y: number) => void
  endOverlayDrag: () => void
  // Status
  getStatus: () => Promise<AppStatus>
  getOverlayMode: () => Promise<OverlayMode>
  platform: string
  // Config
  getConfig: () => Promise<FullConfig>
  getPublicConfig: () => Promise<PublicConfig>
  setConfig: (partial: Partial<FullConfig>) => void
  testLLM: (cfg: { apiKey: string; baseUrl: string; model: string }) => Promise<ServiceTestResult>
  testVision: (cfg: {
    apiKey: string
    baseUrl: string
    visionModel: string
  }) => Promise<ServiceTestResult>
  testASR: (cfg: { apiKey: string; baseUrl: string; model: string }) => Promise<ServiceTestResult>
  // LLM
  askQuestion: (question: string) => void
  clearAnswer: () => void
  stopAnswer: () => void
  onAnswerStart: (cb: (data: AnswerStart) => void) => UnlistenFn
  onAnswerChunk: (cb: (data: AnswerChunk) => void) => UnlistenFn
  onAnswerDone: (cb: (data: AnswerDone) => void) => UnlistenFn
  onAnswerError: (cb: (data: AnswerError) => void) => UnlistenFn
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
  submitScreenshot: (region: ScreenRegion) => void
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
