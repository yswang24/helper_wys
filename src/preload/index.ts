import { contextBridge, ipcRenderer } from 'electron'

type UnlistenFn = () => void

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Overlay mouse pass-through / mode ───────────────────────────────────────
  setIgnoreMouse: (ignore: boolean) =>
    ipcRenderer.send('overlay:set-ignore-mouse', ignore),
  // 请求把悬浮窗切到 'interactive'(可打字,进入会激活本 app 一次)或 'passthrough'(穿透·不抢焦点)
  requestOverlayMode: (interactive: boolean) =>
    ipcRenderer.send('overlay:request-mode', interactive),
  onOverlayMode: (cb: (mode: 'passthrough' | 'interactive') => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, mode: 'passthrough' | 'interactive') => cb(mode)
    ipcRenderer.on('overlay:mode', handler)
    return () => ipcRenderer.removeListener('overlay:mode', handler)
  },
  // 手动拖动悬浮窗(头部按下 start、移动 move、松开 end),坐标传事件的 screenX/screenY。
  // 仅输入模式下头部能收到鼠标,故自然只在非穿透生效。
  startOverlayDrag: (x: number, y: number) => ipcRenderer.send('overlay:drag-start', { x, y }),
  moveOverlayDrag: (x: number, y: number) => ipcRenderer.send('overlay:drag-move', { x, y }),
  endOverlayDrag: () => ipcRenderer.send('overlay:drag-end'),

  // ── App status ──────────────────────────────────────────────────────────────
  getStatus: () => ipcRenderer.invoke('app:get-status'),
  platform: process.platform,

  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('config:get'),
  // Secret-free subset for the overlay (no API keys reach that renderer)
  getPublicConfig: () => ipcRenderer.invoke('config:get-public'),
  setConfig: (partial: Record<string, string>) =>
    ipcRenderer.send('config:set', partial),
  testLLM: (cfg: { apiKey: string; baseUrl: string; model: string }) =>
    ipcRenderer.invoke('config:test-llm', cfg),
  testVision: (cfg: { apiKey: string; baseUrl: string; visionModel: string }) =>
    ipcRenderer.invoke('config:test-vision', cfg),
  testASR: (cfg: { apiKey: string; baseUrl: string; model: string }) =>
    ipcRenderer.invoke('config:test-asr', cfg),

  // ── LLM ─────────────────────────────────────────────────────────────────────
  askQuestion: (question: string) =>
    ipcRenderer.send('llm:ask', question),
  clearAnswer: () => ipcRenderer.send('llm:clear'),
  stopAnswer: () => ipcRenderer.send('llm:stop'),

  onAnswerStart: (cb: (data: { id: number; question: string }) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, data: { id: number; question: string }) => cb(data)
    ipcRenderer.on('llm:start', handler)
    return () => ipcRenderer.removeListener('llm:start', handler)
  },
  onAnswerChunk: (cb: (data: { id: number; chunk: string }) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, data: { id: number; chunk: string }) => cb(data)
    ipcRenderer.on('llm:chunk', handler)
    return () => ipcRenderer.removeListener('llm:chunk', handler)
  },
  onAnswerDone: (cb: (data: { id: number }) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, data: { id: number }) => cb(data)
    ipcRenderer.on('llm:done', handler)
    return () => ipcRenderer.removeListener('llm:done', handler)
  },
  onAnswerError: (cb: (data: { id: number | null; message: string }) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, data: { id: number | null; message: string }) => cb(data)
    ipcRenderer.on('llm:error', handler)
    return () => ipcRenderer.removeListener('llm:error', handler)
  },
  onAnswerClear: (cb: () => void): UnlistenFn => {
    const handler = () => cb()
    ipcRenderer.on('llm:clear', handler)
    return () => ipcRenderer.removeListener('llm:clear', handler)
  },

  // ── ASR: overlay ↔ main process ──────────────────────────────────────────────
  // Overlay sends transcript results up to main process
  sendTranscript: (data: { text: string; isFinal: boolean }) =>
    ipcRenderer.send('asr:transcript', data),
  // Overlay asks main to send question to LLM (auto-detect from transcript)
  autoAsk: (question: string) => ipcRenderer.send('asr:auto-ask', question),

  // Overlay listens for start/stop/toggle commands from main window or shortcuts
  onAsrStart: (cb: () => void): UnlistenFn => {
    const handler = () => cb()
    ipcRenderer.on('asr:start', handler)
    return () => ipcRenderer.removeListener('asr:start', handler)
  },
  onAsrStop: (cb: () => void): UnlistenFn => {
    const handler = () => cb()
    ipcRenderer.on('asr:stop', handler)
    return () => ipcRenderer.removeListener('asr:stop', handler)
  },
  onAsrPttToggle: (cb: () => void): UnlistenFn => {
    const handler = () => cb()
    ipcRenderer.on('asr:ptt-toggle', handler)
    return () => ipcRenderer.removeListener('asr:ptt-toggle', handler)
  },

  // Main window listens for transcript updates
  onTranscript: (cb: (data: { text: string; isFinal: boolean }) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, data: { text: string; isFinal: boolean }) =>
      cb(data)
    ipcRenderer.on('asr:transcript', handler)
    return () => ipcRenderer.removeListener('asr:transcript', handler)
  },

  // Main window controls ASR in overlay
  startListening: () => ipcRenderer.send('asr:start'),
  stopListening: () => ipcRenderer.send('asr:stop'),

  // Transcribe audio chunk via Whisper API (main process)
  transcribeChunk: (audio: ArrayBuffer, mimeType: string, lang: string): Promise<string> =>
    ipcRenderer.invoke('asr:transcribe', audio, mimeType, lang),

  // ── Overlay appearance ──────────────────────────────────────────────────────
  onOverlayOpacity: (cb: (opacity: number) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, opacity: number) => cb(opacity)
    ipcRenderer.on('overlay:opacity', handler)
    return () => ipcRenderer.removeListener('overlay:opacity', handler)
  },

  // ── Clipboard ────────────────────────────────────────────────────────────────
  copyText: (text: string) => ipcRenderer.send('clipboard:copy', text),

  // ── Screenshot / coding mode ─────────────────────────────────────────────────
  submitScreenshot: (region: { x: number; y: number; w: number; h: number; vw?: number; vh?: number }) =>
    ipcRenderer.send('screenshot:submit', region),

  // ── Image text extraction ───────────────────────────────────────────────────
  onImageText: (cb: (text: string) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('image:text', handler)
    return () => ipcRenderer.removeListener('image:text', handler)
  },
  onImageStatus: (cb: (status: string) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, status: string) => cb(status)
    ipcRenderer.on('image:status', handler)
    return () => ipcRenderer.removeListener('image:status', handler)
  },
  onImageError: (cb: (msg: string) => void): UnlistenFn => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string) => cb(msg)
    ipcRenderer.on('image:error', handler)
    return () => ipcRenderer.removeListener('image:error', handler)
  },
  askExtractedText: (text: string) =>
    ipcRenderer.send('llm:ask-extracted', text)
})
