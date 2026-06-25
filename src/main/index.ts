import { app, BrowserWindow, ipcMain, globalShortcut, session, desktopCapturer, screen, clipboard, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { File as NodeFile } from 'node:buffer'
// Node 18 doesn't expose File as a global; openai SDK requires it for multipart uploads
;(globalThis as unknown as Record<string, unknown>).File ??= NodeFile

import { streamAnswer, extractImageText, stopStreaming, forceResetStreaming, isCurrentlyStreaming, setConfig, getConfig, clearHistory, testLLMConnection, testVisionConnection } from './llm'
import { transcribeAudio, setASRConfig, getASRConfig, testASRConnection } from './asr'
import { loadPersistedConfig, persistConfig } from './store'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let selectorWindow: BrowserWindow | null = null
let selectorDisplayId: number | null = null  // which display the active selector covers (multi-monitor)
let tray: Tray | null = null
let overlayUserVisible = true  // tracks whether user wants overlay visible
let isQuitting = false  // distinguishes "hide main window" from a real app quit
let isCapturing = false // true while the screenshot selector is up — suppresses activate→restore
let heartbeatTimer: ReturnType<typeof setInterval> | null = null  // overlay mouse/restore heartbeat
const failedShortcuts: string[] = []  // accelerators another app already grabbed — surfaced in the UI

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
      // 录音的 MediaRecorder 跑在本窗口里，而本窗口常被隐藏（⌘⌥M）。默认的后台节流会
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

  // 点 X → 仅隐藏主窗口，应用继续在托盘后台运行；真正退出走托盘菜单或 ⌘⌥Q
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 统一的"把主窗口唤回前台"入口。Dock 图标点击、托盘点击、⌘⌥M 都走这里，
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

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: 500,
    height: 680,
    x: 20,
    y: 80,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    type: 'panel',
    // focusable must be true so inputs can receive keyboard events
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Invisible to all screen capture (DXGI / getDisplayMedia / OBS)
  overlayWindow.setContentProtection(true)
  hardenWebContents(overlayWindow)
  // screen-saver level keeps overlay above conferencing app overlays on Windows
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  // Always forward mouse events so overlay can use CSS pointer-events for precise hit regions
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    overlayWindow.loadURL(`${devUrl}/overlay-window/index.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay-window/index.html'))
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
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
  createOverlayWindow()

  // ── Mouse pass-through + heartbeat ─────────────────────────────────────────
  // Dynamically toggle setIgnoreMouseEvents so the overlay only intercepts
  // clicks when the cursor is actually inside the window bounds.
  let lastIgnoreState = true

  heartbeatTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return

    // Restore overlay if it was hidden by OS/conferencing app
    if (overlayUserVisible && !overlayWindow.isVisible()) {
      overlayWindow.show()
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
      updateTrayMenu()  // visibility changed → refresh the tray label
      lastIgnoreState = true
    }

    if (!overlayWindow.isVisible()) return

    const { x: cx, y: cy } = screen.getCursorScreenPoint()
    const bounds = overlayWindow.getBounds()
    const isOver = cx >= bounds.x && cx < bounds.x + bounds.width && cy >= bounds.y && cy < bounds.y + bounds.height
    const shouldIgnore = !isOver

    if (shouldIgnore !== lastIgnoreState) {
      overlayWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true })
      lastIgnoreState = shouldIgnore
    }
  }, 50)

  // ── System tray ──────────────────────────────────────────────────────────────
  const iconPath = join(__dirname, '../../resources/icon.png')
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('Helper')

  const updateTrayMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: overlayWindow?.isVisible() ? '隐藏覆盖层' : '显示覆盖层',
        click: () => {
          if (overlayWindow?.isVisible()) { overlayUserVisible = false; overlayWindow.hide() }
          else { overlayUserVisible = true; overlayWindow?.show() }
          updateTrayMenu()  // rebuild so the label reflects the new visibility
        }
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
    tray?.setContextMenu(menu)
  }
  updateTrayMenu()

  tray.on('click', () => {
    restoreMainWindow()
  })

  // Restore saved overlay position, clamped to a visible display — a stale off-screen
  // position (e.g. after a resolution change) would otherwise lose the window.
  if (overlayWindow && saved.overlayX !== undefined && saved.overlayY !== undefined) {
    const [w, h] = overlayWindow.getSize()
    const area = screen.getDisplayMatching({ x: saved.overlayX, y: saved.overlayY, width: w, height: h }).workArea
    const x = Math.round(Math.min(Math.max(saved.overlayX, area.x), area.x + area.width - w))
    const y = Math.round(Math.min(Math.max(saved.overlayY, area.y), area.y + area.height - h))
    overlayWindow.setPosition(x, y)
  }

  // Save overlay position whenever it's moved
  overlayWindow?.on('moved', () => {
    if (!overlayWindow) return
    const [x, y] = overlayWindow.getPosition()
    const { overlayX: _x, overlayY: _y, ...rest } = loadPersistedConfig()
    persistConfig({ ...rest, overlayX: x, overlayY: y })
  })

  // Apply saved overlay opacity
  if (overlayWindow && saved.overlayOpacity !== undefined) {
    overlayWindow.webContents.send('overlay:opacity', saved.overlayOpacity)
  }

  registerShortcut('CommandOrControl+Alt+H', () => {
    if (!overlayWindow) return
    if (overlayWindow.isVisible()) { overlayUserVisible = false; overlayWindow.hide() }
    else { overlayUserVisible = true; overlayWindow.show() }
    updateTrayMenu()  // keep the tray label in sync with overlay visibility
  })

  // ⌘⌥M — 切换主控制台窗口显隐
  registerShortcut('CommandOrControl+Alt+M', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide()
    else restoreMainWindow()  // null/已销毁时也能重建唤回
  })

  // ⌘⌥Q — 真正退出（关主窗口已改为隐藏）
  registerShortcut('CommandOrControl+Alt+Q', () => {
    isQuitting = true
    app.quit()
  })

  // ⌘⌥X — clear answer (changed from C which conflicts with B站)
  registerShortcut('CommandOrControl+Alt+X', () => {
    stopStreaming()  // abort any in-flight stream so it doesn't keep generating into an empty UI
    clearHistory()
    overlayWindow?.webContents.send('llm:clear')
  })

  // Toggle ASR: ⌘⌥K starts/stops recording. The renderer (VoiceTab) is the single
  // source of truth for "am I recording" — we just nudge it to flip. A main-side
  // boolean would drift out of sync whenever capture stops on its own (device
  // unplugged, failed start), inverting start/stop and misaligning the recorded clip.
  registerShortcut('CommandOrControl+Alt+K', () => {
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

  // Capture overlay window directly via capturePage() — bypasses content protection
  registerShortcut('CommandOrControl+Alt+O', async () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    try {
      const image = await overlayWindow.capturePage()
      let captured: Electron.NativeImage = image
      const maxSize = 2000
      const { width, height } = captured.getSize()
      if (width > maxSize || height > maxSize) {
        const scale = maxSize / Math.max(width, height)
        captured = captured.resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
      }
      const imageBase64 = captured.toPNG().toString('base64')
      console.log(`[OverlayCapture] captured: ${width}x${height}, size: ${Math.round(imageBase64.length * 3 / 4 / 1024)}KB`)
      extractImageText(imageBase64, overlayWindow)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      overlayWindow.webContents.send('llm:error', { id: null, message: `overlay截图失败: ${msg}` })
    }
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
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  globalShortcut.unregisterAll()
})

// ── IPC: overlay mouse pass-through ──────────────────────────────────────────
ipcMain.on('overlay:set-ignore-mouse', (_e, ignore: boolean) => {
  overlayWindow?.setIgnoreMouseEvents(ignore, { forward: true })
})

// ── IPC: app status ───────────────────────────────────────────────────────────
ipcMain.handle('app:get-status', () => ({
  contentProtection: true,
  overlayVisible: overlayWindow?.isVisible() ?? false,
  platform: process.platform,
  version: app.getVersion(),
  failedShortcuts
}))

// ── IPC: config ───────────────────────────────────────────────────────────────
// Connectivity tests use the values passed from the settings form (may be unsaved)
ipcMain.handle('config:test-llm', (_e, cfg: { apiKey: string; baseUrl: string; model: string }) =>
  testLLMConnection(cfg)
)
ipcMain.handle('config:test-vision', (_e, cfg: { apiKey: string; baseUrl: string; visionModel: string }) =>
  testVisionConnection(cfg)
)
ipcMain.handle('config:test-asr', (_e, cfg: { apiKey: string; baseUrl: string; model: string }) =>
  testASRConnection(cfg)
)

ipcMain.handle('config:get', () => {
  const asr = getASRConfig()
  const persisted = loadPersistedConfig()
  return {
    ...getConfig(),
    asrApiKey: asr.apiKey,
    asrBaseUrl: asr.baseUrl,
    asrModel: asr.model,
    overlayOpacity: persisted.overlayOpacity ?? 0.94,
  }
})

ipcMain.on('config:set', (_e, partial) => {
  const p = partial as Record<string, unknown>
  // Log only field names — never the values (would leak API keys)
  console.log('[Config] received keys:', Object.keys(p).join(', '))
  // Update in-memory configs for immediate use
  const { asrApiKey, asrBaseUrl, asrModel, overlayOpacity, ...llmPartial } = p
  if (Object.keys(llmPartial).length) setConfig(llmPartial as Record<string, string>)
  if (asrApiKey !== undefined || asrBaseUrl !== undefined || asrModel !== undefined) {
    const cur = getASRConfig()
    setASRConfig({
      apiKey: asrApiKey !== undefined ? (asrApiKey as string) : cur.apiKey,
      baseUrl: asrBaseUrl !== undefined ? (asrBaseUrl as string) : cur.baseUrl,
      model: asrModel !== undefined ? (asrModel as string) : cur.model
    })
  }
  if (overlayOpacity !== undefined) {
    overlayWindow?.webContents.send('overlay:opacity', Number(overlayOpacity))
  }
  // Persist via read-modify-write: only overwrite fields actually provided, so a
  // partial update (e.g. the opacity slider) can never blank out a saved API key.
  const merged = loadPersistedConfig() as Record<string, unknown>
  for (const k of Object.keys(p)) {
    if (k === 'jobDescription') continue
    if (p[k] !== undefined) merged[k] = p[k]
  }
  if (overlayOpacity !== undefined) merged.overlayOpacity = Number(overlayOpacity)
  persistConfig(merged as Parameters<typeof persistConfig>[0])
})

// ── IPC: LLM ──────────────────────────────────────────────────────────────────
function waitForStreamEnd(callback: () => void): void {
  if (!isCurrentlyStreaming()) { callback(); return }
  let checks = 0
  const tick = () => {
    if (!isCurrentlyStreaming()) { callback(); return }
    if (++checks > 80) {   // 80 * 50ms = 4s max
      forceResetStreaming()
      callback()
      return
    }
    setTimeout(tick, 50)
  }
  tick()
}

ipcMain.on('llm:ask', (_e, question: string) => {
  if (!overlayWindow) return
  // Re-check at call time: when deferred via waitForStreamEnd (up to ~4s) the overlay could be
  // gone by the time start() runs, and streamAnswer would deref a destroyed window.
  const start = () => { if (overlayWindow && !overlayWindow.isDestroyed()) streamAnswer(question, overlayWindow) }
  if (isCurrentlyStreaming()) {
    stopStreaming()
    waitForStreamEnd(start)
    return
  }
  start()
})

ipcMain.on('llm:clear', () => {
  stopStreaming()  // abort any in-flight stream so it doesn't keep generating into an empty UI
  clearHistory()
  overlayWindow?.webContents.send('llm:clear')
})

ipcMain.on('llm:stop', () => {
  stopStreaming()
})

// Overlay sends extracted text → LLM answers
ipcMain.on('llm:ask-extracted', (_e, text: string) => {
  if (!overlayWindow) return
  const start = () => { if (overlayWindow && !overlayWindow.isDestroyed()) streamAnswer(text, overlayWindow) }
  if (isCurrentlyStreaming()) {
    stopStreaming()
    waitForStreamEnd(start)
  } else {
    start()
  }
})

// ── IPC: ASR control (main window → overlay) ──────────────────────────────────
// Main window sends start/stop commands; overlay runs SpeechRecognition
ipcMain.on('asr:start', () => overlayWindow?.webContents.send('asr:start'))
ipcMain.on('asr:stop', () => overlayWindow?.webContents.send('asr:stop'))

// Transcript arrives from the main window; forward it to the overlay's transcript panel.
// (The main window already shows its own draft locally, so it isn't echoed back here.)
ipcMain.on('asr:transcript', (_e, data: { text: string; isFinal: boolean }) => {
  overlayWindow?.webContents.send('asr:transcript', data)
})

// Overlay asks main to auto-submit a transcribed question to LLM
ipcMain.on('asr:auto-ask', (_e, question: string) => {
  if (!overlayWindow) return
  const start = () => { if (overlayWindow && !overlayWindow.isDestroyed()) streamAnswer(question, overlayWindow) }
  if (isCurrentlyStreaming()) {
    stopStreaming()
    waitForStreamEnd(start)
    return
  }
  start()
})

// Overlay sends audio chunk → Whisper API → returns text
ipcMain.handle('asr:transcribe', async (_e, audio: ArrayBuffer, mimeType: string, lang: string) => {
  const buf = Buffer.from(audio)
  return transcribeAudio(buf, mimeType, lang || '')
})

// Overlay requests clipboard copy
ipcMain.on('clipboard:copy', (_e, text: string) => {
  clipboard.writeText(text)
})

// ── IPC: screenshot / coding mode ────────────────────────────────────────────

ipcMain.on('screenshot:submit', async (_e, region: { x: number; y: number; w: number; h: number; vw?: number; vh?: number }) => {
  // Close the selector FIRST — otherwise its "截图中..." can stay stuck if anything below fails
  selectorWindow?.close()
  if (!overlayWindow) return

  try {
    // Crop against the display the selector actually covered (multi-monitor) — not always primary.
    const display = screen.getAllDisplays().find((d) => d.id === selectorDisplayId) ?? screen.getPrimaryDisplay()
    const { width, height } = display.bounds  // logical pixels (same space as selector coords)

    // Timeout guard — desktopCapturer can hang on macOS without screen recording permission
    const capturePromise = desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * display.scaleFactor), height: Math.round(height * display.scaleFactor) }
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('截图超时，请检查屏幕录制权限')), 10000)
    )
    const sources = await Promise.race([capturePromise, timeoutPromise])

    // Pick the source matching our display — desktopCapturer doesn't guarantee sources[0] is it.
    const source = sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0]
    if (!source) throw new Error('无法获取屏幕截图')

    const thumb = source.thumbnail
    const tsize = thumb.getSize()
    if (tsize.width === 0 || tsize.height === 0) {
      throw new Error('截屏内容为空 —— 请到 系统设置 → 隐私与安全性 → 屏幕录制，给运行本应用的程序（开发时是终端/VS Code，打包后是 Helper）授权后重启')
    }

    // Map selector(viewport) coords → thumbnail pixels using the selector's OWN reported
    // viewport size. display.bounds can differ from the actual viewport on notched/scaled
    // Macs, which would push the crop past the thumbnail edge and clip the right/bottom.
    const vw = region.vw || width
    const vh = region.vh || height
    const scaleX = tsize.width / vw
    const scaleY = tsize.height / vh
    const cx = Math.max(0, Math.round(region.x * scaleX))
    const cy = Math.max(0, Math.round(region.y * scaleY))
    const cw = Math.min(Math.round(region.w * scaleX), tsize.width - cx)
    const ch = Math.min(Math.round(region.h * scaleY), tsize.height - cy)
    console.log(`[Screenshot] region ${region.w}x${region.h}@${region.x},${region.y} · vw=${vw}x${vh} · thumb=${tsize.width}x${tsize.height} · crop=${cw}x${ch}@${cx},${cy}`)
    let cropped = thumb.crop({ x: cx, y: cy, width: cw, height: ch })

    // Downscale if too large — keeps API calls fast and avoids timeouts
    const maxSize = 2000
    const cropW = cropped.getSize().width
    const cropH = cropped.getSize().height
    if (cropW > maxSize || cropH > maxSize) {
      const scale = maxSize / Math.max(cropW, cropH)
      cropped = cropped.resize({ width: Math.round(cropW * scale), height: Math.round(cropH * scale) })
    }

    const imageBase64 = cropped.toPNG().toString('base64')
    console.log(`[Screenshot] region ${region.w}x${region.h} → ${cropped.getSize().width}x${cropped.getSize().height}, thumb ${tsize.width}x${tsize.height}, ${Math.round(imageBase64.length * 3 / 4 / 1024)}KB`)

    // Step 1: Extract text from image via vision model
    extractImageText(imageBase64, overlayWindow)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    overlayWindow?.webContents.send('image:error', `截图失败: ${msg}`)
  }
})
