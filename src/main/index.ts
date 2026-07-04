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
import { registerOverlayIpc, type OverlayDragStart } from './ipc/overlay'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let selectorWindow: BrowserWindow | null = null
let selectorDisplayId: number | null = null  // which display the active selector covers (multi-monitor)
let tray: Tray | null = null
let overlayUserVisible = true  // tracks whether user wants overlay visible
let isQuitting = false  // distinguishes "hide main window" from a real app quit
let isCapturing = false // true while the screenshot selector is up — suppresses activate→restore
let heartbeatTimer: ReturnType<typeof setInterval> | null = null  // overlay mouse/restore heartbeat
let overlayRebuildCount = 0  // consecutive crash-rebuilds; reset on a successful load, capped to stop a loop
// 悬浮窗交互模式:false=穿透/展示(默认,不激活本 app、点击穿到下层、不触发前台切屏);
// true=交互/输入(可拿键盘,进入时会 focus() 激活本 app 一次——唯一有意的切屏)。
let overlayInteractive = false
// 手动拖动悬浮窗(仅输入模式,穿透模式收不到鼠标故拖不动)。用手动拖代替 -webkit-app-region:drag——
// 后者在 透明+无边框+panel+运行时 setIgnoreMouseEvents 切换 的组合下不可靠。非 null 即正在拖动:
// 记录按下时的窗口位与鼠标屏幕坐标(取自渲染层事件,避开 IPC 采样延迟),按位移 setPosition;
// moved 标记是否已越过点击阈值——未越过就当"点击"、不移动窗口(否则每次点击都会跳一下)。
let overlayDragStart: OverlayDragStart | null = null
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
      label: overlayWindow?.isVisible() ? '隐藏覆盖层' : '显示覆盖层',
      click: () => {
        if (overlayWindow?.isVisible()) { overlayUserVisible = false; overlayWindow.hide() }
        else { overlayUserVisible = true; overlayWindow?.showInactive() }  // 非激活显示,不切屏
        updateTrayMenu()
      }
    },
    {
      label: overlayInteractive ? '切到穿透模式（不抢焦点）' : '切到输入模式（可打字·会切屏）',
      click: () => {
        if (overlayWindow && !overlayWindow.isVisible()) { overlayUserVisible = true; overlayWindow.showInactive() }
        applyOverlayMode(!overlayInteractive)
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
  tray.setContextMenu(menu)
}

// Make sure answers are actually seen: if the overlay is hidden (user pressed ⌘⌥H, or the OS hid
// it) when a stream/OCR starts, the answer would stream into nothing — the heartbeat only auto-
// restores when overlayUserVisible is already true. Pull it back up before any answer begins.
function ensureOverlayVisible(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (!overlayWindow.isVisible()) {
    overlayUserVisible = true
    overlayWindow.showInactive()  // 不用 show():show() 会激活本 app → 触发前台窗口切屏
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.setContentProtection(true)  // hide→show 后内容保护可能丢失(E28),重设
    updateTrayMenu()
  }
}

// 切换悬浮窗的 穿透/输入 两种模式。关键:切模式本身【不激活/不失活 app】——只改 setFocusable +
// setIgnoreMouseEvents(都是廉价同步、不重绘)。之前每次切都 focus()/blur() 会让 app 激活/失活,
// 毛玻璃背景随之重新合成 → 肉眼"跳一下";连按还被 macOS 的激活节流拖慢。现在:
//  · 输入:setFocusable(true)+setIgnoreMouseEvents(false)。不在这里 focus();真正的键盘焦点(和那
//    一次有意的切屏)推迟到用户【点进悬浮窗】时由 macOS 的 click-to-focus 触发(配合构造里的
//    acceptFirstMouse:true,首击即可命中控件/输入框)。于是 ⌘⌥E 连切完全不激活、不跳、可秒切。
//  · 穿透:setIgnoreMouseEvents(true)+setFocusable(false)。【不调用 blur()】——E28 的 win.blur() 内部是
//    [orderOut:]+[orderBack:],把透明合成面摘下屏幕再贴回本层最底 → 肉眼"闪一下"(已从
//    native_window_mac.mm 源码确证;坐标探针测不到是因为 orderOut 只改 z 序、不改坐标)。前台焦点
//    交还浏览器,推迟到用户下次点浏览器时由 macOS click-to-focus 自然完成(那一刻的重合成也被点击掩盖)。
function applyOverlayMode(interactive: boolean): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayDragStart = null  // 取消进行中的拖动(防"拖到一半切模式"卡住窗口跟随光标)
  overlayInteractive = interactive
  const [px, py] = overlayWindow.getPosition()  // 切换前的屏幕位置
  if (interactive) {
    overlayWindow.setFocusable(true)
    overlayWindow.setIgnoreMouseEvents(false)
  } else {
    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.setFocusable(false)
    // 不 blur():win.blur()=[orderOut:]+[orderBack:] 会摘面重贴 → 闪。焦点靠用户下次点浏览器自然交还。
  }
  // 硬保证:切模式绝不改变窗口位置(要求:输入模式拖到左上角,切回穿透仍在左上角)。
  const [nx, ny] = overlayWindow.getPosition()
  if (nx !== px || ny !== py) overlayWindow.setPosition(px, py)
  overlayWindow.webContents.send('overlay:mode', interactive ? 'interactive' : 'passthrough')
  updateTrayMenu()
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
    // 默认进入"穿透/展示"模式:focusable:false → 点击悬浮窗不激活本 app(不切屏)。
    // 需要打字时用 ⌘⌥E / 托盘切到"输入"模式(applyOverlayMode 里 setFocusable(true))。
    focusable: false,
    // 输入模式下窗口尚未 key 时,首次点击靠 click-to-focus 激活;acceptFirstMouse 让这一击同时
    // 命中控件/输入框,而不是被当作纯激活点吞掉。
    acceptFirstMouse: true,
    show: false,  // 不用默认 show:true(会激活);加载完成后用 showInactive() 显示
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
  // 默认穿透:整窗点击穿到下层。无需 forward(不再做渲染层逐元素命中,徽标已是不可点指示器)。
  overlayWindow.setIgnoreMouseEvents(true)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    overlayWindow.loadURL(`${devUrl}/overlay-window/index.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay-window/index.html'))
  }

  // Restore the saved position (clamped to a still-connected display) + persist future moves HERE
  // rather than only at startup, so an overlay rebuilt after a crash lands where the user left it.
  // Opacity needs no re-send: the overlay renderer pulls it via getPublicConfig on mount.
  const persisted = loadPersistedConfig()
  if (persisted.overlayX !== undefined && persisted.overlayY !== undefined) {
    const [w, h] = overlayWindow.getSize()
    const area = screen.getDisplayMatching({ x: persisted.overlayX, y: persisted.overlayY, width: w, height: h }).workArea
    const x = Math.round(Math.min(Math.max(persisted.overlayX, area.x), area.x + area.width - w))
    const y = Math.round(Math.min(Math.max(persisted.overlayY, area.y), area.y + area.height - h))
    overlayWindow.setPosition(x, y)
  }

  overlayWindow.on('moved', () => {
    // 手动拖动过程中每帧 setPosition 都会触发 moved;拖动时不落盘,改由 drag-end 落一次,避免磁盘抖动。
    if (!overlayWindow || overlayDragStart) return
    const [x, y] = overlayWindow.getPosition()
    const { overlayX: _x, overlayY: _y, ...rest } = loadPersistedConfig()
    persistConfig({ ...rest, overlayX: x, overlayY: y })
  })

  // A clean load means the last (re)build succeeded — reset the crash-loop guard.
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayRebuildCount = 0
    // 构造用了 show:false → 加载完成后以非激活方式显示(不切屏)。重载/HMR 或崩溃重建后
    // 一并重新落实:内容保护(E28 hide→show 会丢失)、以及穿透态(reload 后 forward 可能失效)。
    if (overlayUserVisible && overlayWindow && !overlayWindow.isVisible()) overlayWindow.showInactive()
    overlayWindow?.setContentProtection(true)
    if (!overlayInteractive) overlayWindow?.setIgnoreMouseEvents(true)
  })

  // A renderer crash (GPU/OOM) can leave the BrowserWindow alive but dead — 'closed' never fires,
  // so every entry point (⌘⌥H, ask, screenshot) would silently no-op forever. Force-destroy it so
  // the 'closed' handler below rebuilds a working overlay.
  overlayWindow.webContents.on('render-process-gone', () => {
    if (isQuitting || !overlayWindow) return
    console.warn('[Overlay] render process gone — destroying to trigger rebuild')
    overlayWindow.destroy()
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
    // Without this, a crashed/closed overlay is gone until an app restart: the heartbeat, ⌘⌥H, and
    // every stream/screenshot entry point short-circuit on `if (!overlayWindow) return`, so answers
    // have nowhere to go — fatal mid-interview. Rebuild unless we're really quitting; cap retries
    // so a persistently-broken renderer can't spin forever.
    if (!isQuitting && overlayRebuildCount < 5) {
      overlayRebuildCount++
      setTimeout(() => { if (!isQuitting && !overlayWindow) createOverlayWindow() }, 500)
    }
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
  createOverlayWindow()

  // ── Mouse pass-through + heartbeat ─────────────────────────────────────────
  // Dynamically toggle setIgnoreMouseEvents so the overlay only intercepts
  // clicks when the cursor is actually inside the window bounds.
  // 心跳只负责"被 OS/会议软件强行隐藏后自动恢复可见"。点击穿透不再靠这里轮询整窗矩形
  // (旧做法会造成透明圆角处死点击、且无法区分模式),改由 applyOverlayMode 按模式整窗设定。
  heartbeatTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return

    // Restore overlay if it was hidden by OS/conferencing app
    if (overlayUserVisible && !overlayWindow.isVisible()) {
      overlayWindow.showInactive()  // 恢复也用非激活方式,避免切屏
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
      overlayWindow.setContentProtection(true)  // 恢复后重设内容保护(E28 hide→show 会丢)
      if (!overlayInteractive) overlayWindow.setIgnoreMouseEvents(true)  // 重新落实穿透态
      updateTrayMenu()  // visibility changed → refresh the tray label
    }
  }, 100)  // 10Hz: restore latency stays imperceptible while halving idle wakeups

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

  registerShortcut('CommandOrControl+Alt+H', () => {
    if (!overlayWindow) return
    if (overlayWindow.isVisible()) { overlayUserVisible = false; overlayWindow.hide() }
    else { overlayUserVisible = true; overlayWindow.showInactive() }  // 非激活显示,不切屏
    updateTrayMenu()  // keep the tray label in sync with overlay visibility
  })

  // 切换悬浮窗 穿透/输入 模式。穿透模式下悬浮窗收不到键盘,故切换必须走全局快捷键(或托盘)。
  registerShortcut('CommandOrControl+Alt+E', () => {
    if (!overlayWindow) return
    if (!overlayWindow.isVisible()) { overlayUserVisible = true; overlayWindow.showInactive() }
    applyOverlayMode(!overlayInteractive)
  })

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
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  globalShortcut.unregisterAll()
})

// ── IPC: overlay pass-through/mode + manual drag ─────────────────────────────
// Handlers live in ./ipc/overlay; drag state (overlayDragStart) stays here because
// applyOverlayMode clears it. Injected via getters so behavior is unchanged.
registerOverlayIpc({
  getOverlayWindow: () => overlayWindow,
  isInteractive: () => overlayInteractive,
  applyOverlayMode,
  getDragStart: () => overlayDragStart,
  setDragStart: (d) => {
    overlayDragStart = d
  },
  persistOverlayPos: (x, y) => {
    const { overlayX: _x, overlayY: _y, ...rest } = loadPersistedConfig()
    persistConfig({ ...rest, overlayX: x, overlayY: y })
  }
})

// ── IPC: app status ───────────────────────────────────────────────────────────
registerAppIpc({ getOverlayWindow: () => overlayWindow, failedShortcuts })

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
  sendOverlayOpacity: (opacity) => overlayWindow?.webContents.send('overlay:opacity', opacity)
})

// ── IPC: LLM ──────────────────────────────────────────────────────────────────
// Shared stream serialization (drain-then-start) lives in ./stream-safe.
const { startStreamSafely } = createStreamSafe({
  isCurrentlyStreaming,
  stopStreaming,
  forceResetStreaming,
  getOverlayWindow: () => overlayWindow,
  ensureOverlayVisible
})

registerLlmIpc({
  getOverlayWindow: () => overlayWindow,
  startStreamSafely,
  streamAnswer,
  stopStreaming,
  clearHistory
})

registerAsrIpc({
  getOverlayWindow: () => overlayWindow,
  startStreamSafely,
  streamAnswer,
  transcribeAudio
})

registerClipboardIpc()

// ── IPC: screenshot / coding mode ────────────────────────────────────────────

// Capture math + screencapture/desktopCapturer live in ./screenshot; the handler is registered
// here (module-eval, before windows exist) with getter deps so it always sees the live windows.
registerScreenshotIpc({
  getOverlayWindow: () => overlayWindow,
  getSelectorWindow: () => selectorWindow,
  getSelectorDisplayId: () => selectorDisplayId,
  ensureOverlayVisible,
  startStreamSafely,
  streamImageAnswer,
  extractImageText,
  loadPersistedConfig
})
