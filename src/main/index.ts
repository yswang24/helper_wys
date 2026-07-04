import { app, BrowserWindow, ipcMain, globalShortcut, session, screen, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { File as NodeFile } from 'node:buffer'
// Node 18 doesn't expose File as a global; openai SDK requires it for multipart uploads
;(globalThis as unknown as Record<string, unknown>).File ??= NodeFile

import { streamAnswer, streamImageAnswer, extractImageText, stopStreaming, forceResetStreaming, isCurrentlyStreaming, setConfig, getConfig, clearHistory, testLLMConnection, testVisionConnection, setMainWindow } from './llm'
import { transcribeAudio, setASRConfig, getASRConfig, testASRConnection, cleanupStaleTempAudio } from './asr'
import { loadPersistedConfig, persistConfig } from './store'
import { registerScreenshotIpc } from './screenshot'
import { registerConfigIpc } from './config'
import { createStreamSafe } from './stream-safe'
import { registerAppIpc } from './ipc/app'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerLlmIpc } from './ipc/llm'
import { registerAsrIpc } from './ipc/asr'
import { registerOverlayIpc } from './ipc/overlay'
import { OverlayController } from './overlay-controller'

let mainWindow: BrowserWindow | null = null
let selectorWindow: BrowserWindow | null = null
let selectorDisplayId: number | null = null  // which display the active selector covers (multi-monitor)
let tray: Tray | null = null
let isQuitting = false  // distinguishes "hide main window" from a real app quit
let isCapturing = false // true while the screenshot selector is up — suppresses activate→restore
const failedShortcuts: string[] = []  // accelerators another app already grabbed — surfaced in the UI

// The stealth overlay + its two-mode invariants live in OverlayController. onVisibilityChange
// refreshes the tray; isQuitting is read live so a crash-rebuild during quit is suppressed.
const overlayController = new OverlayController({
  loadPersistedConfig,
  persistConfig,
  hardenWebContents,
  isQuitting: () => isQuitting,
  onVisibilityChange: () => updateTrayMenu()
})

function registerShortcut(accelerator: string, handler: () => void): void {
  if (!globalShortcut.register(accelerator, handler)) {
    failedShortcuts.push(accelerator)
    console.warn(`[Shortcut] 注册失败（可能被其他应用占用）: ${accelerator}`)
  }
}

// Defense-in-depth for every window: block navigation away from the bundled renderer and deny
// window.open, so a compromised/redirected renderer can't reach the (broad) session handlers.
function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 820,
    minWidth: 400,
    minHeight: 600,
    title: 'Helper',
    backgroundColor: '#0f0f14',
    skipTaskbar: true,   // 不显示在任务栏
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 录音的 MediaRecorder 跑在本窗口里，而本窗口常被隐藏（点 X 关闭即隐藏）。默认的后台节流会
      // 掐住隐藏窗口的编码管线，导致录到的音频近乎静音、Whisper 只回一个字。必须关掉。
      backgroundThrottling: false
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(`${devUrl}/main-window/index.html`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/main-window/index.html'))
  }

  // Invisible to screen capture as well (safety net)
  mainWindow.setContentProtection(true)
  hardenWebContents(mainWindow)
  // Let llm.ts mirror stream lifecycle (start/done/error) here so the Ask tab button tracks
  // real progress. Re-registered on rebuild; cleared on close.
  setMainWindow(mainWindow)

  // 点 X → 仅隐藏主窗口，应用继续在托盘后台运行；真正退出走托盘菜单
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    setMainWindow(null)
  })
}

// 统一的"把主窗口唤回前台"入口。Dock 图标点击、托盘点击 都走这里，
// 保证 null/已销毁/屏幕外 三种边界都被处理。
function restoreMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // 窗口已真正销毁，只可能发生在一次没走完的退出之后。重建前清掉退出标记，
    // 否则新窗口继承 isQuitting=true，下次点 X 会变成真关而非隐藏，bug 复发。
    isQuitting = false
    createMainWindow()
    return
  }
  // 把窗口夹回某个仍连接的显示器可视区域内，避免它停在已断开的副屏/改过分辨率后的
  // 屏幕外——那样 show() 了却看不见，等同于"点了没反应"。（与 overlay 的夹取逻辑一致）
  const b = mainWindow.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  mainWindow.setBounds({
    x: Math.round(Math.min(Math.max(b.x, area.x), area.x + area.width - b.width)),
    y: Math.round(Math.min(Math.max(b.y, area.y), area.y + area.height - b.height)),
    width: b.width,
    height: b.height
  })
  mainWindow.show()
  mainWindow.focus()
}

// Rebuild the tray menu so its overlay show/hide label matches current visibility. Module-level
// (was a whenReady closure) so ensureOverlayVisible and the shortcuts can all call it.
function updateTrayMenu(): void {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    {
      label: overlayController.isVisible() ? '隐藏覆盖层' : '显示覆盖层',
      click: () => overlayController.toggleVisibility()
    },
    {
      label: overlayController.isInteractive()
        ? '切到穿透模式（不抢焦点）'
        : '切到输入模式（可打字·会切屏）',
      click: () => overlayController.ensureShownAndToggleMode()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

function createSelectorWindow(): void {
  isCapturing = true  // belt-and-suspenders: also suppress app.on('activate')
  // Cover the display the cursor is on, not always the primary — otherwise a second monitor
  // can never be selected. Use its real origin (x/y), not 0,0, so it lands on that screen.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.bounds
  selectorDisplayId = display.id

  selectorWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    // Non-activating: float over the exam and take mouse drags WITHOUT switching the foreground
    // app away from the browser — activating our app is what the exam detects as 切屏/blur.
    // Trade-off: a non-focusable window gets no keyboard, so Esc/Enter inside the selector don't
    // fire; ⌘⌥S again cancels it (global shortcut, works regardless of focus).
    type: 'panel',
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Must be content-protected so the selection UI is invisible to screen capture
  selectorWindow.setContentProtection(true)
  selectorWindow.setIgnoreMouseEvents(false)
  hardenWebContents(selectorWindow)
  // Raise above the menu bar / Dock so the dim overlay truly covers the whole screen
  selectorWindow.setAlwaysOnTop(true, 'screen-saver')
  selectorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Main-side dismissal fallbacks: the selector is a full-screen, content-protected,
  // always-on-top overlay. If the renderer fails to load (or hasn't wired its keydown yet),
  // these guarantee Escape and a load failure can still close it instead of trapping the screen.
  selectorWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') selectorWindow?.close()
  })
  selectorWindow.webContents.on('did-fail-load', () => selectorWindow?.close())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    selectorWindow.loadURL(`${devUrl}/selector-window/index.html`)
  } else {
    selectorWindow.loadFile(join(__dirname, '../renderer/selector-window/index.html'))
  }

  // Show WITHOUT activating our app — the exam/browser stays the foreground app (no 切屏)
  selectorWindow.showInactive()

  selectorWindow.on('closed', () => {
    selectorWindow = null
    selectorDisplayId = null
    // Re-assert the Dock icon — closing the transient panel can drop it (see whenReady note)
    if (process.platform === 'darwin') void app.dock?.show()
    // Defer: a re-activation fired as the selector closes must not trigger restoreMainWindow
    setTimeout(() => { isCapturing = false }, 300)
  })
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

  createMainWindow()
  overlayController.create()

  // Overlay restore heartbeat (10Hz): re-shows + re-asserts content-protection if the OS /
  // conferencing app force-hides the overlay. Owned by OverlayController.
  overlayController.startHeartbeat()

  // ── System tray ──────────────────────────────────────────────────────────────
  const iconPath = join(__dirname, '../../resources/icon.png')
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('Helper')
  updateTrayMenu()  // updateTrayMenu is module-level (see above)

  tray.on('click', () => {
    restoreMainWindow()
  })

  // Overlay position restore + move-persist now live in createOverlayWindow (so a rebuilt overlay
  // after a crash re-applies them too). Opacity is pulled by the overlay renderer via
  // getPublicConfig on mount, so nothing extra is needed here.

  registerShortcut('CommandOrControl+Alt+H', () => overlayController.toggleVisibility())

  // 切换悬浮窗 穿透/输入 模式。穿透模式下悬浮窗收不到键盘,故切换必须走全局快捷键(或托盘)。
  registerShortcut('CommandOrControl+Alt+E', () => overlayController.ensureShownAndToggleMode())

  // Toggle ASR: ⌘⌥X starts/stops recording. The renderer (VoiceTab) is the single
  // source of truth for "am I recording" — we just nudge it to flip. A main-side
  // boolean would drift out of sync whenever capture stops on its own (device
  // unplugged, failed start), inverting start/stop and misaligning the recorded clip.
  registerShortcut('CommandOrControl+Alt+X', () => {
    mainWindow?.webContents.send('asr:ptt-toggle')
  })

  // Activate region selector for coding screenshot
  registerShortcut('CommandOrControl+Alt+S', () => {
    if (selectorWindow) {
      selectorWindow.close()
      return
    }
    createSelectorWindow()
  })
})

// 任何退出路径（⌘Q、右键 Dock→退出、托盘退出、app.quit()）都先置位。
// 否则 mainWindow 的 close 处理器会 preventDefault 把退出吞掉，进程残留、Dock 图标退不掉。
app.on('before-quit', () => {
  isQuitting = true
})

// macOS：点击程序坞图标会触发 'activate'。主窗口被 X 关闭后只是隐藏（见 close 处理器），
// 没有这个监听，点 Dock 图标毫无反应。这里把隐藏/已销毁的主窗口重新唤回。
app.on('activate', () => {
  if (isCapturing) return // a screenshot is in progress — don't pull the main window to the front
  restoreMainWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  overlayController.stopHeartbeat()
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

// Capture math + screencapture/desktopCapturer live in ./screenshot; the handler is registered
// here (module-eval, before windows exist) with getter deps so it always sees the live windows.
registerScreenshotIpc({
  getOverlayWindow: () => overlayController.getWindow(),
  getSelectorWindow: () => selectorWindow,
  getSelectorDisplayId: () => selectorDisplayId,
  ensureOverlayVisible: () => overlayController.ensureVisible(),
  startStreamSafely,
  streamImageAnswer,
  extractImageText,
  loadPersistedConfig
})
