import { app, BrowserWindow, ipcMain, globalShortcut, session, desktopCapturer, screen, clipboard, Tray, Menu, nativeImage } from 'electron'

declare module 'electron' {
  interface App { isQuitting: boolean }
}
import { join } from 'path'
import { File as NodeFile } from 'node:buffer'
// Node 18 doesn't expose File as a global; openai SDK requires it for multipart uploads
;(globalThis as unknown as Record<string, unknown>).File ??= NodeFile

import { streamAnswer, streamImageAnswer, extractImageText, stopStreaming, forceResetStreaming, isCurrentlyStreaming, setConfig, getConfig, type HistoryRound } from './llm'
import { transcribeAudio, setASRConfig, getASRConfig } from './asr'
import { loadPersistedConfig, persistConfig } from './store'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let selectorWindow: BrowserWindow | null = null
let tray: Tray | null = null
let overlayUserVisible = true  // tracks whether user wants overlay visible
let lastScreenshotBase64: string | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 820,
    minWidth: 400,
    minHeight: 600,
    title: 'Interview Assistant',
    backgroundColor: '#0f0f14',
    skipTaskbar: true,   // 不显示在任务栏
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
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

  // 点 X 关闭按钮 → 隐藏主窗口 + 悬浮窗到托盘，不退出
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      overlayUserVisible = false
      mainWindow?.hide()
      overlayWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
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
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.bounds

  selectorWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Must be content-protected so the selection UI is invisible to screen capture
  selectorWindow.setContentProtection(true)
  selectorWindow.setIgnoreMouseEvents(false)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    selectorWindow.loadURL(`${devUrl}/selector-window/index.html`)
  } else {
    selectorWindow.loadFile(join(__dirname, '../renderer/selector-window/index.html'))
  }

  selectorWindow.on('closed', () => {
    selectorWindow = null
  })
}

app.whenReady().then(() => {
  // Restore user settings from disk
  const saved = loadPersistedConfig()
  if (Object.keys(saved).length) setConfig(saved)
  if (saved.asrApiKey || saved.asrBaseUrl || saved.asrModel) {
    setASRConfig({
      apiKey: saved.asrApiKey ?? '',
      baseUrl: saved.asrBaseUrl ?? 'https://api.openai.com/v1',
      model: saved.asrModel ?? 'whisper-1'
    })
  }

  // Intercept getDisplayMedia → return first screen + WASAPI loopback audio (Windows)
  // useSystemPicker:false required in Electron 25+ so our handler runs immediately without OS picker
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(session.defaultSession.setDisplayMediaRequestHandler as any)(
    async (_request: unknown, callback: (r: unknown) => void) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      callback({ video: sources[0], audio: 'loopback' })
    },
    { useSystemPicker: false }
  )

  // Allow all permissions (media capture etc)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })

  session.defaultSession.setPermissionCheckHandler(() => true)

  createMainWindow()
  createOverlayWindow()

  // ── Mouse pass-through + heartbeat ─────────────────────────────────────────
  // Dynamically toggle setIgnoreMouseEvents so the overlay only intercepts
  // clicks when the cursor is actually inside the window bounds.
  let lastIgnoreState = true

  setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return

    // Restore overlay if it was hidden by OS/conferencing app
    if (overlayUserVisible && !overlayWindow.isVisible()) {
      overlayWindow.show()
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
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
  tray.setToolTip('Interview Assistant')

  const updateTrayMenu = () => {
    const visible = mainWindow?.isVisible() ?? false
    const menu = Menu.buildFromTemplate([
      {
        label: visible ? '隐藏设置窗口' : '显示设置窗口',
        click: () => {
          if (mainWindow?.isVisible()) mainWindow.hide()
          else { mainWindow?.show(); mainWindow?.focus() }
          updateTrayMenu()
        }
      },
      {
        label: overlayWindow?.isVisible() ? '隐藏覆盖层' : '显示覆盖层',
        click: () => {
          if (overlayWindow?.isVisible()) { overlayUserVisible = false; overlayWindow.hide() }
          else { overlayUserVisible = true; overlayWindow?.show() }
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true
          app.quit()
        }
      }
    ])
    tray?.setContextMenu(menu)
  }
  updateTrayMenu()

  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide()
    else { mainWindow?.show(); mainWindow?.focus() }
    updateTrayMenu()
  })

  // Restore saved overlay position
  if (overlayWindow && saved.overlayX !== undefined && saved.overlayY !== undefined) {
    overlayWindow.setPosition(saved.overlayX, saved.overlayY)
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

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!overlayWindow) return
    if (overlayWindow.isVisible()) { overlayUserVisible = false; overlayWindow.hide() }
    else { overlayUserVisible = true; overlayWindow.show() }
  })

  // Ctrl+Shift+M — 显示/隐藏设置主窗口
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow?.isVisible()) mainWindow.hide()
    else { mainWindow?.show(); mainWindow?.focus() }
  })

  // Ctrl+Shift+X — clear answer (changed from C which conflicts with B站)
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    overlayWindow?.webContents.send('llm:clear')
  })

  // Toggle ASR listening — notify main window to start/stop capture, overlay for indicator
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    mainWindow?.webContents.send('asr:toggle')
    overlayWindow?.webContents.send('asr:toggle')
  })

  // Activate region selector for coding screenshot
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (selectorWindow) {
      selectorWindow.close()
      return
    }
    createSelectorWindow()
  })

  // Capture overlay window directly via capturePage() — bypasses content protection
  globalShortcut.register('CommandOrControl+Shift+O', async () => {
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
      lastScreenshotBase64 = imageBase64
      console.log(`[OverlayCapture] captured: ${width}x${height}, size: ${Math.round(imageBase64.length * 3 / 4 / 1024)}KB`)
      extractImageText(imageBase64, overlayWindow)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      overlayWindow.webContents.send('llm:error', `overlay截图失败: ${msg}`)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
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
  version: app.getVersion()
}))

// ── IPC: config ───────────────────────────────────────────────────────────────
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
  console.log('[Config] received:', partial)
  // Split LLM vs ASR fields
  const { asrApiKey, asrBaseUrl, asrModel, overlayOpacity, ...llmPartial } = partial as Record<string, unknown>
  if (Object.keys(llmPartial).length) setConfig(llmPartial as Record<string, string>)
  if (asrApiKey !== undefined || asrBaseUrl !== undefined || asrModel !== undefined) {
    setASRConfig({ apiKey: asrApiKey as string, baseUrl: asrBaseUrl as string, model: asrModel as string })
  }
  if (overlayOpacity !== undefined) {
    const op = parseFloat(overlayOpacity as string)
    overlayWindow?.webContents.send('overlay:opacity', op)
  }
  // Persist both sets, skip jobDescription
  const { jobDescription: _jd, ...llmSaveable } = getConfig()
  const asrSaveable = getASRConfig()
  const persisted = loadPersistedConfig()
  persistConfig({
    ...llmSaveable,
    asrApiKey: asrSaveable.apiKey,
    asrBaseUrl: asrSaveable.baseUrl,
    asrModel: asrSaveable.model,
    overlayX: persisted.overlayX,
    overlayY: persisted.overlayY,
    overlayOpacity: overlayOpacity !== undefined ? parseFloat(overlayOpacity as string) : persisted.overlayOpacity,
  })
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

ipcMain.on('llm:ask', (_e, question: string, history: HistoryRound[] = []) => {
  if (!overlayWindow) return
  const start = () => streamAnswer(question, overlayWindow!, history)
  if (isCurrentlyStreaming()) {
    stopStreaming()
    waitForStreamEnd(start)
    return
  }
  start()
})

ipcMain.on('llm:clear', () => {
  overlayWindow?.webContents.send('llm:clear')
})

ipcMain.on('llm:stop', () => {
  stopStreaming()
})

ipcMain.on('llm:reask-image', (_e, userContext: string) => {
  if (!overlayWindow) return
  if (!lastScreenshotBase64) {
    overlayWindow.webContents.send('llm:error', '没有缓存的截图，请先截图')
    return
  }
  const startImage = () => streamImageAnswer(lastScreenshotBase64!, overlayWindow!, userContext)
  if (isCurrentlyStreaming()) {
    stopStreaming()
    waitForStreamEnd(startImage)
  } else {
    startImage()
  }
})

// Overlay sends extracted text → LLM answers
ipcMain.on('llm:ask-extracted', (_e, text: string, history: HistoryRound[] = []) => {
  if (!overlayWindow) return
  const start = () => streamAnswer(text, overlayWindow!, history)
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

// Transcript arrives from main window, forward to both overlay (display) and main window (transcript log)
ipcMain.on('asr:transcript', (_e, data: { text: string; isFinal: boolean }) => {
  overlayWindow?.webContents.send('asr:transcript', data)
})

// Overlay asks main to auto-submit a transcribed question to LLM
ipcMain.on('asr:auto-ask', (_e, question: string) => {
  if (!overlayWindow) return
  const start = () => streamAnswer(question, overlayWindow!)
  if (isCurrentlyStreaming()) {
    stopStreaming()
    waitForStreamEnd(start)
    return
  }
  start()
})

// Main window sets ASR language; forward to overlay
ipcMain.on('asr:set-lang', (_e, lang: string) => {
  overlayWindow?.webContents.send('asr:lang-changed', lang)
})

// Main window sets audio source (mic | system); forward to overlay
ipcMain.on('asr:set-source', (_e, source: string) => {
  overlayWindow?.webContents.send('asr:source-changed', source)
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
ipcMain.on('screenshot:cancel', () => {
  selectorWindow?.close()
})

ipcMain.on('screenshot:submit', async (_e, region: { x: number; y: number; w: number; h: number }) => {
  if (!overlayWindow) return

  try {
    // Close selector immediately — it has content protection so won't affect capture
    selectorWindow?.close()

    const display = screen.getPrimaryDisplay()
    const sf = display.scaleFactor  // e.g. 1.25 on 125% DPI
    const { width, height } = display.bounds  // logical pixels

    // Timeout guard — desktopCapturer can hang on macOS without screen recording permission
    const capturePromise = desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) }
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('截图超时，请检查屏幕录制权限')), 10000)
    )
    const sources = await Promise.race([capturePromise, timeoutPromise])

    const source = sources[0]
    if (!source) throw new Error('无法获取屏幕截图')

    // DEBUG: save full screenshot
    const fs = require('fs')
    fs.writeFileSync('/tmp/screenshot_full.png', source.thumbnail.toPNG())
    console.log(`[Screenshot] full screen: ${source.thumbnail.getSize().width}x${source.thumbnail.getSize().height}`)

    // Region coords from renderer are logical pixels — scale to physical pixels
    let cropped = source.thumbnail.crop({
      x: Math.round(region.x * sf),
      y: Math.round(region.y * sf),
      width: Math.round(region.w * sf),
      height: Math.round(region.h * sf)
    })

    // Downscale if too large — keeps API calls fast and avoids timeouts
    const maxSize = 2000
    const cropW = cropped.getSize().width
    const cropH = cropped.getSize().height
    if (cropW > maxSize || cropH > maxSize) {
      const scale = maxSize / Math.max(cropW, cropH)
      cropped = cropped.resize({ width: Math.round(cropW * scale), height: Math.round(cropH * scale) })
    }

    const imageBase64 = cropped.toPNG().toString('base64')
    lastScreenshotBase64 = imageBase64
    console.log(`[Screenshot] captured: ${region.w}x${region.h}, original: ${cropW}x${cropH}, sent: ${cropped.getSize().width}x${cropped.getSize().height}, size: ${Math.round(imageBase64.length * 3 / 4 / 1024)}KB`)
    fs.writeFileSync('/tmp/screenshot_debug.b64', imageBase64)
    fs.writeFileSync('/tmp/screenshot_debug.png', cropped.toPNG())
    console.log('[Screenshot] DEBUG: saved to /tmp/screenshot_debug.png and /tmp/screenshot_debug.b64')

    // Step 1: Extract text from image via vision model
    extractImageText(imageBase64, overlayWindow!)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    overlayWindow?.webContents.send('llm:error', `截图失败: ${msg}`)
  }
})
