import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { EVENT } from '../shared/ipc'
import type { PersistedConfig } from '../shared/config'
import type { OverlayDragStart } from './ipc/overlay'

// Single owner of the stealth overlay and its two-mode (passthrough/interactive) invariants.
// Every method is a VERBATIM move of the former index.ts functions — the fragile focus/content-
// protection discipline (always showInactive, never show/focus/blur, re-assert contentProtection
// after show/rebuild, heartbeat restore only inside the hidden-branch) is preserved exactly.

export interface OverlayControllerDeps {
  loadPersistedConfig: () => PersistedConfig
  persistConfig: (cfg: PersistedConfig) => void
  hardenWebContents: (win: BrowserWindow) => void
  isQuitting: () => boolean
  onVisibilityChange: () => void // → updateTrayMenu
}

export class OverlayController {
  private win: BrowserWindow | null = null
  private userVisible = true // tracks whether user wants overlay visible
  private interactive = false // false=passthrough (default), true=input
  private dragStart: OverlayDragStart | null = null
  private rebuildCount = 0 // consecutive crash-rebuilds; reset on a clean load, capped
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(private deps: OverlayControllerDeps) {}

  getWindow(): BrowserWindow | null {
    return this.win
  }
  isVisible(): boolean {
    return this.win?.isVisible() ?? false
  }
  isInteractive(): boolean {
    return this.interactive
  }
  getDragStart(): OverlayDragStart | null {
    return this.dragStart
  }
  setDragStart(d: OverlayDragStart | null): void {
    this.dragStart = d
  }

  create(): void {
    this.win = new BrowserWindow({
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
      focusable: false,
      // 输入模式下窗口尚未 key 时,首次点击靠 click-to-focus 激活;acceptFirstMouse 让这一击同时命中控件。
      acceptFirstMouse: true,
      show: false, // 不用默认 show:true(会激活);加载完成后用 showInactive() 显示
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const overlayWindow = this.win

    // Invisible to all screen capture (DXGI / getDisplayMedia / OBS)
    overlayWindow.setContentProtection(true)
    this.deps.hardenWebContents(overlayWindow)
    // screen-saver level keeps overlay above conferencing app overlays on Windows
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    // 默认穿透:整窗点击穿到下层。
    overlayWindow.setIgnoreMouseEvents(true)

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      overlayWindow.loadURL(`${devUrl}/overlay-window/index.html`)
    } else {
      overlayWindow.loadFile(join(__dirname, '../renderer/overlay-window/index.html'))
    }

    // Restore the saved position (clamped to a still-connected display) + persist future moves HERE
    // so an overlay rebuilt after a crash lands where the user left it.
    const persisted = this.deps.loadPersistedConfig()
    if (persisted.overlayX !== undefined && persisted.overlayY !== undefined) {
      const [w, h] = overlayWindow.getSize()
      const area = screen.getDisplayMatching({
        x: persisted.overlayX,
        y: persisted.overlayY,
        width: w,
        height: h
      }).workArea
      const x = Math.round(Math.min(Math.max(persisted.overlayX, area.x), area.x + area.width - w))
      const y = Math.round(Math.min(Math.max(persisted.overlayY, area.y), area.y + area.height - h))
      overlayWindow.setPosition(x, y)
    }

    overlayWindow.on('moved', () => {
      // 手动拖动过程中每帧 setPosition 都会触发 moved;拖动时不落盘,改由 drag-end 落一次。
      if (!this.win || this.dragStart) return
      const [x, y] = this.win.getPosition()
      const { overlayX: _x, overlayY: _y, ...rest } = this.deps.loadPersistedConfig()
      this.deps.persistConfig({ ...rest, overlayX: x, overlayY: y })
    })

    // A clean load means the last (re)build succeeded — reset the crash-loop guard.
    overlayWindow.webContents.on('did-finish-load', () => {
      this.rebuildCount = 0
      // show:false → 加载完成后非激活显示(不切屏)。崩溃重建/HMR 后重新落实内容保护 + 穿透态。
      if (this.userVisible && this.win && !this.win.isVisible()) this.win.showInactive()
      this.win?.setContentProtection(true)
      if (!this.interactive) this.win?.setIgnoreMouseEvents(true)
    })

    // A renderer crash can leave the BrowserWindow alive but dead — 'closed' never fires. Force-
    // destroy so the 'closed' handler rebuilds a working overlay.
    overlayWindow.webContents.on('render-process-gone', () => {
      if (this.deps.isQuitting() || !this.win) return
      console.warn('[Overlay] render process gone — destroying to trigger rebuild')
      this.win.destroy()
    })

    overlayWindow.on('closed', () => {
      this.win = null
      // Rebuild unless we're really quitting; cap retries so a broken renderer can't spin forever.
      if (!this.deps.isQuitting() && this.rebuildCount < 5) {
        this.rebuildCount++
        setTimeout(() => {
          if (!this.deps.isQuitting() && !this.win) this.create()
        }, 500)
      }
    })
  }

  // Pull the overlay back up before any answer begins (a hidden overlay would swallow the stream).
  ensureVisible(): void {
    if (!this.win || this.win.isDestroyed()) return
    if (!this.win.isVisible()) {
      this.userVisible = true
      this.win.showInactive() // 不用 show():show() 会激活本 app → 触发前台窗口切屏
      this.win.setAlwaysOnTop(true, 'screen-saver')
      this.win.setContentProtection(true) // hide→show 后内容保护可能丢失(E28),重设
      this.deps.onVisibilityChange()
    }
  }

  // 切换 穿透/输入 两种模式。切模式本身不激活/不失活 app——只改 setFocusable + setIgnoreMouseEvents。
  applyMode(interactive: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    this.dragStart = null // 取消进行中的拖动(防"拖到一半切模式"卡住窗口跟随光标)
    this.interactive = interactive
    const [px, py] = this.win.getPosition() // 切换前的屏幕位置
    if (interactive) {
      this.win.setFocusable(true)
      this.win.setIgnoreMouseEvents(false)
    } else {
      this.win.setIgnoreMouseEvents(true)
      this.win.setFocusable(false)
      // 不 blur():win.blur()=[orderOut:]+[orderBack:] 会摘面重贴 → 闪。焦点靠用户下次点浏览器自然交还。
    }
    // 硬保证:切模式绝不改变窗口位置。
    const [nx, ny] = this.win.getPosition()
    if (nx !== px || ny !== py) this.win.setPosition(px, py)
    this.win.webContents.send(EVENT.overlayMode, interactive ? 'interactive' : 'passthrough')
    this.deps.onVisibilityChange()
  }

  // The Fn+Command / tray show-hide item toggles visibility (non-activating), then refreshes the tray.
  toggleVisibility(): void {
    if (!this.win) return
    if (this.win.isVisible()) {
      this.userVisible = false
      this.win.hide()
    } else {
      this.userVisible = true
      this.win.showInactive() // 非激活显示,不切屏
    }
    this.deps.onVisibilityChange()
  }

  // The tray mode item ensures the overlay is shown (non-activating) then flips passthrough/input.
  ensureShownAndToggleMode(): void {
    if (!this.win) return
    if (!this.win.isVisible()) {
      this.userVisible = true
      this.win.showInactive()
    }
    this.applyMode(!this.interactive)
  }

  startHeartbeat(): void {
    // 10Hz: 只负责"被 OS/会议软件强行隐藏后自动恢复可见"。
    this.heartbeatTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed()) return
      if (this.userVisible && !this.win.isVisible()) {
        this.win.showInactive() // 恢复也用非激活方式,避免切屏
        this.win.setAlwaysOnTop(true, 'screen-saver')
        this.win.setContentProtection(true) // 恢复后重设内容保护(E28 hide→show 会丢)
        if (!this.interactive) this.win.setIgnoreMouseEvents(true) // 重新落实穿透态
        this.deps.onVisibilityChange() // visibility changed → refresh the tray label
      }
    }, 100)
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
