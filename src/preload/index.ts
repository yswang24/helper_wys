import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  INVOKE,
  SEND,
  EVENT,
  type InvokeChannel,
  type InvokeMap,
  type SendChannel,
  type SendMap,
  type EventChannel,
  type EventMap
} from '../shared/ipc'

type UnlistenFn = () => void

// ── Typed wrappers over the shared contract — the ONLY place raw ipcRenderer is touched. ──────
function invoke<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeMap[K]['request']
): Promise<InvokeMap[K]['response']> {
  return ipcRenderer.invoke(channel, ...args)
}

function send<K extends SendChannel>(channel: K, payload?: SendMap[K]): void {
  ipcRenderer.send(channel, payload)
}

// Collapses the identical define/on/removeListener blocks into one helper.
function subscribe<K extends EventChannel>(
  channel: K,
  cb: (payload: EventMap[K]) => void
): UnlistenFn {
  const handler = (_e: IpcRendererEvent, payload: EventMap[K]): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Overlay mouse pass-through / mode ───────────────────────────────────────
  setIgnoreMouse: (ignore: boolean) => send(SEND.overlaySetIgnoreMouse, ignore),
  requestOverlayMode: (interactive: boolean) => send(SEND.overlayRequestMode, interactive),
  onOverlayMode: (cb: (mode: EventMap['overlay:mode']) => void) => subscribe(EVENT.overlayMode, cb),
  onAnswerScroll: (cb: (direction: EventMap['overlay:answer-scroll']) => void) =>
    subscribe(EVENT.overlayAnswerScroll, cb),
  startOverlayDrag: (x: number, y: number) => send(SEND.overlayDragStart, { x, y }),
  moveOverlayDrag: (x: number, y: number) => send(SEND.overlayDragMove, { x, y }),
  endOverlayDrag: () => send(SEND.overlayDragEnd),

  // ── App status ──────────────────────────────────────────────────────────────
  getStatus: () => invoke(INVOKE.getStatus),
  getOverlayMode: () => invoke(INVOKE.getOverlayMode),
  platform: process.platform,

  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig: () => invoke(INVOKE.getConfig),
  getPublicConfig: () => invoke(INVOKE.getPublicConfig),
  setConfig: (partial: SendMap['config:set']) => send(SEND.configSet, partial),
  testLLM: (cfg: InvokeMap['config:test-llm']['request'][0]) => invoke(INVOKE.testLLM, cfg),
  testVision: (cfg: InvokeMap['config:test-vision']['request'][0]) => invoke(INVOKE.testVision, cfg),
  testASR: (cfg: InvokeMap['config:test-asr']['request'][0]) => invoke(INVOKE.testASR, cfg),

  // ── LLM ─────────────────────────────────────────────────────────────────────
  askQuestion: (question: string) => send(SEND.llmAsk, question),
  clearAnswer: () => send(SEND.llmClear),
  stopAnswer: () => send(SEND.llmStop),
  onAnswerStart: (cb: (data: EventMap['llm:start']) => void) => subscribe(EVENT.llmStart, cb),
  onAnswerChunk: (cb: (data: EventMap['llm:chunk']) => void) => subscribe(EVENT.llmChunk, cb),
  onAnswerDone: (cb: (data: EventMap['llm:done']) => void) => subscribe(EVENT.llmDone, cb),
  onAnswerError: (cb: (data: EventMap['llm:error']) => void) => subscribe(EVENT.llmError, cb),
  onAnswerClear: (cb: () => void) => subscribe(EVENT.llmClear, cb),

  // ── ASR: overlay ↔ main process ──────────────────────────────────────────────
  sendTranscript: (data: SendMap['asr:transcript']) => send(SEND.asrTranscript, data),
  autoAsk: (question: string) => send(SEND.asrAutoAsk, question),
  onAsrStart: (cb: () => void) => subscribe(EVENT.asrStart, cb),
  onAsrStop: (cb: () => void) => subscribe(EVENT.asrStop, cb),
  onAsrPttToggle: (cb: () => void) => subscribe(EVENT.asrPttToggle, cb),
  onTranscript: (cb: (data: EventMap['asr:transcript']) => void) =>
    subscribe(EVENT.asrTranscript, cb),
  startListening: () => send(SEND.asrStart),
  stopListening: () => send(SEND.asrStop),
  transcribeChunk: (audio: ArrayBuffer, mimeType: string, lang: string) =>
    invoke(INVOKE.transcribe, audio, mimeType, lang),

  // ── Overlay appearance ──────────────────────────────────────────────────────
  onOverlayOpacity: (cb: (opacity: EventMap['overlay:opacity']) => void) =>
    subscribe(EVENT.overlayOpacity, cb),

  // ── Clipboard ────────────────────────────────────────────────────────────────
  copyText: (text: string) => send(SEND.clipboardCopy, text),

  // ── Screenshot / coding mode ─────────────────────────────────────────────────
  submitScreenshot: (region: SendMap['screenshot:submit']) => send(SEND.screenshotSubmit, region),

  // ── Image text extraction ───────────────────────────────────────────────────
  onImageText: (cb: (text: EventMap['image:text']) => void) => subscribe(EVENT.imageText, cb),
  onImageStatus: (cb: (status: EventMap['image:status']) => void) =>
    subscribe(EVENT.imageStatus, cb),
  onImageError: (cb: (msg: EventMap['image:error']) => void) => subscribe(EVENT.imageError, cb),
  askExtractedText: (text: string) => send(SEND.llmAskExtracted, text)
})
