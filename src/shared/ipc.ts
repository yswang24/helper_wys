// Single source of truth for every IPC channel across main / preload / renderer.
//
// Channels are keyed by (name, DIRECTION): several names are reused across directions
// (`llm:clear`, `asr:start`, `asr:stop`, `asr:transcript` are BOTH a renderer→main send AND
// a main→renderer event), so a flat map would silently collapse them. Three maps keep them
// distinct. Distinct channel NAMES: 35. Distinct (name, direction) tuples: 39 (8 + 16 + 15).
//
// Config wire types come from the canonical shared/config.ts (PublicConfig, ScreenshotMode).
// `FullConfig` (the flat config:get response) stays here as an IPC-layer type.
import type { ScreenshotMode, PublicConfig } from './config'

export type OverlayMode = 'passthrough' | 'interactive'
export type AnswerScrollDirection = 'up' | 'down'
export type { ScreenshotMode, PublicConfig }

export interface ScreenRegion {
  x: number
  y: number
  w: number
  h: number
  vw?: number
  vh?: number
}

export interface TranscriptData {
  text: string
  isFinal: boolean
}

export interface AppStatus {
  contentProtection: boolean
  overlayVisible: boolean
  platform: string
  version: string
  failedShortcuts: string[]
}

export interface ServiceTestResult {
  ok: boolean
  message: string
}

// LLM stream lifecycle payloads. `id: null` on error = an orphan error not tied to any stream
// (e.g. "please fill in API Key" before a stream id is assigned).
export interface AnswerStart {
  id: number
  question: string
}
export interface AnswerChunk {
  id: number
  chunk: string
}
export interface AnswerDone {
  id: number
}
export interface AnswerError {
  id: number | null
  message: string
}

// The flat config:get response (settings form echoes it back). Kept structurally identical to
// the legacy renderer LLMConfig so no consumer changes; PublicConfig lives in shared/config.ts.
export interface FullConfig {
  apiKey: string
  baseUrl: string
  model: string
  visionModel: string
  jobDescription: string
  resume?: string
  answerLang?: string
  screenshotPrompt?: string
  asrApiKey: string
  asrBaseUrl: string
  asrModel: string
  overlayOpacity?: number
  screenshotMode?: ScreenshotMode
}

// ── Invoke: renderer → main (request/response). `request` is the positional arg tuple. ────
export interface InvokeMap {
  'app:get-status': { request: []; response: AppStatus }
  'config:get': { request: []; response: FullConfig }
  'config:get-public': { request: []; response: PublicConfig }
  'config:test-llm': {
    request: [{ apiKey: string; baseUrl: string; model: string }]
    response: ServiceTestResult
  }
  'config:test-vision': {
    request: [{ apiKey: string; baseUrl: string; visionModel: string }]
    response: ServiceTestResult
  }
  'config:test-asr': {
    request: [{ apiKey: string; baseUrl: string; model: string }]
    response: ServiceTestResult
  }
  'asr:transcribe': { request: [ArrayBuffer, string, string]; response: string }
  'overlay:get-mode': { request: []; response: OverlayMode }
}

// ── Send: renderer → main (fire-and-forget). Value = the payload type (`void` = no payload). ─
export interface SendMap {
  'overlay:set-ignore-mouse': boolean
  'overlay:request-mode': boolean
  'overlay:drag-start': { x: number; y: number }
  'overlay:drag-move': { x: number; y: number }
  'overlay:drag-end': void
  'config:set': Partial<FullConfig>
  'llm:ask': string
  'llm:clear': void
  'llm:stop': void
  'llm:ask-extracted': string
  'asr:transcript': TranscriptData
  'asr:auto-ask': string
  'asr:start': void
  'asr:stop': void
  'clipboard:copy': string
  'screenshot:submit': ScreenRegion
}

// ── Event: main → renderer (webContents.send). Value = the event payload type. ─────────────
export interface EventMap {
  'overlay:mode': OverlayMode
  'overlay:opacity': number
  'overlay:answer-scroll': AnswerScrollDirection
  'llm:start': AnswerStart
  'llm:chunk': AnswerChunk
  'llm:done': AnswerDone
  'llm:error': AnswerError
  'llm:clear': void
  'asr:start': void
  'asr:stop': void
  'asr:ptt-toggle': void
  'asr:transcript': TranscriptData
  'image:text': string
  'image:status': string
  'image:error': string
}

export type InvokeChannel = keyof InvokeMap
export type SendChannel = keyof SendMap
export type EventChannel = keyof EventMap

// Name constants so no call site hard-codes a string literal. Reused names (llm:clear,
// asr:start/stop/transcript) get a direction-suffixed key but the same literal value.
export const INVOKE = {
  getStatus: 'app:get-status',
  getConfig: 'config:get',
  getPublicConfig: 'config:get-public',
  testLLM: 'config:test-llm',
  testVision: 'config:test-vision',
  testASR: 'config:test-asr',
  transcribe: 'asr:transcribe',
  getOverlayMode: 'overlay:get-mode'
} as const satisfies Record<string, InvokeChannel>

export const SEND = {
  overlaySetIgnoreMouse: 'overlay:set-ignore-mouse',
  overlayRequestMode: 'overlay:request-mode',
  overlayDragStart: 'overlay:drag-start',
  overlayDragMove: 'overlay:drag-move',
  overlayDragEnd: 'overlay:drag-end',
  configSet: 'config:set',
  llmAsk: 'llm:ask',
  llmClear: 'llm:clear',
  llmStop: 'llm:stop',
  llmAskExtracted: 'llm:ask-extracted',
  asrTranscript: 'asr:transcript',
  asrAutoAsk: 'asr:auto-ask',
  asrStart: 'asr:start',
  asrStop: 'asr:stop',
  clipboardCopy: 'clipboard:copy',
  screenshotSubmit: 'screenshot:submit'
} as const satisfies Record<string, SendChannel>

export const EVENT = {
  overlayMode: 'overlay:mode',
  overlayOpacity: 'overlay:opacity',
  overlayAnswerScroll: 'overlay:answer-scroll',
  llmStart: 'llm:start',
  llmChunk: 'llm:chunk',
  llmDone: 'llm:done',
  llmError: 'llm:error',
  llmClear: 'llm:clear',
  asrStart: 'asr:start',
  asrStop: 'asr:stop',
  asrPttToggle: 'asr:ptt-toggle',
  asrTranscript: 'asr:transcript',
  imageText: 'image:text',
  imageStatus: 'image:status',
  imageError: 'image:error'
} as const satisfies Record<string, EventChannel>
