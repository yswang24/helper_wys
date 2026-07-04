import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from 'electron'
import { join } from 'path'

// The overlay surface the tray menu needs. Injected (lazily) so WindowManager and
// OverlayController can reference each other without a construction-order cycle.
export interface OverlayBridge {
  isVisible: () => boolean
  isInteractive: () => boolean
  toggleVisibility: () => void
  ensureShownAndToggleMode: () => void
}

export interface WindowManagerDeps {
  hardenWebContents: (win: BrowserWindow) => void
  setMainWindow: (win: BrowserWindow | null) => void
  overlay: OverlayBridge
}

// Owns the main window, the screenshot selector window, and the tray. Every method is a verbatim
// move of the former index.ts functions. isQuitting/isCapturing are read by index.ts's app
// lifecycle handlers (activate/before-quit) so they stay authoritative here.
export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private selectorWindow: BrowserWindow | null = null
  private selectorDisplayId: number | null = null
  private tray: Tray | null = null
  private quitting = false // distinguishes "hide main window" from a real app quit
  private capturing = false // true while the screenshot selector is up — suppresses activate→restore

  constructor(private deps: WindowManagerDeps) {}

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }
  getSelectorWindow(): BrowserWindow | null {
    return this.selectorWindow
  }
  getSelectorDisplayId(): number | null {
    return this.selectorDisplayId
  }
  isQuitting(): boolean {
    return this.quitting
  }
  setQuitting(v: boolean): void {
    this.quitting = v
  }
  isCapturing(): boolean {
    return this.capturing
  }

  createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 460,
      height: 820,
      minWidth: 400,
      minHeight: 600,
      title: 'Helper',
      backgroundColor: '#0f0f14',
      skipTaskbar: true, // 不显示在任务栏
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // 录音的 MediaRecorder 跑在本窗口里,而本窗口常被隐藏(点 X 关闭即隐藏)。默认后台节流会
        // 掐住隐藏窗口的编码管线,导致录到的音频近乎静音。必须关掉。
        backgroundThrottling: false
      }
    })
    const mainWindow = this.mainWindow

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      mainWindow.loadURL(`${devUrl}/main-window/index.html`)
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/main-window/index.html'))
    }

    mainWindow.setContentProtection(true) // Invisible to screen capture (safety net)
    this.deps.hardenWebContents(mainWindow)
    // Let llm.ts mirror stream lifecycle here so the Ask tab button tracks real progress.
    this.deps.setMainWindow(mainWindow)

    // 点 X → 仅隐藏主窗口,应用继续在托盘后台运行;真正退出走托盘菜单
    mainWindow.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault()
        this.mainWindow?.hide()
      }
    })

    mainWindow.on('closed', () => {
      this.mainWindow = null
      this.deps.setMainWindow(null)
    })
  }

  // 统一的"把主窗口唤回前台"入口。Dock/托盘点击都走这里,保证 null/已销毁/屏幕外 三种边界都被处理。
  restoreMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      // 窗口已真正销毁,只可能发生在一次没走完的退出之后。重建前清掉退出标记,
      // 否则新窗口继承 isQuitting=true,下次点 X 会变成真关而非隐藏。
      this.quitting = false
      this.createMainWindow()
      return
    }
    // 把窗口夹回某个仍连接的显示器可视区域内,避免它停在屏幕外(show 了却看不见)。
    const b = this.mainWindow.getBounds()
    const area = screen.getDisplayMatching(b).workArea
    this.mainWindow.setBounds({
      x: Math.round(Math.min(Math.max(b.x, area.x), area.x + area.width - b.width)),
      y: Math.round(Math.min(Math.max(b.y, area.y), area.y + area.height - b.height)),
      width: b.width,
      height: b.height
    })
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  createTray(): void {
    const iconPath = join(__dirname, '../../resources/icon.png')
    const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('Helper')
    this.updateTrayMenu()
    this.tray.on('click', () => this.restoreMainWindow())
  }

  // Rebuild the tray menu so its overlay show/hide + mode labels match current state.
  updateTrayMenu(): void {
    if (!this.tray) return
    const menu = Menu.buildFromTemplate([
      {
        label: this.deps.overlay.isVisible() ? '隐藏覆盖层' : '显示覆盖层',
        click: () => this.deps.overlay.toggleVisibility()
      },
      {
        label: this.deps.overlay.isInteractive()
          ? '切到穿透模式（不抢焦点）'
          : '切到输入模式（可打字·会切屏）',
        click: () => this.deps.overlay.ensureShownAndToggleMode()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          this.quitting = true
          app.quit()
        }
      }
    ])
    this.tray.setContextMenu(menu)
  }

  // ⌘⌥S: toggle the region selector.
  toggleSelector(): void {
    if (this.selectorWindow) {
      this.selectorWindow.close()
      return
    }
    this.createSelectorWindow()
  }

  private createSelectorWindow(): void {
    this.capturing = true // belt-and-suspenders: also suppress app.on('activate')
    // Cover the display the cursor is on (not always primary), using its real origin.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { x, y, width, height } = display.bounds
    this.selectorDisplayId = display.id

    this.selectorWindow = new BrowserWindow({
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
      // Non-activating panel: floats over the exam and takes drags WITHOUT switching the foreground
      // app away from the browser (activating our app is what the exam detects as 切屏/blur).
      type: 'panel',
      focusable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const selectorWindow = this.selectorWindow

    selectorWindow.setContentProtection(true) // invisible to screen capture
    selectorWindow.setIgnoreMouseEvents(false)
    this.deps.hardenWebContents(selectorWindow)
    selectorWindow.setAlwaysOnTop(true, 'screen-saver')
    selectorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Main-side dismissal fallbacks: guarantee Escape / load failure can still close it.
    selectorWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.selectorWindow?.close()
    })
    selectorWindow.webContents.on('did-fail-load', () => this.selectorWindow?.close())

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      selectorWindow.loadURL(`${devUrl}/selector-window/index.html`)
    } else {
      selectorWindow.loadFile(join(__dirname, '../renderer/selector-window/index.html'))
    }

    // Show WITHOUT activating our app — the exam/browser stays foreground (no 切屏)
    selectorWindow.showInactive()

    selectorWindow.on('closed', () => {
      this.selectorWindow = null
      this.selectorDisplayId = null
      // Re-assert the Dock icon — closing the transient panel can drop it.
      if (process.platform === 'darwin') void app.dock?.show()
      // Defer: a re-activation fired as the selector closes must not trigger restoreMainWindow.
      setTimeout(() => {
        this.capturing = false
      }, 300)
    })
  }
}
