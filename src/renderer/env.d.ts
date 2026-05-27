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
}

interface AppStatus {
  contentProtection: boolean
  overlayVisible: boolean
  platform: string
  version: string
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
  // LLM
  askQuestion: (question: string) => void
  clearAnswer: () => void
  stopAnswer: () => void
  onAnswerStart: (cb: (question: string) => void) => UnlistenFn
  onAnswerChunk: (cb: (chunk: string) => void) => UnlistenFn
  onAnswerDone: (cb: () => void) => UnlistenFn
  onAnswerError: (cb: (msg: string) => void) => UnlistenFn
  onAnswerClear: (cb: () => void) => UnlistenFn
  // ASR – overlay side
  sendTranscript: (data: TranscriptData) => void
  autoAsk: (question: string) => void
  onAsrStart: (cb: () => void) => UnlistenFn
  onAsrStop: (cb: () => void) => UnlistenFn
  onAsrToggle: (cb: () => void) => UnlistenFn
  // ASR – main window side
  startListening: () => void
  stopListening: () => void
  setAsrLang: (lang: string) => void
  setAudioSource: (source: 'mic' | 'system') => void
  onTranscript: (cb: (data: TranscriptData) => void) => UnlistenFn
  // ASR – overlay side
  onAsrLangChange: (cb: (lang: string) => void) => UnlistenFn
  onAsrSourceChange: (cb: (source: string) => void) => UnlistenFn
  // Whisper transcription (request-response)
  transcribeChunk: (audio: ArrayBuffer, mimeType: string, lang: string) => Promise<string>
  // Clipboard
  copyText: (text: string) => void
  // Screenshot / coding mode
  submitScreenshot: (region: { x: number; y: number; w: number; h: number }) => void
  cancelScreenshot: () => void
  // Image re-ask with context
  reaskImageWithContext: (context: string) => void
  // Image text extraction
  onImageText: (cb: (text: string) => void) => UnlistenFn
  onImageStatus: (cb: (status: string) => void) => UnlistenFn
  onImageError: (cb: (msg: string) => void) => UnlistenFn
  askExtractedText: (text: string) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
    // Browser SpeechRecognition API
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
  }
}
