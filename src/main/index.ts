import { app, BrowserWindow, globalShortcut, session } from 'electron'
import { File as NodeFile } from 'node:buffer'
// Node 18 doesn't expose File as a global; openai SDK requires it for multipart uploads
;(globalThis as unknown as Record<string, unknown>).File ??= NodeFile

import { streamAnswer, streamImageAnswer, extractImageText, stopStreaming, forceResetStreaming, isCurrentlyStreaming, setConfig, getConfig, clearHistory, testLLMConnection, testVisionConnection, setMainWindow } from './llm'
import { transcribeAudio, setASRConfig, getASRConfig, testASRConnection, cleanupStaleTempAudio } from './asr'
import { loadPersistedConfig, persistConfig } from './store'
import { createFullScreenCaptureTrigger, registerScreenshotIpc } from './screenshot'
import { FN_SHIFT_SHORTCUT_LABEL, FnShiftHotkey } from './fn-shift-hotkey'
import { registerConfigIpc } from './config'
import { createStreamSafe } from './stream-safe'
import { registerAppIpc } from './ipc/app'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerLlmIpc } from './ipc/llm'
import { registerAsrIpc } from './ipc/asr'
import { registerOverlayIpc } from './ipc/overlay'
import { OverlayController } from './overlay-controller'
import { createOverlayAnswerScrollDispatcher } from './overlay-answer-scroll'
import { WindowManager } from './window-manager'

const failedShortcuts: string[] = []  // unavailable shortcuts surfaced in the UI
const fnShiftHotkey = new FnShiftHotkey()

// WindowManager owns the main/selector windows + tray; OverlayController owns the stealth overlay.
// They reference each other lazily (tray reads overlay state; overlay crash-rebuild reads
// isQuitting), so the closures below are only invoked at runtime — no construction-order cycle.
const windowManager: WindowManager = new WindowManager({
  hardenWebContents,
  setMainWindow,
  overlay: {
    isVisible: () => overlayController.isVisible(),
    isInteractive: () => overlayController.isInteractive(),
    toggleVisibility: () => overlayController.toggleVisibility(),
    ensureShownAndToggleMode: () => overlayController.ensureShownAndToggleMode()
  }
})
const overlayController: OverlayController = new OverlayController({
  loadPersistedConfig,
  persistConfig,
  hardenWebContents,
  isQuitting: () => windowManager.isQuitting(),
  onVisibilityChange: () => windowManager.updateTrayMenu()
})
const dispatchOverlayAnswerScroll = createOverlayAnswerScrollDispatcher(() =>
  overlayController.getWindow()
)

function registerShortcut(accelerator: string, handler: () => void): void {
  if (!globalShortcut.register(accelerator, handler)) {
    recordShortcutFailure(accelerator, '可能被其他应用占用')
  }
}

function recordShortcutFailure(shortcut: string, reason: string): void {
  if (!failedShortcuts.includes(shortcut)) failedShortcuts.push(shortcut)
  console.warn(`[Shortcut] ${shortcut} 不可用: ${reason}`)
}

// Defense-in-depth for every window: block navigation away from the bundled renderer and deny
// window.open, so a compromised/redirected renderer can't reach the (broad) session handlers.
function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
}

app.whenReady().then(() => {
  // Keep this a regular (Dock-showing) app. Screenshot window churn (a transient panel created
  // while the main window is hidden) can otherwise leave macOS treating it as an agent and drop
  // the Dock icon. Asserting the policy up front + re-asserting after capture keeps it stable.
  if (process.platform === 'darwin') app.setActivationPolicy('regular')

  // Sweep any temp audio a previous run left behind (killed mid-transcribe, or old builds).
  cleanupStaleTempAudio()

  // Restore user settings from disk
  const saved = loadPersistedConfig()
  if (Object.keys(saved).length) setConfig(saved)
  if (saved.asrApiKey || saved.asrBaseUrl || saved.asrModel) {
    setASRConfig({
      // `||` not `??`: a persisted empty string (user cleared the field) must fall back to the
      // default, otherwise the API gets an empty model/baseUrl and the request fails.
      apiKey: saved.asrApiKey || '',
      baseUrl: saved.asrBaseUrl || 'https://api.openai.com/v1',
      model: saved.asrModel || 'whisper-1'
    })
  }

  // Grant ONLY microphone/media — the only capability this app needs. Granting everything
  // would hand geolocation/camera/clipboard-read/openExternal to any future renderer compromise.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  windowManager.createMainWindow()
  overlayController.create()

  // Overlay restore heartbeat (10Hz): re-shows + re-asserts content-protection if the OS /
  // conferencing app force-hides the overlay. Owned by OverlayController.
  overlayController.startHeartbeat()

  windowManager.createTray()

  registerShortcut('CommandOrControl+Alt+H', () => overlayController.toggleVisibility())

  // 切换悬浮窗 穿透/输入 模式。穿透模式下悬浮窗收不到键盘,故切换必须走全局快捷键(或托盘)。
  registerShortcut('CommandOrControl+Alt+E', () => overlayController.ensureShownAndToggleMode())

  // Toggle ASR: ⌘⌥X starts/stops recording. The renderer (VoiceTab) is the single
  // source of truth for "am I recording" — we just nudge it to flip. A main-side
  // boolean would drift out of sync whenever capture stops on its own (device
  // unplugged, failed start), inverting start/stop and misaligning the recorded clip.
  registerShortcut('CommandOrControl+Alt+X', () => {
    windowManager.getMainWindow()?.webContents.send('asr:ptt-toggle')
  })

  // Activate region selector for coding screenshot
  registerShortcut('CommandOrControl+Alt+S', () => windowManager.toggleSelector())

  if (process.platform === 'darwin') {
    fnShiftHotkey.start(
      {
        onScreenshot: triggerFullScreenScreenshot,
        onScrollUp: () => dispatchOverlayAnswerScroll('up'),
        onScrollDown: () => dispatchOverlayAnswerScroll('down')
      },
      (reason) => recordShortcutFailure(FN_SHIFT_SHORTCUT_LABEL, reason)
    )
  }
})

// 任何退出路径（⌘Q、右键 Dock→退出、托盘退出、app.quit()）都先置位。
// 否则 mainWindow 的 close 处理器会 preventDefault 把退出吞掉，进程残留、Dock 图标退不掉。
app.on('before-quit', () => {
  windowManager.setQuitting(true)
  fnShiftHotkey.stop()
})

// macOS：点击程序坞图标会触发 'activate'。主窗口被 X 关闭后只是隐藏（见 close 处理器），
// 没有这个监听，点 Dock 图标毫无反应。这里把隐藏/已销毁的主窗口重新唤回。
app.on('activate', () => {
  if (windowManager.isCapturing()) return // screenshot in progress — don't pull the main window up
  windowManager.restoreMainWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  overlayController.stopHeartbeat()
  fnShiftHotkey.stop()
  globalShortcut.unregisterAll()
})

// ── IPC: overlay pass-through/mode + manual drag ─────────────────────────────
// Handlers live in ./ipc/overlay; drag state is owned by OverlayController (applyMode clears it).
registerOverlayIpc({
  getOverlayWindow: () => overlayController.getWindow(),
  isInteractive: () => overlayController.isInteractive(),
  applyOverlayMode: (interactive) => overlayController.applyMode(interactive),
  getDragStart: () => overlayController.getDragStart(),
  setDragStart: (d) => overlayController.setDragStart(d),
  persistOverlayPos: (x, y) => {
    const { overlayX: _x, overlayY: _y, ...rest } = loadPersistedConfig()
    persistConfig({ ...rest, overlayX: x, overlayY: y })
  }
})

// ── IPC: app status ───────────────────────────────────────────────────────────
registerAppIpc({ getOverlayWindow: () => overlayController.getWindow(), failedShortcuts })

// ── IPC: config ───────────────────────────────────────────────────────────────
// Handlers live in ./config; registered here (module-eval) with injected deps.
registerConfigIpc({
  testLLMConnection,
  testVisionConnection,
  testASRConnection,
  getConfig,
  setConfig,
  getASRConfig,
  setASRConfig,
  loadPersistedConfig,
  persistConfig,
  sendOverlayOpacity: (opacity) => overlayController.getWindow()?.webContents.send('overlay:opacity', opacity)
})

// ── IPC: LLM ──────────────────────────────────────────────────────────────────
// Shared stream serialization (drain-then-start) lives in ./stream-safe.
const { startStreamSafely } = createStreamSafe({
  isCurrentlyStreaming,
  stopStreaming,
  forceResetStreaming,
  getOverlayWindow: () => overlayController.getWindow(),
  ensureOverlayVisible: () => overlayController.ensureVisible(),
})

registerLlmIpc({
  getOverlayWindow: () => overlayController.getWindow(),
  startStreamSafely,
  streamAnswer,
  stopStreaming,
  clearHistory
})

registerAsrIpc({
  getOverlayWindow: () => overlayController.getWindow(),
  startStreamSafely,
  streamAnswer,
  transcribeAudio
})

registerClipboardIpc()

// ── IPC: screenshot / coding mode ────────────────────────────────────────────

// Capture math + screencapture/desktopCapturer live in ./screenshot; the handlers and full-screen
// trigger are created here (module-eval, before windows exist) with getter deps so they always see
// the live windows.
const screenshotDeps = {
  getOverlayWindow: () => overlayController.getWindow(),
  getSelectorWindow: () => windowManager.getSelectorWindow(),
  getSelectorDisplayId: () => windowManager.getSelectorDisplayId(),
  ensureOverlayVisible: () => overlayController.ensureVisible(),
  startStreamSafely,
  streamImageAnswer,
  extractImageText,
  loadPersistedConfig
}
registerScreenshotIpc(screenshotDeps)
const triggerFullScreenScreenshot = createFullScreenCaptureTrigger(screenshotDeps)
